// actors.js - the physical soldier every combatant (player and bots) wears.
// createActor builds a stylised low-poly trooper from boxes - team-coloured
// torso, dark vest, glowing visor - and owns everything about the body:
// pose animation (walk swing, crouch, death), the hitboxes weapons test
// against, and damage resolution in applyDamage.
//
// Convention: an actor's feet sit at actor.pos, and the body faces
// (sin(yaw), 0, cos(yaw)) - local +Z is "forward" in every layout below.
// Hitboxes are derived from the same layout numbers setPose renders with,
// so what you see is exactly what can be shot.

import * as THREE from "three";
import { CFG } from "./config.js";
import { clamp, lerp, rayVsAABB } from "./util.js";

const UP = new THREE.Vector3(0, 1, 0);
const HEAD_RADIUS = 0.24;

// Scratch objects for hit tests - per shot, never per frame, but still reused.
const _lo = new THREE.Vector3(); // ray origin in actor-local space
const _ld = new THREE.Vector3(); // ray direction in actor-local space
const _box = new THREE.Box3();
const _hitPoint = new THREE.Vector3();

// Body layout as a function of crouch (0 = standing, 1 = fully crouched).
// All heights are metres above the feet. setPose places the meshes from
// these numbers and hitTest builds its boxes from them too.
function partLayout(c) {
	return {
		hipY: lerp(0.92, 0.52, c),
		headY: lerp(1.54, 1.06, c),
		chestY: lerp(1.18, 0.82, c),
		stomachY: lerp(0.85, 0.6, c),
		legY: lerp(0.44, 0.26, c),
		legHalf: lerp(0.44, 0.26, c),
	};
}

function box(w, h, d, mat) {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
	m.castShadow = true;
	return m;
}

// Builds the soldier mesh for a team (0 Ember orange, 1 Guard teal).
// Returns the root group plus the moving parts setPose animates.
export function buildSoldier(team) {
	const teamColor = new THREE.Color(CFG.teamColors[team]);
	const mats = {
		suit: new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.55, metalness: 0.3 }),
		dark: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.35 }),
		vest: new THREE.MeshStandardMaterial({
			color: teamColor.clone().multiplyScalar(0.32), roughness: 0.85, metalness: 0.1,
		}),
		visor: new THREE.MeshStandardMaterial({
			color: 0x0a0a0a, emissive: teamColor, emissiveIntensity: 2.4, roughness: 0.3,
		}),
	};
	const allMats = [mats.suit, mats.dark, mats.vest, mats.visor];

	const root = new THREE.Group();
	const body = new THREE.Group(); // pitches over on death; root stays put
	root.add(body);

	const lay = partLayout(0);

	// Legs swing from hip pivots; the mesh hangs below the pivot.
	function makeLeg(side) {
		const pivot = new THREE.Group();
		pivot.position.set(0.11 * side, lay.hipY, 0);
		const leg = box(0.19, 0.88, 0.21, mats.dark);
		leg.position.y = -0.44;
		const boot = box(0.2, 0.12, 0.3, mats.vest);
		boot.position.set(0, -0.84, 0.04);
		pivot.add(leg, boot);
		body.add(pivot);
		return pivot;
	}
	const legL = makeLeg(-1);
	const legR = makeLeg(1);

	// Pelvis and stomach.
	const pelvis = box(0.46, 0.22, 0.3, mats.dark);
	pelvis.position.y = lay.hipY;
	body.add(pelvis);
	const stomach = box(0.48, 0.26, 0.3, mats.suit);
	stomach.position.y = lay.stomachY;
	body.add(stomach);

	// Chest: team-coloured torso with a darker vest plate front and back.
	const torso = new THREE.Group();
	torso.position.y = lay.chestY;
	const chest = box(0.54, 0.52, 0.34, mats.suit);
	const vestF = box(0.5, 0.42, 0.08, mats.vest);
	vestF.position.z = 0.16;
	const vestB = box(0.5, 0.42, 0.08, mats.vest);
	vestB.position.z = -0.16;
	torso.add(chest, vestF, vestB);
	body.add(torso);

	// Head: helmet shell, glowing visor strip facing +Z, optional helmet
	// plate (the extra armour layer - shown when the actor bought a helmet).
	const head = new THREE.Group();
	head.position.y = lay.headY;
	const skull = box(0.36, 0.38, 0.36, mats.dark);
	const visor = box(0.3, 0.07, 0.03, mats.visor);
	visor.position.set(0, 0.02, 0.18);
	visor.castShadow = false;
	const helmet = box(0.42, 0.16, 0.42, mats.vest);
	helmet.position.y = 0.2;
	helmet.visible = false;
	head.add(skull, visor, helmet);
	body.add(head);

	// Arms from shoulder pivots. The right arm carries the gun and aims
	// forward; the left arm braces it. Both hang off the torso height.
	function makeArm(side) {
		const pivot = new THREE.Group();
		pivot.position.set(0.34 * side, lay.chestY + 0.2, 0);
		const arm = box(0.14, 0.62, 0.15, mats.suit);
		arm.position.y = -0.31;
		pivot.add(arm);
		body.add(pivot);
		return pivot;
	}
	const armL = makeArm(-1);
	const armR = makeArm(1);

	// Gun prop in the right hand: receiver, barrel, team stripe.
	const gun = new THREE.Group();
	const receiver = box(0.08, 0.12, 0.52, mats.dark);
	const barrel = box(0.05, 0.05, 0.3, mats.dark);
	barrel.position.set(0, 0.03, 0.38);
	const stripe = box(0.085, 0.04, 0.2, mats.visor);
	stripe.position.set(0, -0.05, 0.05);
	stripe.castShadow = false;
	gun.add(receiver, barrel, stripe);
	gun.position.set(0, -0.6, 0.08);
	armR.add(gun);

	return {
		root, body, legL, legR, armL, armR, torso, stomach, pelvis, head, helmet,
		mats: allMats,
	};
}

