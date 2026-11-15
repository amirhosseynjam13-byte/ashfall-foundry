import * as THREE from "three";
import { GRENADES } from "./config.js";
import { clamp } from "./util.js";

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

function flashTexture() {
	const c = document.createElement("canvas");
	c.width = c.height = 128;
	const g = c.getContext("2d");
	g.translate(64, 64);
	for (let i = 0; i < 4; i++) {
		const grad = g.createLinearGradient(0, 0, 62, 0);
		grad.addColorStop(0, "rgba(255,255,255,0.95)");
		grad.addColorStop(0.4, "rgba(255,255,255,0.45)");
		grad.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = grad;
		g.beginPath();
		g.moveTo(0, -8);
		g.lineTo(62, 0);
		g.lineTo(0, 8);
		g.closePath();
		g.fill();
		g.rotate(Math.PI / 2);
	}
	const core = g.createRadialGradient(0, 0, 1, 0, 0, 30);
	core.addColorStop(0, "rgba(255,255,255,1)");
	core.addColorStop(0.5, "rgba(255,255,255,0.6)");
	core.addColorStop(1, "rgba(255,255,255,0)");
	g.fillStyle = core;
	g.fillRect(-30, -30, 60, 60);
	return new THREE.CanvasTexture(c);
}

const UP = new THREE.Vector3(0, 1, 0);

