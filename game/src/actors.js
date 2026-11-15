// actors.js - the physical soldier every combatant (player and bots) wears.
// createActor builds an articulated trooper - jointed arms and legs, vest
// with pouches, helmet with a glowing visor, a shaped rifle in the hands -
// and owns everything about the body: pose animation (walk cycle, aim
// blend, hit flinch, death), the hitboxes weapons test against, and
// damage resolution in applyDamage.
//
// Convention: an actor's feet sit at actor.pos, and the body faces
// (sin(yaw), 0, cos(yaw)) - local +Z is "forward" in every layout below.
// Hitboxes are derived from the same layout numbers setPose renders with,
// so what you see is exactly what can be shot.

import * as THREE from "three";
import { CFG } from "./config.js";
import { clamp, lerp, damp, rayVsAABB } from "./util.js";

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

// Box geometries are shared by every soldier (a size is a size), so they
// live in a module-level cache and are never disposed per-actor. Materials
// stay per-actor: the death fade drives opacity on them individually.
const _geoCache = new Map();
function boxGeo(w, h, d) {
	const key = w + "," + h + "," + d;
	let g = _geoCache.get(key);
	if (!g) {
		g = new THREE.BoxGeometry(w, h, d);
		_geoCache.set(key, g);
	}
	return g;
}

function box(w, h, d, mat) {
	const m = new THREE.Mesh(boxGeo(w, h, d), mat);
	m.castShadow = true;
	return m;
}

// One shared fabric-noise canvas, used as a bump map on the cloth and vest
// materials so flat team colours pick up a woven, worn read in the light.
let _fabricTex = null;
function fabricTexture() {
	if (_fabricTex) return _fabricTex;
	const cv = document.createElement("canvas");
	cv.width = 128;
	cv.height = 128;
	const g = cv.getContext("2d");
	g.fillStyle = "#7f7f7f";
	g.fillRect(0, 0, 128, 128);
	// Weave: alternating light/dark threads on a 2 px grid.
	for (let y = 0; y < 128; y += 2) {
		for (let x = 0; x < 128; x += 2) {
			const v = 108 + ((x + y) % 4 === 0 ? 26 : -14) + (Math.random() * 22 - 11);
			g.fillStyle = "rgb(" + (v | 0) + "," + (v | 0) + "," + (v | 0) + ")";
			g.fillRect(x, y, 2, 2);
		}
	}
	// Wear: a few darker scuffs and lighter rub patches.
	for (let i = 0; i < 260; i++) {
		const v = Math.random() < 0.5 ? 70 : 175;
		g.fillStyle = "rgba(" + v + "," + v + "," + v + ",0.16)";
		g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 5, 1 + Math.random() * 2);
	}
	const t = new THREE.CanvasTexture(cv);
	t.wrapS = THREE.RepeatWrapping;
	t.wrapT = THREE.RepeatWrapping;
	t.repeat.set(2, 2);
	_fabricTex = t;
	return t;
}