// Creates one combatant. Spawning (placing pos, giving weapons) is the
// match's job; the actor starts alive at the origin, standing, unarmoured.
export function createActor(team, name, isPlayer) {
	const parts = buildSoldier(team);

	const actor = {
		team,
		name,
		isPlayer: !!isPlayer,
		hp: 100,
		armor: 0, // armour points; bought armour sets this to 100
		helmet: false,
		alive: true,
		pos: new THREE.Vector3(),
		vel: new THREE.Vector3(),
		yaw: 0,
		pitch: 0,
		crouch01: 0,
		mesh: parts.root,
		head: parts.head,
		// scoreboard / economy state, owned here so every system reads one copy
		money: CFG.startMoney,
		kills: 0,
		deaths: 0,
		// combat memory applyDamage maintains for the bot brains
		lastAttacker: null,
		lastDamageAt: -Infinity,

		_parts: parts,
		_walkPhase: 0,
		_deathT: 0,
		_faded: false,

		// Tests a world-space ray against this body's hitboxes.
		// Returns the nearest { part, dist, point } or null.
		hitTest(origin, dir) {
			if (!actor.alive) return null;
			// Bring the ray into actor-local space (rigid transform, so the
			// distances we solve for are world distances too).
			_lo.subVectors(origin, actor.pos).applyAxisAngle(UP, -actor.yaw);
			_ld.copy(dir).applyAxisAngle(UP, -actor.yaw);
			const lay = partLayout(actor.crouch01);
			let bestT = Infinity;
			let bestPart = null;

			// Head: a sphere.
			{
				const ox = _lo.x, oy = _lo.y - lay.headY, oz = _lo.z;
				const b = ox * _ld.x + oy * _ld.y + oz * _ld.z;
				const c = ox * ox + oy * oy + oz * oz - HEAD_RADIUS * HEAD_RADIUS;
				const disc = b * b - c;
				if (disc >= 0) {
					let t = -b - Math.sqrt(disc);
					if (t < 0) t = -b + Math.sqrt(disc);
					if (t >= 0 && t < bestT) { bestT = t; bestPart = "head"; }
				}
			}
			// Chest, stomach and legs: boxes from the layout.
			const boxes = [
				["chest", 0, lay.chestY, 0, 0.27, 0.26, 0.17],
				["stomach", 0, lay.stomachY, 0, 0.24, 0.13, 0.15],
				["leg", -0.11, lay.legY, 0, 0.1, lay.legHalf, 0.11],
				["leg", 0.11, lay.legY, 0, 0.1, lay.legHalf, 0.11],
			];
			for (let i = 0; i < boxes.length; i++) {
				const bx = boxes[i];
				_box.min.set(bx[1] - bx[4], bx[2] - bx[5], bx[3] - bx[6]);
				_box.max.set(bx[1] + bx[4], bx[2] + bx[5], bx[3] + bx[6]);
				const t = rayVsAABB(_lo, _ld, _box);
				if (t < bestT) { bestT = t; bestPart = bx[0]; }
			}
			if (bestPart === null) return null;
			_hitPoint.copy(dir).multiplyScalar(bestT).add(origin);
			return { part: bestPart, dist: bestT, point: _hitPoint.clone() };
		},

		// Advances the body's animation: syncs the mesh to pos/yaw, swings
		// the limbs with speed, settles into the crouch, plays the death fall.
		setPose(dt) {
			const p = actor._parts;
			actor.mesh.position.copy(actor.pos);
			// The soldier geometry faces local +Z; the shared world convention
			// is -Z forward (three.js YXZ), hence the half-turn.
			actor.mesh.rotation.y = actor.yaw + Math.PI;

			if (!actor.alive) {
				// Fall backwards over ~0.45 s, then ghost to 35% opacity
				// after 4 s so corpses read as out of the fight.
				actor._deathT += dt;
				const fall = clamp(actor._deathT / 0.45, 0, 1);
				p.body.rotation.x = -1.5 * (1 - (1 - fall) * (1 - fall));
				if (actor._deathT > 4) {
					if (!actor._faded) {
						actor._faded = true;
						for (const m of p.mats) m.transparent = true;
					}
					const o = 1 - 0.65 * clamp((actor._deathT - 4) / 1, 0, 1);
					for (const m of p.mats) m.opacity = o;
				}
				return;
			}

			const c = actor.crouch01;
			const lay = partLayout(c);
			const speed = Math.hypot(actor.vel.x, actor.vel.z);
			const stride = clamp(speed / CFG.speedRun, 0, 1);
			actor._walkPhase += dt * (2.2 + speed * 1.6) * (speed > 0.1 ? 1 : 0);
			const swing = Math.sin(actor._walkPhase) * 0.55 * stride;
			const bend = 0.85 * c; // crouch folds the legs

			p.legL.position.y = lay.hipY;
			p.legR.position.y = lay.hipY;
			p.legL.rotation.x = swing + bend;
			p.legR.rotation.x = -swing - bend * 0.55;
			p.pelvis.position.y = lay.hipY;
			p.stomach.position.y = lay.stomachY;
			p.torso.position.y = lay.chestY;
			p.head.position.y = lay.headY;
			p.head.rotation.x = -actor.pitch * 0.6;

			// Arms hold the gun up toward the aim direction; a whisper of
			// counter-swing keeps them alive while moving.
			const aim = -Math.PI / 2 + actor.pitch;
			p.armR.rotation.x = aim - swing * 0.12;
			p.armL.rotation.x = aim * 0.92 + swing * 0.12;
			p.armL.rotation.y = 0.35;
			p.armR.position.y = lay.chestY + 0.2;
			p.armL.position.y = lay.chestY + 0.2;

			p.helmet.visible = actor.helmet;
			p.body.rotation.x = 0;
		},

		dispose() {
			if (actor.mesh.parent) actor.mesh.parent.remove(actor.mesh);
			actor.mesh.traverse((o) => {
				if (o.geometry) o.geometry.dispose();
				if (o.material) o.material.dispose();
			});
		},
	};

	return actor;
}

