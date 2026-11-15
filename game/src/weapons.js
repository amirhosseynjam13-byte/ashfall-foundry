// weapons.js - the gunplay core, shared identically by the player and bots.
// Owns per-actor loadouts (stored on actor.loadout), the spread/recoil model,
// hitscan resolution against actor hitboxes and world AABBs, timed reloads
// (per-shell for the Mule), and thrown grenades with bounce physics.
//
// Spread model (degrees, per SPEC):
//   total = base + movePenalty + airPenalty + bloom, crouched x0.7
//   movePenalty ramps from 0 at 1.2 m/s up to the weapon's move column at its
//   full move speed; bloom is +0.35 per shot, capped at +3, decaying 6/s.
// Recoil is accumulated onto actor.recoilPitch / actor.recoilYaw (radians);
// player.js and bots.js add them to their view, weapons.js decays them here
// (about 90 ms recovery). Consumers must not decay them a second time.
//
// Damage passed to applyDamage() is FINAL pre-armor damage: weapon damage x
// hitbox multiplier x range falloff are all applied here. actors.js applies
// armor only. Grenades pass part "chest" with radius falloff applied here.

import * as THREE from "three";
import { CFG, WEAPONS, GRENADES } from "./config.js";
import { clamp, lerp, deg2rad, rayVsAABB, hasLOS, randRange } from "./util.js";
import { applyDamage } from "./actors.js";

const AIR_SPREAD = 2.5; // degrees added while airborne
const BLOOM_PER_SHOT = 0.35;
const BLOOM_CAP = 3;
const BLOOM_DECAY = 6; // degrees per second
const MAX_RANGE = 160;
const GRENADE_ORDER = ["frag", "smoke", "flash"];
const GRENADE_FUSE = { frag: 1.5, flash: 1.4, smoke: 1.3 };
const GRENADE_COLORS = { frag: 0x6a7a3a, smoke: 0x8b9094, flash: 0xd8dde2 };

const UP = new THREE.Vector3(0, 1, 0);
const wEye = new THREE.Vector3();
const wDir = new THREE.Vector3();
const wShot = new THREE.Vector3();
const wEnd = new THREE.Vector3();
const wMuzzle = new THREE.Vector3();
const wRight = new THREE.Vector3();
const wUp = new THREE.Vector3();
const wTmp = new THREE.Vector3();
const shotHit = { actor: null, part: null, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) };
const curInfo = { id: null, def: null, state: null, grenade: null };

// --- loadout state ------------------------------------------------------------

function makeState(id) {
	const def = WEAPONS[id];
	return {
		id, def,
		ammo: def.mag || 0,
		reserve: def.reserve || 0,
		bloom: 0, fireT: 0, drawT: 0, dryT: 0,
		reloading: false, reloadT: 0, reloadSfx: false,
		latched: false,
	};
}

export function createLoadout() {
	const lo = {
		states: {}, currentId: "p9", slot: 2,
		grenades: { frag: 0, smoke: 0, flash: 0 },
		activeGrenade: null, prevSlot: 2, throwT: 0,
	};
	lo.states.knife = makeState("knife");
	lo.states.p9 = makeState("p9");
	return lo;
}

function loadoutOf(actor) {
	if (!actor.loadout) actor.loadout = createLoadout();
	return actor.loadout;
}

// Adds a weapon (fresh, fully loaded) or one grenade of the given kind.
// Returns true when the id was recognised.
export function giveWeapon(actor, id) {
	const lo = loadoutOf(actor);
	if (GRENADES[id]) {
		lo.grenades[id] = 1; // at most one of each, per SPEC
		return true;
	}
	if (WEAPONS[id]) {
		lo.states[id] = makeState(id);
		return true;
	}
	return false;
}

export function currentWeapon(actor) {
	const lo = loadoutOf(actor);
	curInfo.grenade = lo.activeGrenade;
	if (lo.activeGrenade) {
		curInfo.id = lo.activeGrenade;
		curInfo.def = GRENADES[lo.activeGrenade];
		curInfo.state = null;
	} else {
		curInfo.id = lo.currentId;
		curInfo.state = lo.states[lo.currentId] || null;
		curInfo.def = curInfo.state ? curInfo.state.def : null;
	}
	return curInfo;
}

function cancelReload(lo) {
	const st = lo.states[lo.currentId];
	if (st) st.reloading = false;
}

function switchTo(lo, id) {
	cancelReload(lo);
	lo.activeGrenade = null;
	lo.currentId = id;
	lo.slot = WEAPONS[id].slot;
	const st = lo.states[id];
	st.drawT = st.def.drawTime ?? 0.3;
	st.latched = false;
}

// Slot keys 1-4. Slot 4 selects grenades; pressing it again cycles the kind.
export function selectSlot(actor, slot) {
	if (!actor.alive) return false;
	const lo = loadoutOf(actor);
	if (slot === 4) {
		const owned = GRENADE_ORDER.filter((k) => lo.grenades[k] > 0);
		if (owned.length === 0) return false;
		if (lo.activeGrenade) {
			lo.activeGrenade = owned[(owned.indexOf(lo.activeGrenade) + 1) % owned.length];
		} else {
			lo.prevSlot = lo.slot;
			cancelReload(lo);
			lo.currentId = null;
			lo.slot = 4;
			lo.activeGrenade = owned[0];
		}
		return true;
	}
	for (const id in lo.states) {
		if (lo.states[id].def.slot === slot) {
			if (lo.currentId !== id || lo.activeGrenade) switchTo(lo, id);
			return true;
		}
	}
	return false;
}

export function selectWeapon(actor, id) {
	if (!actor.alive) return false;
	const lo = loadoutOf(actor);
	if (!lo.states[id]) return false;
	if (lo.currentId !== id || lo.activeGrenade) switchTo(lo, id);
	return true;
}

// Semi, bolt, pump and melee weapons latch after each shot; the owner calls
// this when the trigger is released so the next press can fire.
export function releaseTrigger(actor) {
	const lo = actor.loadout;
	if (!lo) return;
	const st = lo.states[lo.currentId];
	if (st) st.latched = false;
}

// --- shared geometry helpers ----------------------------------------------------

function eyeOf(actor, out) {
	out.copy(actor.pos);
	out.y += lerp(CFG.eyeStand, CFG.eyeCrouch, actor.crouch01 || 0);
	return out;
}

// Facing from yaw/pitch, three.js convention: yaw 0 looks down -Z, positive
// pitch looks up. actors.js yaw/pitch follow the same convention.
function facingOf(actor, out) {
	const cp = Math.cos(actor.pitch || 0);
	out.set(-Math.sin(actor.yaw) * cp, Math.sin(actor.pitch || 0), -Math.cos(actor.yaw) * cp);
	return out;
}