// Builds the soldier mesh for a team (0 Ember orange, 1 Guard teal).
// Returns the root group plus every moving part setPose animates. The
// same parts are mirrored to root.userData.parts for shot staging.
export function buildSoldier(team) {
	const teamColor = new THREE.Color(CFG.teamColors[team]);
	const fabric = fabricTexture();
	const mats = {
		suit: new THREE.MeshStandardMaterial({
			color: teamColor, roughness: 0.62, metalness: 0.18,
			bumpMap: fabric, bumpScale: 0.25,
		}),
		dark: new THREE.MeshStandardMaterial({
			color: 0x23262b, roughness: 0.68, metalness: 0.3,
			bumpMap: fabric, bumpScale: 0.15,
		}),
		vest: new THREE.MeshStandardMaterial({
			color: teamColor.clone().multiplyScalar(0.32), roughness: 0.92, metalness: 0.05,
			bumpMap: fabric, bumpScale: 0.45,
		}),
		visor: new THREE.MeshStandardMaterial({
			color: 0x0a0a0a, emissive: teamColor, emissiveIntensity: 2.4, roughness: 0.3,
		}),
		gunmetal: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.42, metalness: 0.65 }),
		steel: new THREE.MeshStandardMaterial({ color: 0x43484f, roughness: 0.3, metalness: 0.75 }),
		rubber: new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.95, metalness: 0.0 }),
	};
	const allMats = [mats.suit, mats.dark, mats.vest, mats.visor, mats.gunmetal, mats.steel, mats.rubber];

	const root = new THREE.Group();
	const body = new THREE.Group(); // pitches over on death; root stays put
	root.add(body);

	const lay = partLayout(0);

	// --- Legs: hip pivot -> thigh -> knee pivot -> shin + boot. --------
	function makeLeg(side) {
		const pivot = new THREE.Group();
		pivot.position.set(0.11 * side, lay.hipY, 0);
		const thigh = box(0.17, 0.46, 0.2, mats.dark);
		thigh.position.y = -0.22;
		const kneePad = box(0.15, 0.14, 0.05, mats.suit);
		kneePad.position.set(0, -0.42, 0.1);
		const knee = new THREE.Group();
		knee.position.y = -0.44;
		const shin = box(0.15, 0.42, 0.17, mats.dark);
		shin.position.y = -0.2;
		const boot = box(0.16, 0.1, 0.31, mats.rubber);
		boot.position.set(0, -0.435, 0.055);
		knee.add(shin, boot);
		pivot.add(thigh, kneePad, knee);
		body.add(pivot);
		return { pivot, knee };
	}
	const legLOut = makeLeg(-1);
	const legROut = makeLeg(1);
	const legL = legLOut.pivot, legR = legROut.pivot;
	const kneeL = legLOut.knee, kneeR = legROut.knee;

	// --- Pelvis: hips, belt and side pouches. ---------------------------
	const pelvis = new THREE.Group();
	pelvis.position.y = lay.hipY;
	const pelvisMesh = box(0.44, 0.24, 0.3, mats.dark);
	const belt = box(0.47, 0.07, 0.33, mats.vest);
	belt.position.y = 0.1;
	const hipPouchL = box(0.1, 0.14, 0.16, mats.vest);
	hipPouchL.position.set(-0.26, -0.02, 0);
	const hipPouchR = box(0.1, 0.14, 0.16, mats.vest);
	hipPouchR.position.set(0.26, -0.02, 0);
	pelvis.add(pelvisMesh, belt, hipPouchL, hipPouchR);
	body.add(pelvis);

	// --- Stomach: abdomen plate with a low front pouch. -----------------
	const stomach = new THREE.Group();
	stomach.position.y = lay.stomachY;
	const abdomen = box(0.45, 0.24, 0.29, mats.suit);
	const gutPouch = box(0.2, 0.12, 0.06, mats.vest);
	gutPouch.position.set(0, -0.03, 0.16);
	stomach.add(abdomen, gutPouch);
	body.add(stomach);

	// --- Torso: chest, vest plates, mag pouches, pack, team accents. ----
	const torso = new THREE.Group();
	torso.position.y = lay.chestY;
	const chest = box(0.54, 0.52, 0.34, mats.suit);
	const vestF = box(0.5, 0.44, 0.09, mats.vest);
	vestF.position.set(0, -0.02, 0.155);
	const vestB = box(0.5, 0.44, 0.09, mats.vest);
	vestB.position.set(0, -0.02, -0.155);
	const pack = box(0.4, 0.42, 0.13, mats.dark);
	pack.position.set(0, 0, -0.26);
	const collar = box(0.3, 0.09, 0.3, mats.dark);
	collar.position.y = 0.29;
	// Glowing team stripe across the chest - the Ember/Guard tell at range.
	const chestStripe = box(0.3, 0.05, 0.02, mats.visor);
	chestStripe.position.set(0, 0.14, 0.205);
	chestStripe.castShadow = false;
	torso.add(chest, vestF, vestB, pack, collar, chestStripe);
	for (let i = -1; i <= 1; i++) {
		const pouch = box(0.11, 0.15, 0.05, mats.dark);
		pouch.position.set(0.15 * i, -0.13, 0.215);
		torso.add(pouch);
	}
	// Team-coloured shoulder pads.
	for (const side of [-1, 1]) {
		const pad = box(0.2, 0.09, 0.26, mats.suit);
		pad.position.set(0.33 * side, 0.235, 0);
		torso.add(pad);
	}

	// --- Arms: shoulder pivot -> upper arm -> elbow pivot -> forearm. ---
	// Arms hang off the torso so the flinch and sway carry the gun too.
	function makeArm(side) {
		const pivot = new THREE.Group();
		pivot.position.set(0.345 * side, 0.21, 0);
		const upper = box(0.15, 0.32, 0.16, mats.suit);
		upper.position.y = -0.15;
		const elbow = new THREE.Group();
		elbow.position.y = -0.31;
		const forearm = box(0.13, 0.3, 0.14, mats.dark);
		forearm.position.y = -0.14;
		const glove = box(0.13, 0.11, 0.16, mats.rubber);
		glove.position.set(0, -0.315, 0.01);
		elbow.add(forearm, glove);
		pivot.add(upper, elbow);
		torso.add(pivot);
		return { pivot, elbow };
	}
	const armLOut = makeArm(-1);
	const armROut = makeArm(1);
	const armL = armLOut.pivot, armR = armROut.pivot;
	const elbowL = armLOut.elbow, elbowR = armROut.elbow;

	// --- Rifle in the right hand: receiver, handguard, barrel, muzzle,
	// magazine, grip, stock, sight post with a glowing dot, team stripe.
	const gun = new THREE.Group();
	const receiver = box(0.075, 0.13, 0.44, mats.gunmetal);
	receiver.position.set(0, 0.05, 0.02);
	const handguard = box(0.065, 0.095, 0.24, mats.steel);
	handguard.position.set(0, 0.045, 0.33);
	const barrel = box(0.04, 0.04, 0.2, mats.steel);
	barrel.position.set(0, 0.06, 0.53);
	const muzzle = box(0.055, 0.055, 0.07, mats.gunmetal);
	muzzle.position.set(0, 0.06, 0.64);
	const mag = box(0.05, 0.17, 0.09, mats.steel);
	mag.position.set(0, -0.06, 0.1);
	mag.rotation.x = 0.18;
	const grip = box(0.05, 0.13, 0.06, mats.rubber);
	grip.position.set(0, -0.05, -0.1);
	grip.rotation.x = -0.35;
	const stock = box(0.06, 0.11, 0.2, mats.gunmetal);
	stock.position.set(0, 0.03, -0.28);
	const sightPost = box(0.03, 0.06, 0.03, mats.steel);
	sightPost.position.set(0, 0.145, 0.12);
	const sightDot = box(0.02, 0.02, 0.02, mats.visor);
	sightDot.position.set(0, 0.15, 0.12);
	sightDot.castShadow = false;
	const gunStripe = box(0.082, 0.04, 0.2, mats.visor);
	gunStripe.position.set(0, 0.02, 0.02);
	gunStripe.castShadow = false;
	gun.add(receiver, handguard, barrel, muzzle, mag, grip, stock, sightPost, sightDot, gunStripe);
	gun.position.set(0, -0.33, 0.05);
	gun.rotation.x = 0.06;
	elbowR.add(gun);

	// --- Head: neck, jaw, helmet shell with brim, glowing visor strip,
	// team stripe over the crown, and the bolt-on plate shown when the
	// actor bought a helmet (the `helmet` part setPose toggles).
	const head = new THREE.Group();
	head.position.y = lay.headY;
	const neck = box(0.17, 0.14, 0.17, mats.dark);
	neck.position.y = -0.25;
	const jaw = box(0.27, 0.13, 0.29, mats.dark);
	jaw.position.y = -0.13;
	const shell = box(0.38, 0.3, 0.39, mats.dark);
	shell.position.y = 0.04;
	const brim = box(0.43, 0.05, 0.45, mats.dark);
	brim.position.y = 0.13;
	const visor = box(0.31, 0.075, 0.03, mats.visor);
	visor.position.set(0, 0.02, 0.2);
	visor.castShadow = false;
	const crownStripe = box(0.1, 0.02, 0.4, mats.suit);
	crownStripe.position.y = 0.2;
	const helmet = box(0.41, 0.13, 0.42, mats.vest);
	helmet.position.y = 0.16;
	helmet.visible = false;
	head.add(neck, jaw, shell, brim, visor, crownStripe, helmet);
	body.add(head);

	const parts = {
		root, body, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR,
		torso, stomach, pelvis, head, helmet, gun,
		mats: allMats,
	};
	// Shot-staging contract: main.js poses/inspects the soldier from here.
	root.userData.parts = {
		torso, head, armL, armR, legL, legR, gun, kneeL, kneeR, elbowL, elbowR,
	};
	return parts;
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
		// cosmetic pose state, owned by setPose only: aim blend (0 carry,
		// 1 shouldered), seconds of combat awareness left, hit-flinch
		// timer, last hp seen (flinch trigger) and a breathing clock.
		_aim01: 0,
		_combatT: 0,
		_flinchT: 0,
		_lastHp: 100,
		_poseT: Math.random() * 6.28,

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

		// Advances the body's animation: syncs the mesh to pos/yaw, runs
		// the walk cycle, blends between carry and aim poses, plays the
		// hit flinch and the death fall.
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
				// Settle the pose as it falls: bob drains out, the torso
				// relaxes and the limbs go slack.
				p.body.position.y *= 0.7;
				p.torso.rotation.x *= 0.8;
				p.armR.rotation.x = -0.3;
				p.armL.rotation.x = -0.15;
				p.armL.rotation.y = 0;
				p.elbowR.rotation.x = -0.2;
				p.elbowL.rotation.x = -0.3;
				p.kneeL.rotation.x = 0.25;
				p.kneeR.rotation.x = 0.1;
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
			const phase = actor._walkPhase;
			const swing = Math.sin(phase) * 0.55 * stride;
			actor._poseT += dt;

			// --- combat awareness -> aim blend -------------------------
			// Firing spikes recoilPitch (weapons.js decays it in ~45 ms),
			// so a live value means "shot just now". Taking damage is the
			// other trigger, watched via the hp delta - and it also fires
			// the flinch. Neither changes any damage behaviour.
			if (actor.recoilPitch !== undefined && actor.recoilPitch > 0.004) {
				actor._combatT = Math.max(actor._combatT, 1.6);
			}
			if (actor.hp < actor._lastHp) {
				actor._flinchT = Math.min(0.26, 0.14 + (actor._lastHp - actor.hp) * 0.004);
				actor._combatT = 3;
			}
			actor._lastHp = actor.hp;
			actor._combatT = Math.max(0, actor._combatT - dt);
			let aimTarget;
			if (actor.isPlayer || actor._combatT > 0) aimTarget = 1;
			else aimTarget = speed > 0.4 ? 0.3 : 0.55; // patrol low-ready / held ready
			actor._aim01 = damp(actor._aim01, aimTarget, 9, dt);
			const aim01 = actor._aim01;

			// --- hit flinch: a fast torso kick that eases out -----------
			if (actor._flinchT > 0) actor._flinchT = Math.max(0, actor._flinchT - dt);
			const fl = actor._flinchT / 0.26;
			const flinch = fl * fl;

			// --- legs: walk cycle, folded into the crouch ---------------
			const walk = 1 - c;
			p.legL.position.y = lay.hipY;
			p.legR.position.y = lay.hipY;
			p.legL.rotation.x = swing * walk - 0.85 * c;
			p.legR.rotation.x = -swing * walk + 0.45 * c;
			p.kneeL.rotation.x = (1 - Math.cos(phase)) * 0.45 * stride * walk + 1.92 * c;
			p.kneeR.rotation.x = (1 - Math.cos(phase + Math.PI)) * 0.45 * stride * walk + 2.2 * c;
			p.pelvis.position.y = lay.hipY;
			p.stomach.position.y = lay.stomachY;

			// --- body bob, breathing and sway ---------------------------
			const bob = (0.5 - 0.5 * Math.cos(2 * phase)) * 0.05 * stride * walk;
			const breath = Math.sin(actor._poseT * 1.7) * 0.006 * (1 - stride);
			p.body.position.y = bob + breath;
			p.body.rotation.x = 0;

			// --- torso: layout height, sway, flinch ---------------------
			p.torso.position.y = lay.chestY;
			p.torso.rotation.x = -0.32 * flinch;
			p.torso.rotation.z = Math.sin(phase) * 0.035 * stride;
			p.torso.rotation.y = Math.sin(phase) * 0.06 * stride * (1 - aim01 * 0.7);

			// --- head: follows the aim pitch, kicked by the flinch ------
			p.head.position.y = lay.headY;
			p.head.rotation.x = -actor.pitch * 0.6 - 0.3 * flinch;

			// --- arms: carry <-> aim blend. The right arm shoulders the
			// rifle; the left swings in to brace the handguard. Off-aim,
			// both counter-swing gently against the stride.
			const shoulderAim = -Math.PI / 2 + actor.pitch;
			p.armR.rotation.x = lerp(-0.5, shoulderAim, aim01) + swing * 0.18 * (1 - aim01);
			p.armR.rotation.y = lerp(0.03, -0.06, aim01);
			p.elbowR.rotation.x = lerp(-0.7, -0.14, aim01);
			p.armL.rotation.x = lerp(-0.45, shoulderAim * 0.94 + 0.18, aim01) - swing * 0.3 * (1 - aim01);
			p.armL.rotation.y = lerp(0.1, 0.48, aim01);
			p.elbowL.rotation.x = lerp(-0.55, -0.38, aim01);

			p.helmet.visible = actor.helmet;
		},

		dispose() {
			if (actor.mesh.parent) actor.mesh.parent.remove(actor.mesh);
			actor.mesh.traverse((o) => {
				// Geometries come from the shared cache - only the
				// per-actor materials are this soldier's to free.
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