// Resolves one hit against a target. rawDmg is the weapon's damage AFTER
// range falloff (the caller - weapons or a grenade - owns falloff); this
// applies the body-part multiplier and armour, drains armour points, and
// handles death bookkeeping. Returns the damage actually dealt.
export function applyDamage(G, target, rawDmg, part, attacker) {
	if (!target || !target.alive || rawDmg <= 0) return 0;

	// rawDmg arrives FINAL pre-armor: weapons.js has already applied the
	// hit-location multiplier and range falloff. Only armour resolves here.
	let dmg = rawDmg;

	// Armour covers the head only with a helmet; everything else needs
	// armour points. It halves the damage, and the armour itself loses
	// half of what it prevented.
	const covered = part === "head" ? target.helmet && target.armor > 0 : target.armor > 0;
	if (covered) {
		const prevented = dmg * (1 - CFG.armorFactor);
		target.armor = Math.max(0, target.armor - prevented * 0.5);
		dmg -= prevented;
	}

	target.hp -= dmg;
	if (attacker && attacker !== target) {
		target.lastAttacker = attacker;
		target.lastDamageAt = G && typeof G.simTime === "number" ? G.simTime
			: G && typeof G.time === "number" ? G.time : 0;
	}

	if (target.hp <= 0) {
		target.hp = 0;
		target.alive = false;
		target._deathT = 0;
		target.deaths += 1;
		if (attacker && attacker !== target) attacker.kills += 1;
		if (G && typeof G.onKill === "function") G.onKill(attacker, target, part);
	}
	return dmg;
}