function falloff(dist) {
	if (dist <= CFG.falloffStart) return 1;
	if (dist >= CFG.falloffEnd) return CFG.falloffMinFrac;
	const t = (dist - CFG.falloffStart) / (CFG.falloffEnd - CFG.falloffStart);
	return 1 - (1 - CFG.falloffMinFrac) * t;
}

export function currentSpread(actor) {
	const lo = actor.loadout;
	if (!lo || lo.activeGrenade) return 0;
	const st = lo.states[lo.currentId];
	return st ? spreadOf(actor, st) : 0;
}

function spreadOf(actor, st) {
	const def = st.def;
	if (!def.spread) return 0;
	if (def.kind === "sniper" && actor.scoped) return def.spreadScoped;
	const speed = Math.hypot(actor.vel.x, actor.vel.z);
	const moveFrac = clamp((speed - 1.2) / Math.max(0.1, def.moveSpeed - 1.2), 0, 1);
	let deg = def.spread[0] + def.spread[1] * moveFrac + st.bloom;
	if (actor.grounded === false) deg += AIR_SPREAD;
	deg *= 1 - 0.3 * (actor.crouch01 || 0);
	return deg;
}

// Perturbs dir inside a cone of spreadDeg using the match RNG.
function spreadDir(dir, spreadDeg, rand, out) {
	if (spreadDeg <= 0.01) { out.copy(dir); return out; }
	wRight.crossVectors(dir, UP);
	if (wRight.lengthSq() < 1e-6) wRight.set(1, 0, 0); else wRight.normalize();
	wUp.crossVectors(wRight, dir).normalize();
	const r = deg2rad(spreadDeg) * Math.sqrt(rand());
	const th = rand() * Math.PI * 2;
	out.copy(dir)
		.addScaledVector(wRight, Math.cos(th) * r)
		.addScaledVector(wUp, Math.sin(th) * r)
		.normalize();
	return out;
}

function boxFaceNormal(box, p, out) {
	const dxMin = Math.abs(p.x - box.min.x), dxMax = Math.abs(p.x - box.max.x);
	const dyMin = Math.abs(p.y - box.min.y), dyMax = Math.abs(p.y - box.max.y);
	const dzMin = Math.abs(p.z - box.min.z), dzMax = Math.abs(p.z - box.max.z);
	let m = dxMin; out.set(-1, 0, 0);
	if (dxMax < m) { m = dxMax; out.set(1, 0, 0); }
	if (dyMin < m) { m = dyMin; out.set(0, -1, 0); }
	if (dyMax < m) { m = dyMax; out.set(0, 1, 0); }
	if (dzMin < m) { m = dzMin; out.set(0, 0, -1); }
	if (dzMax < m) { out.set(0, 0, 1); }
	return out;
}

// Nearest hit along the ray: an enemy actor's hitbox or a world AABB.
// Friendly fire is off - same-team actors are passed through.
function traceShot(G, shooter, origin, dir) {
	let bestDist = MAX_RANGE;
	shotHit.actor = null;
	shotHit.part = null;
	for (const a of G.actors) {
		if (!a.alive || a === shooter || a.team === shooter.team) continue;
		const hit = a.hitTest(origin, dir);
		if (hit && hit.dist < bestDist) {
			bestDist = hit.dist;
			shotHit.actor = a;
			shotHit.part = hit.part;
			shotHit.point.copy(hit.point);
		}
	}
	const colliders = G.world.colliders;
	for (let i = 0; i < colliders.length; i++) {
		const t = rayVsAABB(origin, dir, colliders[i], bestDist);
		if (t !== Infinity && t < bestDist) {
			bestDist = t;
			shotHit.actor = null;
			shotHit.part = null;
			shotHit.point.copy(origin).addScaledVector(dir, t);
			boxFaceNormal(colliders[i], shotHit.point, shotHit.normal);
		}
	}
	shotHit.dist = bestDist;
	return bestDist < MAX_RANGE ? shotHit : null;
}

function listenerDist(G, actor) {
	return distToPlayer(G, actor.pos);
}

function distToPlayer(G, pos) {
	for (const a of G.actors) if (a.isPlayer) return a.pos.distanceTo(pos);
	return 0;
}

// --- firing ----------------------------------------------------------------------

function meleeSwing(G, actor, dir) {
	const def = WEAPONS.knife;
	eyeOf(actor, wEye);
	let best = null;
	let bestDist = Infinity;
	for (const a of G.actors) {
		if (!a.alive || a === actor || a.team === actor.team) continue;
		wTmp.copy(a.pos);
		wTmp.y += 1.05;
		wTmp.sub(wEye);
		const dist = wTmp.length();
		if (dist > def.range + CFG.actorRadius || dist < 1e-4) continue;
		if (wTmp.multiplyScalar(1 / dist).dot(dir) < 0.5) continue; // ~60 degree cone
		if (dist < bestDist) { bestDist = dist; best = a; }
	}
	if (!best) return;
	// Backstab: the attacker stands in the victim's rear arc.
	facingOf(best, wTmp);
	wRight.subVectors(actor.pos, best.pos).normalize();
	const behind = wTmp.dot(wRight) < -0.35;
	const wasAlive = best.alive;
	applyDamage(G, best, behind ? def.backstab : def.damage, "chest", actor);
	G.effects.hitSpark(wTmp.copy(best.pos).setY(best.pos.y + 1.05));
	if (actor.isPlayer) {
		G.audio.hit(false);
		if (wasAlive && !best.alive) { G.audio.kill(); /* G.onKill fires inside applyDamage */ }
	}
}

