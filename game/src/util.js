// util.js - shared maths, the seeded RNG, temp objects and the collision
// mover every actor (player and bots alike) walks the world with.
// Nothing here allocates in a hot loop: temps are module-level and reused.

import * as THREE from "three";
import { CFG } from "./config.js";

// --- seeded RNG (mulberry32): same seed, same match -------------------------
export function rng(seed) {
	let a = seed >>> 0;
	return function next() {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function randRange(rand, min, max) {
	return min + rand() * (max - min);
}

export function randPick(rand, arr) {
	return arr[Math.floor(rand() * arr.length) % arr.length];
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg2rad = (d) => (d * Math.PI) / 180;
export const TAU = Math.PI * 2;

// Shortest-path angle lerp, angles in radians.
export function angleLerp(a, b, t) {
	let d = (b - a) % TAU;
	if (d > Math.PI) d -= TAU;
	if (d < -Math.PI) d += TAU;
	return a + d * t;
}

// Frame-rate independent exponential approach.
export function damp(cur, target, lambda, dt) {
	return lerp(cur, target, 1 - Math.exp(-lambda * dt));
}

// --- shared temps (never hold these across calls) ---------------------------
export const tmpV1 = new THREE.Vector3();
export const tmpV2 = new THREE.Vector3();
export const tmpV3 = new THREE.Vector3();
export const tmpV4 = new THREE.Vector3();
const tmpBox = new THREE.Box3();

// --- ray vs AABB (slab method) ----------------------------------------------
// Returns the entry distance along the ray, or Infinity when it misses.
// A ray starting inside the box returns 0.
export function rayVsAABB(origin, dir, box, maxT = Infinity) {
	let tmin = 0;
	let tmax = maxT;
	for (const axis of ["x", "y", "z"]) {
		const o = origin[axis];
		const d = dir[axis];
		if (Math.abs(d) < 1e-8) {
			if (o < box.min[axis] || o > box.max[axis]) return Infinity;
		} else {
			const inv = 1 / d;
			let t1 = (box.min[axis] - o) * inv;
			let t2 = (box.max[axis] - o) * inv;
			if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
			if (t1 > tmin) tmin = t1;
			if (t2 < tmax) tmax = t2;
			if (tmin > tmax) return Infinity;
		}
	}
	return tmin;
}

// Line-of-sight helper: true when nothing in `colliders` blocks origin→target.
export function hasLOS(origin, target, colliders) {
	tmpV1.subVectors(target, origin);
	const dist = tmpV1.length();
	if (dist < 0.001) return true;
	tmpV1.multiplyScalar(1 / dist);
	for (let i = 0; i < colliders.length; i++) {
		if (rayVsAABB(origin, tmpV1, colliders[i], dist) !== Infinity) return false;
	}
	return true;
}

// --- the actor mover ----------------------------------------------------------
// pos is the actor's FEET position. The actor is treated as an AABB of
// CFG.actorRadius half-extent and CFG.actorHeight height. Movement is resolved
// axis by axis (Y, then X, then Z) with a small step-up for curbs and stairs.
// vel is mutated when an axis is blocked. Returns { grounded, hitWall }.
const actorBox = new THREE.Box3();

function setActorBox(pos) {
	actorBox.min.set(pos.x - CFG.actorRadius, pos.y, pos.z - CFG.actorRadius);
	actorBox.max.set(pos.x + CFG.actorRadius, pos.y + CFG.actorHeight, pos.z + CFG.actorRadius);
}

function overlapsAny(pos, colliders) {
	setActorBox(pos);
	for (let i = 0; i < colliders.length; i++) {
		if (actorBox.intersectsBox(colliders[i])) return colliders[i];
	}
	return null;
}

export function slideMove(pos, vel, dt, colliders) {
	const out = { grounded: false, hitWall: false };
	const r = CFG.actorRadius;
	const h = CFG.actorHeight;

	// Y axis: gravity, landing, head bumps. A collider only counts as a
	// floor when the feet were at or above its top before this move, and
	// only as a ceiling when the head started below its base — a side
	// overlap with a tall wall must never teleport the actor onto its roof.
	const prevY = pos.y;
	pos.y += vel.y * dt;
	let hit = null;
	let landTop = -Infinity;
	let ceilBase = Infinity;
	setActorBox(pos);
	for (let i = 0; i < colliders.length; i++) {
		const c = colliders[i];
		if (!actorBox.intersectsBox(c)) continue;
		if (vel.y <= 0 && prevY >= c.max.y - 0.001 && c.max.y > landTop) { landTop = c.max.y; hit = c; }
		else if (vel.y > 0 && prevY + h <= c.min.y + 0.001 && c.min.y < ceilBase) { ceilBase = c.min.y; hit = c; }
	}
	if (hit) {
		if (vel.y <= 0) { pos.y = landTop; out.grounded = true; }
		else { pos.y = ceilBase - h; }
		vel.y = 0;
	} else if (vel.y <= 0) {
		// grounded also when standing exactly on a surface (within a hair)
		tmpBox.min.set(pos.x - r, pos.y - 0.02, pos.z - r);
		tmpBox.max.set(pos.x + r, pos.y + h, pos.z + r);
		for (let i = 0; i < colliders.length; i++) {
			if (tmpBox.intersectsBox(colliders[i]) && colliders[i].max.y <= pos.y + 0.02) {
				out.grounded = true;
				break;
			}
		}
	}

	// X axis, with step-up.
	pos.x += vel.x * dt;
	hit = overlapsAny(pos, colliders);
	if (hit) {
		const stepTop = hit.max.y;
		if (stepTop - pos.y <= CFG.stepHeight && stepTop > pos.y) {
			const oldY = pos.y;
			pos.y = stepTop;
			if (overlapsAny(pos, colliders)) {
				pos.y = oldY;
				pos.x = vel.x > 0 ? hit.min.x - r - 0.001 : hit.max.x + r + 0.001;
				out.hitWall = true;
			} else {
				out.grounded = true;
			}
		} else {
			pos.x = vel.x > 0 ? hit.min.x - r - 0.001 : hit.max.x + r + 0.001;
			out.hitWall = true;
		}
	}

	// Z axis, with step-up.
	pos.z += vel.z * dt;
	hit = overlapsAny(pos, colliders);
	if (hit) {
		const stepTop = hit.max.y;
		if (stepTop - pos.y <= CFG.stepHeight && stepTop > pos.y) {
			const oldY = pos.y;
			pos.y = stepTop;
			if (overlapsAny(pos, colliders)) {
				pos.y = oldY;
				pos.z = vel.z > 0 ? hit.min.z - r - 0.001 : hit.max.z + r + 0.001;
				out.hitWall = true;
			} else {
				out.grounded = true;
			}
		} else {
			pos.z = vel.z > 0 ? hit.min.z - r - 0.001 : hit.max.z + r + 0.001;
			out.hitWall = true;
		}
	}

	return out;
}
