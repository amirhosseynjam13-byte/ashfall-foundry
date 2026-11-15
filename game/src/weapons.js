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
// Low-poly first-person guns from boxes and cylinders: dark gunmetal with a
// molten-orange accent stripe. The group origin is the camera; the gun hangs
// low-right and points down -Z. userData.muzzle marks the barrel tip so the
// owner can anchor flashes. Bots use actors.js gun props, not these.

const VM_MATS = {
	dark: new THREE.MeshStandardMaterial({ color: 0x2e3236, metalness: 0.7, roughness: 0.45 }),
	mid: new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.6, roughness: 0.5 }),
	grip: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, metalness: 0.1, roughness: 0.9 }),
	accent: new THREE.MeshStandardMaterial({ color: 0xff7a26, emissive: 0xa63e00, metalness: 0.3, roughness: 0.4 }),
	lens: new THREE.MeshStandardMaterial({ color: 0x66d9e8, emissive: 0x1d5f6e, metalness: 0.2, roughness: 0.2 }),
};

function vmBox(parent, w, h, d, x, y, z, mat = VM_MATS.dark, rx = 0) {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
	mesh.position.set(x, y, z);
	mesh.rotation.x = rx;
	parent.add(mesh);
	return mesh;
}

function vmBarrel(parent, r, len, x, y, z, mat = VM_MATS.mid) {
	const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
	mesh.rotation.x = Math.PI / 2;
	mesh.position.set(x, y, z);
	parent.add(mesh);
	return mesh;
}

export function buildViewmodel(id) {
	const g = new THREE.Group();
	const muzzle = new THREE.Object3D();
	g.userData.muzzle = muzzle;
	const X = 0.17, Y = -0.16; // low-right of the camera
	switch (id) {
		case "knife": {
			vmBox(g, 0.03, 0.11, 0.04, X, Y - 0.03, -0.3, VM_MATS.grip, 0.5);
			vmBox(g, 0.008, 0.03, 0.26, X, Y + 0.03, -0.44, VM_MATS.mid);
			muzzle.position.set(X, Y + 0.03, -0.58);
			break;
		}
		case "p9": {
			vmBox(g, 0.045, 0.05, 0.2, X, Y, -0.4, VM_MATS.dark);
			vmBox(g, 0.04, 0.035, 0.16, X, Y - 0.045, -0.38, VM_MATS.mid);
			vmBox(g, 0.038, 0.11, 0.045, X, Y - 0.1, -0.31, VM_MATS.grip, 0.28);
			vmBox(g, 0.012, 0.02, 0.012, X, Y + 0.035, -0.48, VM_MATS.accent);
			muzzle.position.set(X, Y + 0.01, -0.51);
			break;
		}
		case "mule": {
			vmBox(g, 0.055, 0.07, 0.3, X, Y, -0.42, VM_MATS.dark);
			vmBarrel(g, 0.017, 0.44, X, Y + 0.025, -0.68);
			vmBox(g, 0.045, 0.04, 0.13, X, Y - 0.015, -0.6, VM_MATS.grip);
			vmBox(g, 0.05, 0.06, 0.14, X, Y - 0.02, -0.2, VM_MATS.grip, -0.18);
			muzzle.position.set(X, Y + 0.025, -0.91);
			break;
		}
		case "raptor": {
			vmBox(g, 0.05, 0.09, 0.34, X, Y, -0.42, VM_MATS.dark);
			vmBarrel(g, 0.021, 0.15, X, Y + 0.01, -0.65, VM_MATS.mid);
			vmBox(g, 0.04, 0.13, 0.05, X, Y - 0.11, -0.42, VM_MATS.mid, 0.22);
			vmBox(g, 0.045, 0.05, 0.12, X, Y - 0.03, -0.2, VM_MATS.grip, -0.15);
			vmBox(g, 0.056, 0.012, 0.2, X, Y + 0.055, -0.44, VM_MATS.mid);
			vmBox(g, 0.058, 0.02, 0.1, X + 0.001, Y, -0.42, VM_MATS.accent);
			muzzle.position.set(X, Y + 0.01, -0.74);
			break;
		}
		case "longshot": {
			vmBox(g, 0.055, 0.08, 0.34, X, Y, -0.44, VM_MATS.dark);
			vmBarrel(g, 0.013, 0.56, X, Y + 0.015, -0.86);
			vmBarrel(g, 0.026, 0.17, X, Y + 0.085, -0.46, VM_MATS.dark);
			vmBox(g, 0.02, 0.02, 0.02, X, Y + 0.085, -0.545, VM_MATS.lens);
			vmBox(g, 0.04, 0.12, 0.05, X, Y - 0.1, -0.4, VM_MATS.mid, 0.18);
			vmBox(g, 0.05, 0.07, 0.18, X, Y - 0.03, -0.18, VM_MATS.grip, -0.2);
			vmBox(g, 0.058, 0.02, 0.12, X + 0.001, Y, -0.44, VM_MATS.accent);
			muzzle.position.set(X, Y + 0.015, -1.15);
			break;
		}
		default: { // vulcan, the default rifle
			vmBox(g, 0.055, 0.08, 0.36, X, Y, -0.44, VM_MATS.dark);
			vmBarrel(g, 0.013, 0.3, X, Y + 0.015, -0.74);
			vmBox(g, 0.048, 0.05, 0.2, X, Y + 0.005, -0.62, VM_MATS.mid);
			vmBox(g, 0.02, 0.035, 0.16, X, Y + 0.06, -0.46, VM_MATS.dark);
			vmBox(g, 0.04, 0.13, 0.05, X, Y - 0.105, -0.44, VM_MATS.mid, 0.15);
			vmBox(g, 0.038, 0.1, 0.04, X, Y - 0.09, -0.33, VM_MATS.grip, 0.3);
			vmBox(g, 0.05, 0.06, 0.13, X, Y - 0.02, -0.21, VM_MATS.grip, -0.15);
			vmBox(g, 0.058, 0.02, 0.12, X + 0.001, Y, -0.44, VM_MATS.accent);
			muzzle.position.set(X, Y + 0.015, -0.9);
			break;
		}
	}
	g.add(muzzle);
	return g;
}
