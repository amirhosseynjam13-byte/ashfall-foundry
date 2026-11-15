// effects.js - all transient visuals: tracers, impact bursts, muzzle flash,
// explosions, smoke grenade clouds, shell casings and camera shake.
// Everything is pooled at creation time; update() allocates nothing, it only
// advances ages and rewrites pre-allocated buffers/matrices.
//
// Smoke clouds register themselves in the exposed `smokes` array as
// { pos, radius, t } spheres (t = seconds of life left, radius grows over the
// first second). Bot vision and line-of-sight checks read that array to treat
// a live cloud as opaque. The array identity never changes - entries are
// swap-removed in place.

import * as THREE from "three";
import { GRENADES } from "./config.js";
import { clamp } from "./util.js";

// --- procedural sprite textures (no assets) --------------------------------
function glowTexture() {
	const c = document.createElement("canvas");
	c.width = c.height = 128;
	const g = c.getContext("2d");
	const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
	grad.addColorStop(0, "rgba(255,255,255,1)");
	grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
	grad.addColorStop(1, "rgba(255,255,255,0)");
	g.fillStyle = grad;
	g.fillRect(0, 0, 128, 128);
	return new THREE.CanvasTexture(c);
}

function smokeTexture() {
	const c = document.createElement("canvas");
	c.width = c.height = 128;
	const g = c.getContext("2d");
	// Overlapping soft blobs read as a puff instead of a clean disc.
	for (let i = 0; i < 26; i++) {
		const x = 24 + Math.random() * 80;
		const y = 24 + Math.random() * 80;
		const r = 14 + Math.random() * 26;
		const grad = g.createRadialGradient(x, y, 1, x, y, r);
		grad.addColorStop(0, "rgba(255,255,255,0.16)");
		grad.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = grad;
		g.fillRect(0, 0, 128, 128);
	}
	return new THREE.CanvasTexture(c);
}

function dotTexture() {
	const c = document.createElement("canvas");
	c.width = c.height = 32;
	const g = c.getContext("2d");
	const grad = g.createRadialGradient(16, 16, 1, 16, 16, 16);
	grad.addColorStop(0, "rgba(255,255,255,1)");
	grad.addColorStop(0.5, "rgba(255,255,255,0.8)");
	grad.addColorStop(1, "rgba(255,255,255,0)");
	g.fillStyle = grad;
	g.fillRect(0, 0, 32, 32);
	return new THREE.CanvasTexture(c);
}

const UP = new THREE.Vector3(0, 1, 0);