// Attempts to fire the current weapon once. Call every sim step while the
// trigger is held; rate, mode latching, draw time and reloads are honoured
// internally. Returns true when a shot (or throw) actually happened.
export function fire(G, actor, dir) {
	if (!actor.alive || !actor.loadout) return false;
	const lo = actor.loadout;
	if (lo.throwT > 0) return false;
	if (lo.activeGrenade) return throwGrenade(G, actor, lo.activeGrenade, dir);
	const st = lo.states[lo.currentId];
	if (!st) return false;
	const def = st.def;
	if (st.drawT > 0 || st.fireT > 0) return false;
	if (def.kind === "melee") {
		if (st.latched) return false;
		st.latched = true;
		st.fireT = 60 / def.rpm;
		wDir.copy(dir).normalize();
		meleeSwing(G, actor, wDir);
		return true;
	}
	if (def.mode !== "auto") {
		if (st.latched) return false;
	}
	if (st.reloading) {
		// The Mule can interrupt a shell reload by firing what is loaded.
		if (def.reloadPerShell && st.ammo > 0) st.reloading = false;
		else return false;
	}
	if (st.ammo <= 0) {
		st.latched = true;
		if (st.dryT <= 0) { G.audio.dry(); st.dryT = 0.35; }
		if (st.reserve > 0) startReload(actor);
		return false;
	}

	st.latched = def.mode !== "auto";
	st.fireT = 60 / def.rpm;
	st.ammo--;
	st.bloom = Math.min(BLOOM_CAP, st.bloom + BLOOM_PER_SHOT);
	actor.recoilPitch = (actor.recoilPitch || 0) + deg2rad(def.recoil);
	actor.recoilYaw = (actor.recoilYaw || 0) + deg2rad(def.recoil * randRange(G.rng, -0.3, 0.3));

	wDir.copy(dir).normalize();
	eyeOf(actor, wEye);
	// Muzzle sits low-right of the eye, roughly where the gun model is.
	wRight.crossVectors(wDir, UP).normalize();
	wMuzzle.copy(wEye).addScaledVector(wDir, 0.55).addScaledVector(wRight, 0.16);
	wMuzzle.y -= 0.14;
	G.effects.muzzle(wMuzzle, wDir);
	G.effects.casing(wMuzzle, wDir);
	G.audio.shot(def.kind, actor.isPlayer ? 0 : listenerDist(G, actor));

	const spreadDeg = spreadOf(actor, st);
	const pellets = def.pellets || 1;
	let anyHit = false, headHit = false, killed = false;
	for (let p = 0; p < pellets; p++) {
		spreadDir(wDir, spreadDeg, G.rng, wShot);
		const hit = traceShot(G, actor, wEye, wShot);
		if (hit) wEnd.copy(hit.point);
		else wEnd.copy(wEye).addScaledVector(wShot, MAX_RANGE);
		G.effects.tracer(wMuzzle, wEnd, CFG.teamColors[actor.team]);
		if (!hit) continue;
		if (hit.actor) {
			const target = hit.actor;
			const wasAlive = target.alive;
			applyDamage(G, target, def.damage * CFG.partMult[hit.part] * falloff(hit.dist), hit.part, actor);
			G.effects.hitSpark(hit.point);
			anyHit = true;
			if (hit.part === "head") headHit = true;
			if (wasAlive && !target.alive) {
				killed = true;
				/* G.onKill fires inside applyDamage */
			}
		} else {
			const kind = hit.point.y <= 0.06 && hit.normal.y > 0.5 ? "dust" : "metal";
			G.effects.impact(hit.point, hit.normal, kind);
		}
	}
	if (anyHit && actor.isPlayer) {
		G.audio.hit(headHit);
		if (killed) G.audio.kill();
		G.hud?.hitmark?.(killed);
	}
	return true;
}

// --- reload ------------------------------------------------------------------------

export function reload(actor) {
	return startReload(actor);
}

function startReload(actor) {
	const lo = actor.loadout;
	if (!lo || lo.activeGrenade || !actor.alive) return false;
	const st = lo.states[lo.currentId];
	if (!st || st.reloading) return false;
	const def = st.def;
	if (def.kind === "melee" || st.ammo >= def.mag || st.reserve <= 0) return false;
	st.reloading = true;
	st.reloadT = def.reload;
	st.reloadSfx = false;
	return true;
}

// --- grenades ------------------------------------------------------------------------
// Live grenades are a fixed pool with simple AABB bounce physics, stepped by
// updateWeapons. Frag/flash/smoke resolve on fuse expiry through the effects
// and audio hooks, exactly like gunfire resolves through applyDamage.

const NADE_POOL = 10;
const nades = [];
let nadeMeshesReady = false;
const nadeMats = {};

function ensureNadeMeshes(scene) {
	if (nadeMeshesReady) return;
	nadeMeshesReady = true;
	const geo = new THREE.SphereGeometry(0.09, 10, 8);
	for (const kind of GRENADE_ORDER) {
		nadeMats[kind] = new THREE.MeshStandardMaterial({
			color: GRENADE_COLORS[kind], metalness: 0.4, roughness: 0.5,
		});
	}
	for (let i = 0; i < NADE_POOL; i++) {
		const mesh = new THREE.Mesh(geo, nadeMats.frag);
		mesh.visible = false;
		scene.add(mesh);
		nades.push({
			active: false, kind: null, thrower: null, mesh,
			pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0,
		});
	}
}

// Throws one grenade of `kind` from the actor's hand. Used by fire() when a
// grenade is selected, and directly by bots. Returns false if none are held.
export function throwGrenade(G, actor, kind, dir) {
	const lo = loadoutOf(actor);
	if (!actor.alive || lo.grenades[kind] <= 0) return false;
	ensureNadeMeshes(G.scene);
	let nade = null;
	for (const n of nades) if (!n.active) { nade = n; break; }
	if (!nade) return false;
	lo.grenades[kind]--;
	if (lo.activeGrenade === kind) lo.throwT = 0.45; // hand returns, then swap back
	nade.active = true;
	nade.kind = kind;
	nade.thrower = actor;
	nade.mesh.material = nadeMats[kind];
	nade.mesh.visible = true;
	eyeOf(actor, nade.pos);
	nade.pos.addScaledVector(dir, 0.4);
	nade.vel.copy(dir).multiplyScalar(17);
	nade.vel.y += 2.2;
	nade.vel.addScaledVector(actor.vel, 0.6);
	nade.fuse = GRENADE_FUSE[kind];
	G.audio.nade("throw");
	return true;
}

function detonateFrag(G, nade) {
	G.effects.explosion(nade.pos);
	G.audio.explosion();
	const def = GRENADES.frag;
	const reach = def.radius + CFG.actorRadius;
	let anyHit = false, killed = false;
	for (const a of G.actors) {
		if (!a.alive) continue;
		wTmp.copy(a.pos);
		wTmp.y += 1.0;
		const dist = wTmp.distanceTo(nade.pos);
		if (dist > reach) continue;
		let dmg = def.damage * clamp(1 - dist / reach, 0.12, 1);
		if (!hasLOS(nade.pos, wTmp, G.world.colliders)) dmg *= 0.4;
		const wasAlive = a.alive;
		applyDamage(G, a, dmg, "chest", nade.thrower);
		if (a.team !== nade.thrower.team) {
			anyHit = true;
			if (wasAlive && !a.alive) {
				killed = true;
				/* G.onKill fires inside applyDamage */
			}
		}
	}
	if (anyHit && nade.thrower.isPlayer) {
		G.audio.hit(false);
		if (killed) G.audio.kill();
		G.hud?.hitmark?.(killed);
	}
}

function detonateFlash(G, nade) {
	const def = GRENADES.flash;
	for (const a of G.actors) {
		if (!a.alive) continue;
		eyeOf(a, wEye);
		const dist = wEye.distanceTo(nade.pos);
		if (dist > def.range) continue;
		if (!hasLOS(nade.pos, wEye, G.world.colliders)) continue;
		// Scaled by how directly the actor faces the burst, and by distance.
		wTmp.copy(nade.pos).sub(wEye).normalize();
		facingOf(a, wRight);
		const facing = clamp((wTmp.dot(wRight) + 0.35) / 1.35, 0.06, 1);
		const strength = facing * (1 - (dist / def.range) * 0.5);
		a.flashT = Math.max(a.flashT || 0, def.duration * strength);
		if (a.isPlayer) G.hud?.flashBanged?.(strength);
	}
}