export function createEffects(scene) {
	const glowTex = glowTexture();
	const smokeTex = smokeTexture();
	const dotTex = dotTexture();
	const flashTex = flashTexture();

	const TRACER_COUNT = 48;
	const TRACER_LIFE = 0.06;
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
		const headMat = new THREE.SpriteMaterial({
			map: glowTex, color: 0xffffff, transparent: true, opacity: 0,
			blending: THREE.AdditiveBlending, depthWrite: false,
		});
		const head = new THREE.Sprite(headMat);
		head.scale.set(0.17, 0.17, 1);
		head.visible = false;
		scene.add(head);
		tracers.push({
			line, arr, mat, head, headMat, t: 0,
			from: new THREE.Vector3(), to: new THREE.Vector3(),
		});
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
		tr.from.copy(a);
		tr.to.copy(b);
		tr.head.position.copy(a);
		tr.headMat.color.set(color);
		tr.headMat.opacity = 0.9;
		tr.head.visible = true;
		tr.t = TRACER_LIFE;
	}

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

	const PUFF_COUNT = 18;
	const PUFF_POINTS = 9;
	const puffs = [];
	for (let i = 0; i < PUFF_COUNT; i++) {
		const geo = new THREE.BufferGeometry();
		const pos = new Float32Array(PUFF_POINTS * 3);
		geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
		const mat = new THREE.PointsMaterial({
			size: 0.2, map: smokeTex, transparent: true, opacity: 0,
			depthWrite: false, color: 0xffffff,
		});
		const points = new THREE.Points(geo, mat);
		points.frustumCulled = false;
		points.visible = false;
		scene.add(points);
		puffs.push({
			points, mat, pos, vel: new Float32Array(PUFF_POINTS * 3),
			t: 0, life: 0.5, size: 0.2, grow: 0.5, baseOpacity: 0.4,
		});
	}
	let puffCursor = 0;

	function spawnPuff(point, normal, color, size, life, opacity, spread = 0.6, rise = 0.4, grow = 0.55) {
		const p = puffs[puffCursor];
		puffCursor = (puffCursor + 1) % PUFF_COUNT;
		for (let i = 0; i < PUFF_POINTS; i++) {
			const j = i * 3;
			p.pos[j] = point.x + (Math.random() - 0.5) * 0.08;
			p.pos[j + 1] = point.y + (Math.random() - 0.5) * 0.08;
			p.pos[j + 2] = point.z + (Math.random() - 0.5) * 0.08;
			p.vel[j] = normal.x * spread * (0.3 + Math.random() * 0.7) + (Math.random() - 0.5) * 0.35;
			p.vel[j + 1] = normal.y * spread * (0.3 + Math.random() * 0.7) + rise * (0.4 + Math.random() * 0.6);
			p.vel[j + 2] = normal.z * spread * (0.3 + Math.random() * 0.7) + (Math.random() - 0.5) * 0.35;
		}
		p.points.geometry.attributes.position.needsUpdate = true;
		p.mat.color.set(color);
		p.mat.size = size;
		p.mat.opacity = opacity;
		p.points.visible = true;
		p.t = life;
		p.life = life;
		p.size = size;
		p.grow = grow;
		p.baseOpacity = opacity;
	}

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

	function impact(point, normal, kind) {
		if (kind === "dust") {
			spawnPuff(point, normal, 0xa5937c, 0.24, 0.55, 0.5, 0.7, 0.35);
			spawnBurst(point, normal, 0xb8a888, 1.4, 0.4, -2.5, 0.1);
		} else {
			spawnBurst(point, normal, 0xffd9a0, 4.6, 0.28, -6, 0.065);
			spawnBurst(point, normal, 0xff8a3d, 1.8, 0.42, -2, 0.1);
			flash(point, 0xffa050, 0.35);
			spawnPuff(point, normal, 0x8a8378, 0.15, 0.4, 0.26, 0.4, 0.5);
		}
	}

	function hitSpark(point) {
		spawnBurst(point, UP, 0xff5a33, 2.1, 0.32, -3, 0.09);
		flash(point, 0xff6a3d, 0.42);
		spawnPuff(point, UP, 0x9a7a68, 0.14, 0.35, 0.3, 0.5, 0.6);
	}

	const MUZZLE_LIFE = 0.05;
	const muzzleMat = new THREE.SpriteMaterial({
		map: glowTex, color: 0xffb066, transparent: true, opacity: 0,
		blending: THREE.AdditiveBlending, depthWrite: false,
	});
	const muzzleSprite = new THREE.Sprite(muzzleMat);
	muzzleSprite.visible = false;
	scene.add(muzzleSprite);
	const muzzleSpikeMat = new THREE.SpriteMaterial({
		map: flashTex, color: 0xffc37a, transparent: true, opacity: 0,
		blending: THREE.AdditiveBlending, depthWrite: false,
	});
	const muzzleSpike = new THREE.Sprite(muzzleSpikeMat);
	muzzleSpike.visible = false;
	scene.add(muzzleSpike);
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
		muzzleSpike.position.copy(muzzlePos).addScaledVector(dir, 0.12);
		const ss = 0.75 + Math.random() * 0.35;
		muzzleSpike.scale.set(ss, ss, 1);
		muzzleSpikeMat.rotation = Math.random() * Math.PI;
		muzzleSpikeMat.opacity = 0.95;
		muzzleSpike.visible = true;
		muzzleLight.position.copy(muzzlePos);
		muzzleLight.intensity = 30;
		muzzleT = MUZZLE_LIFE;

		spawnPuff(muzzlePos, dir, 0x9aa0a2, 0.1, 0.45, 0.15, 0.8, 0.35, 0.35);
	}

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

		spawnPuff(pos, UP, 0x8a7a66, 0.85, 0.9, 0.38, 2.4, 0.7, 1.6);
		shake(0.55);
	}

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
	const smokes = [];

	function smokePuff(pos) {
		const cloud = clouds[cloudCursor];
		cloudCursor = (cloudCursor + 1) % CLOUD_COUNT;
		if (cloud.entry) {
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

	const CASE_COUNT = 96;
	const caseMesh = new THREE.InstancedMesh(
		new THREE.CylinderGeometry(0.0075, 0.0085, 0.03, 8),
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

	let trauma = 0;
	let time = 0;
	const shakeOffset = new THREE.Vector3();

	function shake(amount) {
		trauma = Math.min(1.3, trauma + amount);
		return shakeOffset;
	}

	function update(dt) {
		time += dt;

		for (const tr of tracers) {
			if (tr.t <= 0) continue;
			tr.t -= dt;
			const k = Math.max(0, tr.t / TRACER_LIFE);
			tr.mat.opacity = k * 0.85;
			tr.head.position.lerpVectors(tr.from, tr.to, 1 - k);
			tr.headMat.opacity = k * 0.9;
			if (tr.t <= 0) { tr.line.visible = false; tr.head.visible = false; }
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

		for (const p of puffs) {
			if (p.t <= 0) continue;
			p.t -= dt;
			if (p.t <= 0) { p.points.visible = false; p.mat.opacity = 0; continue; }
			const drag = Math.max(0, 1 - 1.9 * dt);
			for (let i = 0; i < PUFF_POINTS; i++) {
				const j = i * 3;
				p.vel[j] *= drag; p.vel[j + 1] *= drag; p.vel[j + 2] *= drag;
				p.pos[j] += p.vel[j] * dt;
				p.pos[j + 1] += p.vel[j + 1] * dt;
				p.pos[j + 2] += p.vel[j + 2] * dt;
			}
			p.points.geometry.attributes.position.needsUpdate = true;
			const age = p.life - p.t;
			p.mat.size = p.size + p.grow * age;
			p.mat.opacity = p.baseOpacity * clamp(p.t / (p.life * 0.6), 0, 1);
		}

		for (const f of flashes) {
			if (f.t <= 0) continue;
			f.t -= dt;
			f.mat.opacity = Math.max(0, f.t / f.life) * 0.95;
			if (f.t <= 0) f.sprite.visible = false;
		}

		if (muzzleT > 0) {
			muzzleT -= dt;
			const k = Math.max(0, muzzleT / MUZZLE_LIFE);
			muzzleMat.opacity = k;
			muzzleSpikeMat.opacity = k * 0.95;

			muzzleLight.intensity = 30 * k * (0.72 + Math.random() * 0.28);
			if (muzzleT <= 0) {
				muzzleMat.opacity = 0;
				muzzleSprite.visible = false;
				muzzleSpikeMat.opacity = 0;
				muzzleSpike.visible = false;
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
			if (c.pos.y < 0.03) {
				c.pos.y = 0.03;
				c.vel.y = Math.abs(c.vel.y) > 0.8 ? -c.vel.y * 0.35 : 0;
				c.vel.x *= 0.7; c.vel.z *= 0.7;
				if (c.vel.y === 0) c.spin = 0;
			}
			c.ang += c.spin * dt;
			caseDummy.position.copy(c.pos);
			caseDummy.quaternion.setFromAxisAngle(c.axis, c.ang);

			const fadeK = c.t < 0.25 ? Math.max(0.001, c.t / 0.25) : 1;
			caseDummy.scale.set(fadeK, fadeK, fadeK);
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