export function createEffects(scene) {
	const glowTex = glowTexture();
	const smokeTex = smokeTexture();
	const dotTex = dotTexture();

	// --- tracers: additive lines with a 60 ms fade ---------------------------
	const TRACER_COUNT = 48;
	const tracers = [];
	let tracerCursor = 0;
	for (let i = 0; i < TRACER_COUNT; i++) {
		const geo = new THREE.BufferGeometry();
		const arr = new Float32Array(6);
		geo.setAttribute("position", new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
		const mat = new THREE.LineBasicMaterial({
			color: 0xffffff, transparent: true, opacity: 0,
			blending: THREE.AdditiveBlending, depthWrite: false,
		});
		const line = new THREE.Line(geo, mat);
		line.frustumCulled = false;
		line.visible = false;
		scene.add(line);
		tracers.push({ line, arr, mat, t: 0 });
	}

	function tracer(a, b, color) {
		const tr = tracers[tracerCursor];
		tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
		tr.arr[0] = a.x; tr.arr[1] = a.y; tr.arr[2] = a.z;
		tr.arr[3] = b.x; tr.arr[4] = b.y; tr.arr[5] = b.z;
		tr.line.geometry.attributes.position.needsUpdate = true;
		tr.mat.color.set(color);
		tr.mat.opacity = 0.85;
		tr.line.visible = true;
		tr.t = 0.06;
	}

	// --- particle bursts: one Points cloud per burst, pooled ------------------
	const BURST_COUNT = 28;
	const BURST_POINTS = 14;
	const bursts = [];
	for (let i = 0; i < BURST_COUNT; i++) {
		const geo = new THREE.BufferGeometry();
		const pos = new Float32Array(BURST_POINTS * 3);
		geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
		const mat = new THREE.PointsMaterial({
			size: 0.085, map: dotTex, transparent: true, opacity: 0,
			blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff,
		});
		const points = new THREE.Points(geo, mat);
		points.frustumCulled = false;
		points.visible = false;
		scene.add(points);
		bursts.push({
			points, mat, pos, vel: new Float32Array(BURST_POINTS * 3),
			t: 0, life: 0.3, gravity: 0,
		});
	}
	let burstCursor = 0;

	function spawnBurst(point, normal, color, speed, life, gravity, size) {
		const b = bursts[burstCursor];
		burstCursor = (burstCursor + 1) % BURST_COUNT;
		for (let i = 0; i < BURST_POINTS; i++) {
			const j = i * 3;
			b.pos[j] = point.x; b.pos[j + 1] = point.y; b.pos[j + 2] = point.z;
			// Random cone around the surface normal.
			b.vel[j] = normal.x + (Math.random() - 0.5) * 1.6;
			b.vel[j + 1] = normal.y + (Math.random() - 0.5) * 1.6;
			b.vel[j + 2] = normal.z + (Math.random() - 0.5) * 1.6;
			const s = speed * (0.35 + Math.random() * 0.85);
			b.vel[j] *= s; b.vel[j + 1] *= s; b.vel[j + 2] *= s;
		}
		b.points.geometry.attributes.position.needsUpdate = true;
		b.mat.color.set(color);
		b.mat.size = size;
		b.mat.opacity = 1;
		b.points.visible = true;
		b.t = life;
		b.life = life;
		b.gravity = gravity;
	}

	// --- small glow flashes (impacts, hits): pooled sprites -------------------
	const FLASH_COUNT = 10;
	const flashes = [];
	for (let i = 0; i < FLASH_COUNT; i++) {
		const mat = new THREE.SpriteMaterial({
			map: glowTex, transparent: true, opacity: 0,
			blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff,
		});
		const sprite = new THREE.Sprite(mat);
		sprite.visible = false;
		scene.add(sprite);
		flashes.push({ sprite, mat, t: 0, life: 0.08 });
	}
	let flashCursor = 0;

	function flash(point, color, scale, life = 0.08) {
		const f = flashes[flashCursor];
		flashCursor = (flashCursor + 1) % FLASH_COUNT;
		f.sprite.position.copy(point);
		f.sprite.scale.set(scale, scale, 1);
		f.mat.color.set(color);
		f.mat.opacity = 0.95;
		f.sprite.visible = true;
		f.t = life;
		f.life = life;
	}

	// kind: "metal" (bright sparks, default - the foundry is steel) or "dust"
	// (slow tan puff for the ground and soft surfaces).
	function impact(point, normal, kind) {
		if (kind === "dust") {
			spawnBurst(point, normal, 0x9a8a76, 1.1, 0.5, -1.2, 0.16);
		} else {
			spawnBurst(point, normal, 0xffc37a, 4.2, 0.3, -5, 0.07);
			flash(point, 0xffa050, 0.35);
		}
	}

	// Bloodless hit feedback on an actor: hot ember sparks, no gore.
	function hitSpark(point) {
		spawnBurst(point, UP, 0xff5a33, 2.1, 0.32, -3, 0.09);
		flash(point, 0xff6a3d, 0.42);
	}

	// --- muzzle flash: one shared sprite + light, retriggered per shot -------
	const muzzleMat = new THREE.SpriteMaterial({
		map: glowTex, color: 0xffb066, transparent: true, opacity: 0,
		blending: THREE.AdditiveBlending, depthWrite: false,
	});
	const muzzleSprite = new THREE.Sprite(muzzleMat);
	muzzleSprite.visible = false;
	scene.add(muzzleSprite);
	const muzzleLight = new THREE.PointLight(0xff9a4d, 0, 11, 1.8);
	scene.add(muzzleLight);
	let muzzleT = 0;

	const muzzlePos = new THREE.Vector3();
	function muzzle(pos, dir) {
		muzzlePos.copy(pos).addScaledVector(dir, 0.25);
		muzzleSprite.position.copy(muzzlePos);
		const s = 0.5 + Math.random() * 0.25;
		muzzleSprite.scale.set(s, s, 1);
		muzzleMat.opacity = 1;
		muzzleSprite.visible = true;
		muzzleLight.position.copy(muzzlePos);
		muzzleLight.intensity = 30;
		muzzleT = 0.04; // the flash lives 40 ms, per the gunplay spec
	}

	// --- explosions: fireball sprites + light + a rising smoke column --------
	const EXP_COUNT = 3;
	const explosions = [];
	for (let i = 0; i < EXP_COUNT; i++) {
		const group = new THREE.Group();
		group.visible = false;
		scene.add(group);
		const fire = [];
		for (let j = 0; j < 8; j++) {
			const m = new THREE.SpriteMaterial({
				map: glowTex, color: j % 2 ? 0xff7a26 : 0xffc37a, transparent: true,
				opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
			});
			const s = new THREE.Sprite(m);
			group.add(s);
			fire.push({ s, m, ox: 0, oy: 0, oz: 0, grow: 0 });
		}
		const smoke = [];
		for (let j = 0; j < 6; j++) {
			const m = new THREE.SpriteMaterial({
				map: smokeTex, color: 0x4a423c, transparent: true, opacity: 0, depthWrite: false,
			});
			const s = new THREE.Sprite(m);
			group.add(s);
			smoke.push({ s, m, ox: 0, oz: 0, rise: 0, delay: 0 });
		}
		const light = new THREE.PointLight(0xff8a3d, 0, 26, 1.6);
		group.add(light);
		explosions.push({ group, fire, smoke, light, t: 0 });
	}
	let expCursor = 0;

	function explosion(pos) {
		const e = explosions[expCursor];
		expCursor = (expCursor + 1) % EXP_COUNT;
		e.group.position.copy(pos);
		e.group.visible = true;
		e.t = 2.8;
		for (const f of e.fire) {
			f.ox = (Math.random() - 0.5) * 1.6;
			f.oy = Math.random() * 1.2;
			f.oz = (Math.random() - 0.5) * 1.6;
			f.grow = 5 + Math.random() * 4;
		}
		for (const s of e.smoke) {
			s.ox = (Math.random() - 0.5) * 1.4;
			s.oz = (Math.random() - 0.5) * 1.4;
			s.rise = 2.2 + Math.random() * 1.6;
			s.delay = Math.random() * 0.25;
		}
		shake(0.55);
	}

	// --- smoke grenade clouds ---------------------------------------------------
	const CLOUD_COUNT = 4;
	const CLOUD_SPRITES = 12;
	const clouds = [];
	for (let i = 0; i < CLOUD_COUNT; i++) {
		const sprites = [];
		for (let j = 0; j < CLOUD_SPRITES; j++) {
			const m = new THREE.SpriteMaterial({
				map: smokeTex, color: 0xb9bcbe, transparent: true, opacity: 0, depthWrite: false,
			});
			const s = new THREE.Sprite(m);
			s.visible = false;
			scene.add(s);
			sprites.push({ s, m, ox: 0, oy: 0, oz: 0, scale: 1 });
		}
		clouds.push({ sprites, active: false, age: 0, entry: null });
	}
	let cloudCursor = 0;
	const smokes = []; // live vision-blocking spheres, read by bots/LOS checks

	function smokePuff(pos) {
		const cloud = clouds[cloudCursor];
		cloudCursor = (cloudCursor + 1) % CLOUD_COUNT;
		if (cloud.entry) { // recycled cloud: drop its stale registry entry
			const idx = smokes.indexOf(cloud.entry);
			if (idx !== -1) { smokes[idx] = smokes[smokes.length - 1]; smokes.pop(); }
			cloud.entry = null;
		}
		const radius = GRENADES.smoke.radius;
		for (const p of cloud.sprites) {
			const a = Math.random() * Math.PI * 2;
			const r = Math.random() * radius * 0.55;
			p.ox = Math.cos(a) * r;
			p.oz = Math.sin(a) * r;
			p.oy = 0.5 + Math.random() * 1.7;
			p.scale = radius * (0.9 + Math.random() * 0.7);
			p.s.position.set(pos.x + p.ox, pos.y + p.oy, pos.z + p.oz);
			p.s.visible = true;
		}
		cloud.active = true;
		cloud.age = 0;
		cloud.entry = { pos: pos.clone(), radius: 0.4, t: GRENADES.smoke.duration };
		smokes.push(cloud.entry);
	}

	// --- shell casings: one InstancedMesh, pooled matrices ---------------------
	const CASE_COUNT = 96;
	const caseMesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(0.014, 0.014, 0.028),
		new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.35 }),
		CASE_COUNT,
	);
	caseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	caseMesh.frustumCulled = false;
	scene.add(caseMesh);
	const caseDummy = new THREE.Object3D();
	const caseHidden = new THREE.Matrix4().makeScale(0, 0, 0);
	const casings = [];
	for (let i = 0; i < CASE_COUNT; i++) {
		casings.push({
			pos: new THREE.Vector3(), vel: new THREE.Vector3(),
			axis: new THREE.Vector3(1, 0, 0), ang: 0, spin: 0, t: 0,
		});
		caseMesh.setMatrixAt(i, caseHidden);
	}
	let caseCursor = 0;
	const caseRight = new THREE.Vector3();

	function casing(pos, dir) {
		const c = casings[caseCursor];
		caseCursor = (caseCursor + 1) % CASE_COUNT;
		c.pos.copy(pos);
		caseRight.crossVectors(dir, UP).normalize();
		c.vel.copy(caseRight).multiplyScalar(1.1 + Math.random() * 0.5);
		c.vel.y = 1.5 + Math.random() * 0.6;
		c.vel.addScaledVector(dir, 0.3);
		c.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
		c.ang = Math.random() * Math.PI;
		c.spin = 9 + Math.random() * 10;
		c.t = 1.2;
	}

	// --- camera shake: trauma accumulates, offset is a shared vector -----------
	let trauma = 0;
	let time = 0;
	const shakeOffset = new THREE.Vector3();

	function shake(amount) {
		trauma = Math.min(1.3, trauma + amount);
		return shakeOffset;
	}

	// --- per-frame advance -------------------------------------------------------
	function update(dt) {
		time += dt;

		for (const tr of tracers) {
			if (tr.t <= 0) continue;
			tr.t -= dt;
			tr.mat.opacity = Math.max(0, tr.t / 0.06) * 0.85;
			if (tr.t <= 0) tr.line.visible = false;
		}

		for (const b of bursts) {
			if (b.t <= 0) continue;
			b.t -= dt;
			if (b.t <= 0) { b.points.visible = false; b.mat.opacity = 0; continue; }
			for (let i = 0; i < BURST_POINTS; i++) {
				const j = i * 3;
				b.vel[j + 1] += b.gravity * dt;
				b.pos[j] += b.vel[j] * dt;
				b.pos[j + 1] += b.vel[j + 1] * dt;
				b.pos[j + 2] += b.vel[j + 2] * dt;
			}
			b.points.geometry.attributes.position.needsUpdate = true;
			b.mat.opacity = b.t / b.life;
		}

		for (const f of flashes) {
			if (f.t <= 0) continue;
			f.t -= dt;
			f.mat.opacity = Math.max(0, f.t / f.life) * 0.95;
			if (f.t <= 0) f.sprite.visible = false;
		}

		if (muzzleT > 0) {
			muzzleT -= dt;
			if (muzzleT <= 0) {
				muzzleMat.opacity = 0;
				muzzleSprite.visible = false;
				muzzleLight.intensity = 0;
			}
		}

		for (const e of explosions) {
			if (e.t <= 0) continue;
			e.t -= dt;
			const age = 2.8 - e.t;
			if (e.t <= 0) { e.group.visible = false; e.light.intensity = 0; continue; }
			const fireK = clamp(age / 0.35, 0, 1);
			for (const f of e.fire) {
				const sc = 1.2 + f.grow * fireK;
				f.s.position.set(f.ox, f.oy + age * 1.4, f.oz);
				f.s.scale.set(sc, sc, 1);
				f.m.opacity = (1 - fireK) * 0.95;
			}
			e.light.intensity = (1 - fireK) * 90;
			for (const s of e.smoke) {
				const sa = Math.max(0, age - s.delay);
				const sc = 2 + sa * 1.5;
				s.s.position.set(s.ox, 0.8 + sa * s.rise, s.oz);
				s.s.scale.set(sc, sc, 1);
				s.m.opacity = clamp(sa * 2, 0, 0.5) * clamp(e.t / 1.2, 0, 1);
			}
		}

		for (const cloud of clouds) {
			if (!cloud.active) continue;
			cloud.age += dt;
			const entry = cloud.entry;
			entry.t -= dt;
			const growK = clamp(cloud.age / 1.1, 0, 1);
			entry.radius = 0.4 + (GRENADES.smoke.radius - 0.4) * growK;
			const fade = clamp(entry.t / 1.4, 0, 1) * growK;
			for (const p of cloud.sprites) {
				const sc = p.scale * (0.5 + growK * 0.7);
				p.s.scale.set(sc, sc, 1);
				p.m.opacity = 0.52 * fade;
			}
			if (entry.t <= 0) {
				cloud.active = false;
				cloud.entry = null;
				const idx = smokes.indexOf(entry);
				if (idx !== -1) { smokes[idx] = smokes[smokes.length - 1]; smokes.pop(); }
				for (const p of cloud.sprites) p.s.visible = false;
			}
		}

		let caseDirty = false;
		for (let i = 0; i < CASE_COUNT; i++) {
			const c = casings[i];
			if (c.t <= 0) continue;
			c.t -= dt;
			caseDirty = true;
			if (c.t <= 0) { caseMesh.setMatrixAt(i, caseHidden); continue; }
			c.vel.y -= 9.8 * dt;
			c.pos.addScaledVector(c.vel, dt);
			if (c.pos.y < 0.03) { // floor bounce, then rest
				c.pos.y = 0.03;
				c.vel.y = Math.abs(c.vel.y) > 0.8 ? -c.vel.y * 0.35 : 0;
				c.vel.x *= 0.7; c.vel.z *= 0.7;
				if (c.vel.y === 0) c.spin = 0;
			}
			c.ang += c.spin * dt;
			caseDummy.position.copy(c.pos);
			caseDummy.quaternion.setFromAxisAngle(c.axis, c.ang);
			caseDummy.updateMatrix();
			caseMesh.setMatrixAt(i, caseDummy.matrix);
		}
		if (caseDirty) caseMesh.instanceMatrix.needsUpdate = true;

		if (trauma > 0) {
			trauma = Math.max(0, trauma - dt * 1.7);
			const s = trauma * trauma * 0.32;
			shakeOffset.set(
				Math.sin(time * 127.1) * s,
				Math.sin(time * 143.7 + 1.3) * s,
				Math.sin(time * 99.3 + 2.1) * s * 0.6,
			);
		} else {
			shakeOffset.set(0, 0, 0);
		}
	}

	return {
		tracer, impact, muzzle, explosion, smokePuff, casing, update,
		shake, hitSpark, smokes, shakeOffset,
	};
}