function stepNade(G, nade, dt) {
	nade.vel.y -= CFG.gravity * dt;
	nade.pos.addScaledVector(nade.vel, dt);
	const r = 0.09;
	const colliders = G.world.colliders;
	for (let i = 0; i < colliders.length; i++) {
		const b = colliders[i];
		if (nade.pos.x < b.min.x - r || nade.pos.x > b.max.x + r ||
			nade.pos.y < b.min.y - r || nade.pos.y > b.max.y + r ||
			nade.pos.z < b.min.z - r || nade.pos.z > b.max.z + r) continue;
		// Push out along the axis of least penetration and reflect it.
		const px = Math.min(nade.pos.x - (b.min.x - r), (b.max.x + r) - nade.pos.x);
		const py = Math.min(nade.pos.y - (b.min.y - r), (b.max.y + r) - nade.pos.y);
		const pz = Math.min(nade.pos.z - (b.min.z - r), (b.max.z + r) - nade.pos.z);
		const speed = nade.vel.length();
		if (px < py && px < pz) {
			nade.pos.x = nade.pos.x - b.min.x < b.max.x - nade.pos.x ? b.min.x - r : b.max.x + r;
			nade.vel.x = -nade.vel.x * 0.42;
			nade.vel.y *= 0.8; nade.vel.z *= 0.8;
		} else if (py < pz) {
			nade.pos.y = nade.pos.y - b.min.y < b.max.y - nade.pos.y ? b.min.y - r : b.max.y + r;
			nade.vel.y = -nade.vel.y * 0.42;
			nade.vel.x *= 0.8; nade.vel.z *= 0.8;
		} else {
			nade.pos.z = nade.pos.z - b.min.z < b.max.z - nade.pos.z ? b.min.z - r : b.max.z + r;
			nade.vel.z = -nade.vel.z * 0.42;
			nade.vel.x *= 0.8; nade.vel.y *= 0.8;
		}
		if (speed > 1.6 && distToPlayer(G, nade.pos) < 25) G.audio.nade("bounce");
	}
	if (nade.pos.y < r) { // the world floor under everything
		nade.pos.y = r;
		nade.vel.y = Math.abs(nade.vel.y) > 0.7 ? -nade.vel.y * 0.42 : 0;
		nade.vel.x *= 0.82; nade.vel.z *= 0.82;
	}
	nade.mesh.position.copy(nade.pos);
	nade.fuse -= dt;
	if (nade.fuse > 0) return;
	nade.active = false;
	nade.mesh.visible = false;
	if (nade.kind === "frag") detonateFrag(G, nade);
	else if (nade.kind === "flash") detonateFlash(G, nade);
	else G.effects.smokePuff(nade.pos);
}

// --- per-step ticking ------------------------------------------------------------------
// Signature note: the SPEC sketch says updateWeapons(dt), but ticking reloads
// and grenades needs the world, so G comes first, matching fire(G, ...).

export function updateWeapons(G, dt) {
	for (const actor of G.actors) {
		// Recoil recovery (~90 ms) and flash blindness decay for every actor.
		if (actor.recoilPitch) actor.recoilPitch *= Math.exp(-dt / 0.045);
		if (actor.recoilYaw) actor.recoilYaw *= Math.exp(-dt / 0.045);
		if (actor.flashT > 0) actor.flashT = Math.max(0, actor.flashT - dt);
		const lo = actor.loadout;
		if (!lo) continue;
		if (lo.throwT > 0) {
			lo.throwT -= dt;
			if (lo.throwT <= 0 && lo.activeGrenade) selectSlot(actor, lo.prevSlot);
		}
		const st = lo.states[lo.currentId];
		if (!st) continue;
		if (st.fireT > 0) st.fireT -= dt;
		if (st.drawT > 0) st.drawT -= dt;
		if (st.dryT > 0) st.dryT -= dt;
		if (st.bloom > 0) st.bloom = Math.max(0, st.bloom - BLOOM_DECAY * dt);
		if (!st.reloading) continue;
		const def = st.def;
		if (!st.reloadSfx) { G.audio.reload(def.kind); st.reloadSfx = true; }
		st.reloadT -= dt;
		if (st.reloadT > 0) continue;
		if (def.reloadPerShell) {
			st.ammo++;
			st.reserve--;
			if (st.ammo >= def.mag || st.reserve <= 0) st.reloading = false;
			else { st.reloadT = def.reload; G.audio.reload(def.kind); }
		} else {
			const take = Math.min(def.mag - st.ammo, st.reserve);
			st.ammo += take;
			st.reserve -= take;
			st.reloading = false;
		}
	}
	for (const nade of nades) {
		if (nade.active) stepNade(G, nade, dt);
	}
}

// --- viewmodels ---------------------------------------------------------------------------
// Detailed first-person guns assembled from shared boxes/cylinders: receiver,
// railed handguard, barrel + muzzle brake, curved magazine, stock, grip,
// trigger guard, iron sights or an optic with emissive lenses, and canvas
// decals (serials / calibre marks). The group origin is the camera; the gun
// hangs low-right and points down -Z. userData.muzzle marks the barrel tip so
// the owner can anchor flashes. Every geometry, material and canvas texture
// is created once and shared across rebuilds (player.js rebuilds the
// viewmodel on every weapon switch). Bots use actors.js gun props, not these.

const VM_MATS = {
	dark: new THREE.MeshStandardMaterial({ color: 0x2b2f34, metalness: 0.8, roughness: 0.42 }),
	steel: new THREE.MeshStandardMaterial({ color: 0x767d85, metalness: 0.9, roughness: 0.3 }),
	mid: new THREE.MeshStandardMaterial({ color: 0x484f57, metalness: 0.65, roughness: 0.5 }),
	polymer: new THREE.MeshStandardMaterial({ color: 0x17181b, metalness: 0.05, roughness: 0.88 }),
	accent: new THREE.MeshStandardMaterial({ color: 0xff7a26, emissive: 0xa63e00, metalness: 0.3, roughness: 0.4 }),
	lens: new THREE.MeshStandardMaterial({ color: 0x66d9e8, emissive: 0x2a7d8f, emissiveIntensity: 1.5, metalness: 0.2, roughness: 0.15 }),
	lensDim: new THREE.MeshStandardMaterial({ color: 0x10181c, emissive: 0x0d3038, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.15 }),
	redDot: new THREE.MeshStandardMaterial({ color: 0x330b06, emissive: 0xff2208, emissiveIntensity: 2.2, metalness: 0, roughness: 0.4 }),
	brass: new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.85, roughness: 0.35 }),
	shellRed: new THREE.MeshStandardMaterial({ color: 0x7e2a20, metalness: 0.2, roughness: 0.55 }),
};

// Canvas textures + textured materials, built lazily on the first viewmodel
// (document exists by then) and shared by every gun afterwards.
let VM_TEX_MATS = null;
const VM_DECAL_MATS = {};

function vmCanvas(w, h, draw) {
	const c = document.createElement("canvas");
	c.width = w; c.height = h;
	draw(c.getContext("2d"), w, h);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = 4;
	return tex;
}

function vmTexMats() {
	if (VM_TEX_MATS) return VM_TEX_MATS;
	// Worn gunmetal: brushed base, speckle, scratches, grime blotches. Painted
	// in final tones, so the material colour stays white and the map speaks.
	const worn = vmCanvas(256, 256, (g, w, h) => {
		g.fillStyle = "#43484f";
		g.fillRect(0, 0, w, h);
		for (let i = 0; i < 900; i++) { // brushing streaks along X
			g.fillStyle = `rgba(${Math.random() > 0.5 ? "210,216,222" : "12,13,16"},${0.03 + Math.random() * 0.05})`;
			g.fillRect(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 1);
		}
		for (let i = 0; i < 2600; i++) { // speckle
			g.fillStyle = `rgba(${Math.random() > 0.5 ? "200,205,212" : "8,9,11"},${0.05 + Math.random() * 0.1})`;
			g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
		}
		for (let i = 0; i < 34; i++) { // bright worn scratches
			g.strokeStyle = `rgba(205,212,220,${0.1 + Math.random() * 0.16})`;
			g.lineWidth = 0.8;
			const x = Math.random() * w, y = Math.random() * h;
			g.beginPath(); g.moveTo(x, y);
			g.lineTo(x + (Math.random() - 0.5) * 46, y + (Math.random() - 0.5) * 10);
			g.stroke();
		}
		for (let i = 0; i < 9; i++) { // grime
			const x = Math.random() * w, y = Math.random() * h, r = 22 + Math.random() * 46;
			const grad = g.createRadialGradient(x, y, 1, x, y, r);
			grad.addColorStop(0, "rgba(10,10,12,0.28)");
			grad.addColorStop(1, "rgba(10,10,12,0)");
			g.fillStyle = grad;
			g.fillRect(x - r, y - r, r * 2, r * 2);
		}
	});
	// Rubber grip: near-black with a knurled cross-hatch.
	const grip = vmCanvas(128, 128, (g, w, h) => {
		g.fillStyle = "#1d1e21";
		g.fillRect(0, 0, w, h);
		g.strokeStyle = "rgba(255,255,255,0.07)";
		g.lineWidth = 2;
		for (let i = -h; i < w + h; i += 9) {
			g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
			g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
		}
		for (let i = 0; i < 500; i++) {
			g.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.12})`;
			g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
		}
	});
	grip.repeat.set(2, 2);
	// Worn hazard stripes for brake collars and bands.
	const hazard = vmCanvas(128, 32, (g, w, h) => {
		g.fillStyle = "#151517";
		g.fillRect(0, 0, w, h);
		g.fillStyle = "#c9971f";
		for (let x = -h; x < w + h; x += 32) {
			g.beginPath();
			g.moveTo(x, h); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, h);
			g.fill();
		}
		for (let i = 0; i < 260; i++) { // wear
			g.fillStyle = `rgba(18,18,20,${0.15 + Math.random() * 0.3})`;
			g.fillRect(Math.random() * w, Math.random() * h, 2.4, 1.6);
		}
	});
	VM_TEX_MATS = {
		receiver: new THREE.MeshStandardMaterial({ map: worn, metalness: 0.72, roughness: 0.46 }),
		gripTex: new THREE.MeshStandardMaterial({ map: grip, metalness: 0.05, roughness: 0.92 }),
		hazard: new THREE.MeshStandardMaterial({ map: hazard, metalness: 0.35, roughness: 0.6 }),
	};
	return VM_TEX_MATS;
}

const VM_DECAL_TEXT = {
	vulcan: ["VK-27", "CAL 5.56 · FOUNDRY"],
	raptor: ["RAPTOR-9", "9MM · AUTO"],
	longshot: ["LONGSHOT", ".338 · SN 0117"],
	p9: ["P9", "CAL 9MM"],
	mule: ["MULE 870", "12 GA · PUMP"],
};

// Stencil-style receiver decal: big model mark, small spec line, orange bar,
// lightly eroded so it reads as worn paint rather than a sticker.
function vmDecalMat(id) {
	if (VM_DECAL_MATS[id]) return VM_DECAL_MATS[id];
	const [big, small] = VM_DECAL_TEXT[id] || [id.toUpperCase(), ""];
	const tex = vmCanvas(256, 64, (g, w, h) => {
		g.clearRect(0, 0, w, h);
		g.fillStyle = "#ff7a26";
		g.fillRect(0, 8, 10, 48);
		g.fillStyle = "rgba(224,229,234,0.92)";
		g.font = "bold 30px monospace";
		g.textBaseline = "top";
		g.fillText(big, 20, 6);
		g.fillStyle = "rgba(168,174,182,0.85)";
		g.font = "bold 15px monospace";
		g.fillText(small, 21, 40);
		g.globalCompositeOperation = "destination-out";
		for (let i = 0; i < 130; i++) {
			g.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.4})`;
			g.fillRect(14 + Math.random() * (w - 20), Math.random() * h, 2 + Math.random() * 5, 1.4);
		}
		g.globalCompositeOperation = "source-over";
	});
	tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
	const mat = new THREE.MeshStandardMaterial({
		map: tex, transparent: true, metalness: 0.35, roughness: 0.55,
		polygonOffset: true, polygonOffsetFactor: -1,
	});
	VM_DECAL_MATS[id] = mat;
	return mat;
}

// --- shared geometry cache ---------------------------------------------------
// Viewmodels are rebuilt on every weapon switch; geometries are keyed by
// their dimensions and reused instead of re-allocated.
const VM_GEO = new Map();

function vmBoxGeo(w, h, d) {
	const key = `b${w}|${h}|${d}`;
	let g = VM_GEO.get(key);
	if (!g) { g = new THREE.BoxGeometry(w, h, d); VM_GEO.set(key, g); }
	return g;
}

function vmCylGeo(rBack, rFront, len, seg) {
	const key = `c${rBack}|${rFront}|${len}|${seg}`;
	let g = VM_GEO.get(key);
	if (!g) { g = new THREE.CylinderGeometry(rBack, rFront, len, seg); VM_GEO.set(key, g); }
	return g;
}

function vmTorusGeo(r, tube) {
	const key = `t${r}|${tube}`;
	let g = VM_GEO.get(key);
	if (!g) { g = new THREE.TorusGeometry(r, tube, 8, 20); VM_GEO.set(key, g); }
	return g;
}

function vmCircleGeo(r) {
	const key = `o${r}`;
	let g = VM_GEO.get(key);
	if (!g) { g = new THREE.CircleGeometry(r, 20); VM_GEO.set(key, g); }
	return g;
}

let VM_BLADE_GEO = null;
function vmBladeGeo() {
	if (!VM_BLADE_GEO) {
		// 4-sided tapered prism: diamond cross-section, point at -Z.
		const g = new THREE.CylinderGeometry(0.0025, 0.02, 0.27, 4);
		g.rotateX(-Math.PI / 2);
		g.rotateZ(Math.PI / 4);
		VM_BLADE_GEO = g;
	}
	return VM_BLADE_GEO;
}

// --- part builders -------------------------------------------------------------

function vmBox(parent, w, h, d, x, y, z, mat = VM_MATS.dark, rx = 0, ry = 0, rz = 0) {
	const mesh = new THREE.Mesh(vmBoxGeo(w, h, d), mat);
	mesh.position.set(x, y, z);
	mesh.rotation.set(rx, ry, rz);
	parent.add(mesh);
	return mesh;
}

// Cylinder along an axis. For "z" the barrel axis: rBack faces the camera
// (+Z), rFront points downrange (-Z).
function vmCyl(parent, rBack, rFront, len, x, y, z, mat = VM_MATS.mid, axis = "z", seg = 12) {
	const mesh = new THREE.Mesh(vmCylGeo(rBack, rFront, len, seg), mat);
	if (axis === "z") mesh.rotation.x = Math.PI / 2;
	else if (axis === "x") mesh.rotation.z = Math.PI / 2;
	mesh.position.set(x, y, z);
	parent.add(mesh);
	return mesh;
}

// Picatinny rail: a spine with evenly spaced cross ridges, centred on z.
function vmRail(parent, x, y, z, len, mat = VM_MATS.dark) {
	vmBox(parent, 0.021, 0.008, len, x, y, z, mat);
	const n = Math.max(2, Math.round(len / 0.021));
	for (let i = 0; i < n; i++) {
		const t = n === 1 ? 0 : i / (n - 1) - 0.5;
		vmBox(parent, 0.025, 0.009, 0.011, x, y + 0.006, z + t * (len - 0.012), mat);
	}
}

// Muzzle brake: a fat collar with dark cross slots cut around it.
function vmBrake(parent, x, y, z, r, len) {
	vmCyl(parent, r, r, len, x, y, z, VM_MATS.dark, "z", 14);
	for (let i = 0; i < 3; i++) {
		const sz = z - len / 2 + (i + 0.5) * (len / 3);
		vmBox(parent, r * 2 + 0.005, 0.01, 0.012, x, y, sz, VM_MATS.polymer);
		vmBox(parent, 0.01, r * 2 + 0.005, 0.012, x, y, sz, VM_MATS.polymer);
	}
}

// Curved magazine: three stacked segments leaning progressively forward,
// hung from yTop, plus a polymer baseplate.
function vmMag(parent, x, yTop, z, len, mat = VM_MATS.mid) {
	const seg = 3, segLen = len / seg, curve = 0.17;
	for (let i = 0; i < seg; i++) {
		const t = i / (seg - 1);
		vmBox(parent, 0.037, segLen + 0.014, 0.052,
			x, yTop - segLen * (i + 0.5) + 0.006,
			z - Math.sin(curve * t) * segLen * i * 0.85, mat, curve * t);
	}
	vmBox(parent, 0.042, 0.014, 0.058,
		x, yTop - len - 0.002,
		z - Math.sin(curve) * segLen * (seg - 1) * 0.85 - 0.004, VM_MATS.polymer, curve);
}

// Trigger guard ring with a trigger blade inside it.
function vmGuard(parent, x, y, z, r = 0.027) {
	const ring = new THREE.Mesh(vmTorusGeo(r, 0.0055), VM_MATS.dark);
	ring.position.set(x, y, z);
	ring.rotation.y = Math.PI / 2;
	parent.add(ring);
	vmBox(parent, 0.008, 0.03, 0.008, x, y + 0.005, z + 0.007, VM_MATS.steel, 0.25);
}

// Reflex optic: mount post, tube, ringed objective with a glowing lens up
// front, dim ocular glass and a red dot at the shooter's end.
function vmOptic(parent, x, y, z, r = 0.026, len = 0.06) {
	vmBox(parent, 0.018, 0.028, 0.026, x, y - r - 0.007, z, VM_MATS.dark);
	vmCyl(parent, r, r, len, x, y, z, VM_MATS.dark, "z", 18);
	vmCyl(parent, r + 0.004, r + 0.004, 0.012, x, y, z - len / 2 + 0.007, VM_MATS.mid, "z", 18);
	const front = new THREE.Mesh(vmCircleGeo(r * 0.8), VM_MATS.lens);
	front.position.set(x, y, z - len / 2 - 0.001);
	front.rotation.y = Math.PI;
	parent.add(front);
	const rear = new THREE.Mesh(vmCircleGeo(r * 0.8), VM_MATS.lensDim);
	rear.position.set(x, y, z + len / 2 + 0.001);
	parent.add(rear);
	const dot = new THREE.Mesh(vmCircleGeo(0.0035), VM_MATS.redDot);
	dot.position.set(x, y, z + len / 2 + 0.002);
	parent.add(dot);
}

// Receiver decal on the camera-facing (-X) side of the gun.
function vmDecal(parent, id, x, y, z, w = 0.15) {
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), vmDecalMat(id));
	mesh.position.set(x, y, z);
	mesh.rotation.y = -Math.PI / 2;
	parent.add(mesh);
	return mesh;
}

export function buildViewmodel(id) {
	const g = new THREE.Group();
	const muzzle = new THREE.Object3D();
	g.userData.muzzle = muzzle;
	const TM = vmTexMats();
	const X = 0.17, Y = -0.16; // low-right of the camera
	switch (id) {
		case "knife": {
			// Wrapped grip (knurled rubber + orange cord bands), crossguard,
			// and a flattened diamond-section blade.
			vmBox(g, 0.032, 0.105, 0.045, X, Y - 0.03, -0.315, TM.gripTex, 0.5);
			for (let i = 0; i < 3; i++) {
				vmBox(g, 0.037, 0.013, 0.05, X, Y - 0.005 - i * 0.028, -0.30 + i * 0.015, VM_MATS.accent, 0.5);
			}
			vmBox(g, 0.052, 0.011, 0.02, X, Y + 0.028, -0.362, VM_MATS.steel);
			const blade = new THREE.Mesh(vmBladeGeo(), VM_MATS.steel);
			blade.position.set(X, Y + 0.038, -0.50);
			blade.scale.x = 0.38;
			g.add(blade);
			vmBox(g, 0.004, 0.012, 0.2, X, Y + 0.052, -0.49, VM_MATS.dark); // spine fuller shadow line
			muzzle.position.set(X, Y + 0.038, -0.64);
			break;
		}
		case "p9": {
			// Slide with rear serrations over a railed frame, hammer, sights.
			vmBox(g, 0.042, 0.046, 0.21, X, Y + 0.008, -0.415, TM.receiver); // slide
			for (let i = 0; i < 4; i++) { // slide serrations
				vmBox(g, 0.045, 0.038, 0.007, X, Y + 0.008, -0.335 - i * 0.013, VM_MATS.polymer, 0.22);
			}
			vmCyl(g, 0.008, 0.008, 0.03, X, Y + 0.006, -0.525, VM_MATS.steel); // barrel tip
			vmBox(g, 0.04, 0.034, 0.19, X, Y - 0.032, -0.405, VM_MATS.mid); // frame
			vmBox(g, 0.02, 0.01, 0.07, X, Y - 0.053, -0.465, VM_MATS.dark); // accessory rail
			vmCyl(g, 0.006, 0.006, 0.05, X, Y - 0.005, -0.40, VM_MATS.steel, "x"); // slide pin
			vmBox(g, 0.014, 0.02, 0.014, X, Y + 0.038, -0.315, VM_MATS.dark); // rear sight
			vmBox(g, 0.006, 0.018, 0.008, X, Y + 0.038, -0.505, VM_MATS.dark); // front post
			vmBox(g, 0.007, 0.007, 0.009, X, Y + 0.042, -0.505, VM_MATS.accent); // front dot
			vmBox(g, 0.012, 0.022, 0.01, X, Y + 0.03, -0.302, VM_MATS.mid, -0.3); // hammer
			vmGuard(g, X, Y - 0.075, -0.435, 0.024);
			vmBox(g, 0.038, 0.115, 0.05, X, Y - 0.105, -0.315, TM.gripTex, 0.25); // grip
			vmBox(g, 0.042, 0.016, 0.056, X, Y - 0.163, -0.30, VM_MATS.dark); // mag baseplate
			vmDecal(g, "p9", X - 0.022, Y + 0.008, -0.42, 0.09);
			muzzle.position.set(X, Y + 0.008, -0.54);
			break;
		}
		case "mule": {
			// Pump shotgun: receiver, barrel over a magazine tube, ribbed
			// pump, side shell carrier, stocked rear.
			vmBox(g, 0.055, 0.075, 0.3, X, Y, -0.42, TM.receiver);
			vmCyl(g, 0.016, 0.016, 0.46, X, Y + 0.026, -0.68, VM_MATS.steel); // barrel
			vmCyl(g, 0.02, 0.02, 0.05, X, Y + 0.026, -0.885, TM.hazard, "z", 14); // ported band
			vmCyl(g, 0.013, 0.013, 0.42, X, Y - 0.03, -0.65, VM_MATS.mid); // mag tube
			vmBox(g, 0.048, 0.046, 0.15, X, Y - 0.03, -0.60, TM.gripTex); // pump
			for (let i = 0; i < 4; i++) {
				vmBox(g, 0.051, 0.05, 0.009, X, Y - 0.03, -0.545 - i * 0.036, VM_MATS.polymer);
			}
			vmBox(g, 0.008, 0.014, 0.008, X, Y + 0.048, -0.87, VM_MATS.accent); // front bead
			vmBox(g, 0.03, 0.012, 0.1, X, Y + 0.043, -0.44, VM_MATS.dark); // rib
			for (let i = 0; i < 3; i++) { // side saddle shells
				vmCyl(g, 0.009, 0.009, 0.032, X - 0.036, Y - 0.005, -0.36 - i * 0.042, VM_MATS.shellRed, "x", 10);
				vmCyl(g, 0.0095, 0.0095, 0.008, X - 0.052, Y - 0.005, -0.36 - i * 0.042, VM_MATS.brass, "x", 10);
			}
			vmBox(g, 0.04, 0.02, 0.09, X, Y - 0.045, -0.40, VM_MATS.polymer); // loading port
			vmBox(g, 0.05, 0.068, 0.17, X, Y - 0.018, -0.185, TM.gripTex, -0.16); // stock
			vmBox(g, 0.052, 0.08, 0.018, X, Y - 0.012, -0.098, VM_MATS.polymer); // recoil pad
			vmDecal(g, "mule", X - 0.029, Y, -0.44, 0.13);
			muzzle.position.set(X, Y + 0.026, -0.91);
			break;
		}
		case "raptor": {
			// Compact SMG: railed receiver, grooved suppressor, vertical
			// foregrip, curved mag, wire stock, reflex optic.
			vmBox(g, 0.052, 0.088, 0.32, X, Y, -0.42, TM.receiver);
			vmRail(g, X, Y + 0.052, -0.46, 0.3);
			vmBox(g, 0.046, 0.05, 0.14, X, Y - 0.002, -0.545, VM_MATS.dark); // handguard
			vmCyl(g, 0.012, 0.012, 0.06, X, Y + 0.008, -0.60, VM_MATS.steel); // barrel stub
			vmCyl(g, 0.027, 0.027, 0.19, X, Y + 0.008, -0.685, VM_MATS.mid, "z", 16); // suppressor
			for (let i = 0; i < 3; i++) {
				const ring = new THREE.Mesh(vmTorusGeo(0.0275, 0.0032), VM_MATS.dark);
				ring.position.set(X, Y + 0.008, -0.625 - i * 0.055);
				g.add(ring);
			}
			vmBox(g, 0.034, 0.085, 0.04, X, Y - 0.075, -0.545, TM.gripTex, 0.18); // foregrip
			vmMag(g, X, Y - 0.045, -0.44, 0.14);
			vmGuard(g, X, Y - 0.062, -0.375, 0.024);
			vmBox(g, 0.036, 0.095, 0.042, X, Y - 0.09, -0.325, TM.gripTex, 0.3); // grip
			vmBox(g, 0.012, 0.012, 0.13, X, Y + 0.01, -0.20, VM_MATS.steel); // stock rods
			vmBox(g, 0.048, 0.07, 0.02, X, Y + 0.005, -0.135, VM_MATS.polymer); // buttpad
			vmBox(g, 0.055, 0.018, 0.12, X + 0.001, Y + 0.012, -0.42, VM_MATS.accent); // stripe
			vmCyl(g, 0.007, 0.007, 0.035, X + 0.032, Y + 0.02, -0.30, VM_MATS.steel, "x"); // charging nub
			vmOptic(g, X, Y + 0.088, -0.44, 0.024, 0.052);
			vmDecal(g, "raptor", X - 0.0275, Y - 0.005, -0.42, 0.13);
			muzzle.position.set(X, Y + 0.008, -0.79);
			break;
		}
		case "longshot": {
			// Bolt-action .338: heavy braked barrel, big scope with turrets,
			// bolt handle, deployed bipod, high cheek-riser stock.
			vmBox(g, 0.056, 0.08, 0.32, X, Y, -0.44, TM.receiver);
			vmBox(g, 0.052, 0.062, 0.26, X, Y - 0.002, -0.62, VM_MATS.dark); // handguard
			vmRail(g, X, Y + 0.036, -0.62, 0.24);
			vmCyl(g, 0.016, 0.014, 0.34, X, Y + 0.012, -0.90, VM_MATS.steel, "z", 12); // barrel
			vmBrake(g, X, Y + 0.012, -1.105, 0.026, 0.09);
			vmCyl(g, 0.02, 0.02, 0.035, X, Y + 0.012, -1.045, TM.hazard, "z", 12); // brake collar
			// Scope: mounts, tube, objective bell + lens, ocular, turrets.
			vmRail(g, X, Y + 0.047, -0.45, 0.26);
			vmBox(g, 0.016, 0.03, 0.02, X, Y + 0.062, -0.38, VM_MATS.dark);
			vmBox(g, 0.016, 0.03, 0.02, X, Y + 0.062, -0.52, VM_MATS.dark);
			vmCyl(g, 0.02, 0.02, 0.30, X, Y + 0.088, -0.45, VM_MATS.dark, "z", 16);
			vmCyl(g, 0.02, 0.03, 0.07, X, Y + 0.088, -0.615, VM_MATS.dark, "z", 18); // objective bell
			const obj = new THREE.Mesh(vmCircleGeo(0.024), VM_MATS.lens);
			obj.position.set(X, Y + 0.088, -0.651);
			obj.rotation.y = Math.PI;
			g.add(obj);
			vmCyl(g, 0.024, 0.024, 0.05, X, Y + 0.088, -0.285, VM_MATS.dark, "z", 14); // ocular
			const oc = new THREE.Mesh(vmCircleGeo(0.019), VM_MATS.lensDim);
			oc.position.set(X, Y + 0.088, -0.259);
			g.add(oc);
			vmCyl(g, 0.014, 0.014, 0.026, X, Y + 0.115, -0.45, VM_MATS.mid, "y", 12); // elevation turret
			vmCyl(g, 0.013, 0.013, 0.024, X + 0.026, Y + 0.088, -0.45, VM_MATS.mid, "x", 12); // windage
			// Bolt handle on the right, knobbed.
			vmCyl(g, 0.006, 0.006, 0.045, X + 0.038, Y + 0.012, -0.335, VM_MATS.steel, "x", 8);
			const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 10, 8), VM_MATS.dark);
			knob.position.set(X + 0.062, Y + 0.012, -0.335);
			g.add(knob);
			// Bipod, legs splayed down-forward from the handguard tip.
			for (const s of [-1, 1]) {
				const leg = vmCyl(g, 0.005, 0.004, 0.17, X + s * 0.028, Y - 0.10, -0.755, VM_MATS.steel, "z", 8);
				leg.rotation.set(0.5, 0, s * 0.3);
				vmBox(g, 0.02, 0.008, 0.035, X + s * 0.052, Y - 0.168, -0.79, VM_MATS.polymer);
			}
			vmMag(g, X, Y - 0.042, -0.42, 0.115);
			vmGuard(g, X, Y - 0.06, -0.36, 0.024);
			vmBox(g, 0.036, 0.09, 0.042, X, Y - 0.085, -0.315, TM.gripTex, 0.28); // grip
			vmBox(g, 0.05, 0.07, 0.17, X, Y - 0.015, -0.185, TM.gripTex, -0.14); // stock
			vmBox(g, 0.046, 0.028, 0.1, X, Y + 0.032, -0.20, VM_MATS.polymer); // cheek riser
			vmBox(g, 0.052, 0.082, 0.018, X, Y - 0.01, -0.095, VM_MATS.polymer); // recoil pad
			vmBox(g, 0.058, 0.018, 0.12, X + 0.001, Y, -0.44, VM_MATS.accent); // stripe
			vmDecal(g, "longshot", X - 0.0295, Y, -0.44, 0.14);
			muzzle.position.set(X, Y + 0.012, -1.15);
			break;
		}
		default: { // vulcan, the default rifle
			// Full rifle: stocked receiver with decal, railed handguard,
			// braked barrel, curved mag, reflex optic, angled foregrip.
			vmBox(g, 0.05, 0.075, 0.16, X, Y - 0.005, -0.20, TM.gripTex); // stock
			vmBox(g, 0.046, 0.03, 0.1, X, Y + 0.042, -0.21, VM_MATS.polymer); // cheek riser
			vmBox(g, 0.052, 0.09, 0.02, X, Y - 0.002, -0.115, VM_MATS.polymer); // buttpad
			vmBox(g, 0.056, 0.085, 0.30, X, Y, -0.40, TM.receiver); // receiver
			vmRail(g, X, Y + 0.05, -0.40, 0.28);
			vmBox(g, 0.03, 0.014, 0.03, X, Y + 0.045, -0.265, VM_MATS.mid); // charging handle
			vmBox(g, 0.004, 0.03, 0.07, X + 0.029, Y + 0.012, -0.42, VM_MATS.polymer); // ejection port
			vmBox(g, 0.058, 0.016, 0.12, X + 0.001, Y + 0.005, -0.40, VM_MATS.accent); // stripe
			vmBox(g, 0.05, 0.062, 0.24, X, Y + 0.002, -0.66, VM_MATS.dark); // handguard
			vmRail(g, X, Y + 0.04, -0.66, 0.22);
			vmRail(g, X, Y - 0.036, -0.66, 0.22);
			for (let i = 0; i < 3; i++) { // handguard vents
				vmBox(g, 0.004, 0.016, 0.03, X - 0.026, Y + 0.005, -0.58 - i * 0.07, VM_MATS.polymer);
			}
			vmBox(g, 0.032, 0.075, 0.038, X, Y - 0.068, -0.63, TM.gripTex, 0.35); // foregrip
			vmBox(g, 0.03, 0.045, 0.03, X, Y + 0.012, -0.775, VM_MATS.dark); // gas block
			vmBox(g, 0.006, 0.02, 0.006, X, Y + 0.042, -0.775, VM_MATS.steel); // front post
			vmCyl(g, 0.011, 0.011, 0.15, X, Y + 0.012, -0.795, VM_MATS.steel); // barrel
			vmBrake(g, X, Y + 0.012, -0.865, 0.019, 0.07);
			vmMag(g, X, Y - 0.045, -0.46, 0.15);
			vmGuard(g, X, Y - 0.062, -0.345, 0.026);
			vmBox(g, 0.036, 0.105, 0.042, X, Y - 0.095, -0.325, TM.gripTex, 0.3); // grip
			vmOptic(g, X, Y + 0.092, -0.44, 0.027, 0.06);
			vmDecal(g, "vulcan", X - 0.0295, Y, -0.40, 0.15);
			muzzle.position.set(X, Y + 0.012, -0.90);
			break;
		}
	}
	g.add(muzzle);
	return g;
}
