// weather.js - STORM SEASON: dynamic weather (dusk / rain / snow), rain streaks, snowfall, wet and snow states.
import * as THREE from "three";

export const WEATHER_MODES = ["dusk", "rain", "snow"];

const MODES = {
	dusk: {
		fog: 0x4a3428, fogNear: 45, fogFar: 120, sky: 0xffffff,
		sun: 0xff8c3a, sunI: 2.1, hemiSky: 0x3d7a80, hemiGnd: 0x201612,
		hemiI: 0.85, exposure: 1.12, sunSprite: 1.0,
		groundRough: 0.95, groundCol: 0xffffff, apron: 0x8a8a8a,
		puddleRough: 0.15, puddleEnv: 1.6, wallMul: 1.0,
		shaft: 0.05, caps: false,
	},
	rain: {
		fog: 0x39434e, fogNear: 36, fogFar: 104, sky: 0x93a3b1,
		sun: 0xaebfd0, sunI: 1.0, hemiSky: 0x5a6d7d, hemiGnd: 0x1c1a17,
		hemiI: 0.8, exposure: 1.08, sunSprite: 0.0,
		groundRough: 0.45, groundCol: 0xc9d2da, apron: 0x666c72,
		puddleRough: 0.06, puddleEnv: 2.4, wallMul: 0.85,
		shaft: 0.15, caps: false,
	},
	snow: {
		fog: 0x8fa3b5, fogNear: 40, fogFar: 115, sky: 0xd7e3ee,
		skyRGB: [1.3, 1.42, 1.55], groundRGB: [1.22, 1.28, 1.36],
		sun: 0xe8eef4, sunI: 1.55, hemiSky: 0x9db8c8, hemiGnd: 0x35322c,
		hemiI: 1.05, exposure: 1.12, sunSprite: 0.3,
		groundRough: 0.9, groundCol: 0xffffff, apron: 0xa8b2ba,
		puddleRough: 0.3, puddleEnv: 1.2, wallMul: 1.0,
		shaft: 0.11, caps: true,
	},
};

function flakeTexture() {
	const c = document.createElement("canvas");
	c.width = 64; c.height = 64;
	const ctx = c.getContext("2d");
	const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
	g.addColorStop(0, "rgba(255,255,255,1)");
	g.addColorStop(0.4, "rgba(255,255,255,0.7)");
	g.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 64, 64);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function streakTexture() {
	const c = document.createElement("canvas");
	c.width = 16; c.height = 64;
	const ctx = c.getContext("2d");
	const g = ctx.createLinearGradient(0, 0, 0, 64);
	g.addColorStop(0, "rgba(255,255,255,0)");
	g.addColorStop(0.5, "rgba(255,255,255,0.85)");
	g.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = g;
	ctx.fillRect(7, 0, 2, 64);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function makeCloud(count, mat) {
	const pos = new Float32Array(count * 3);
	const speed = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		pos[i * 3] = (Math.random() - 0.5) * 70;
		pos[i * 3 + 1] = Math.random() * 42;
		pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
		speed[i] = 0.75 + Math.random() * 0.5;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	const points = new THREE.Points(geo, mat);
	points.frustumCulled = false;
	points.visible = false;
	return { points, pos, speed, count };
}

export function createWeather(scene, renderer, env) {
	const group = new THREE.Group();
	scene.add(group);

	const rain = makeCloud(1500, new THREE.PointsMaterial({
		map: streakTexture(), color: 0xa8c0d4, size: 0.9, sizeAttenuation: true,
		transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
		depthWrite: false,
	}));
	group.add(rain.points);
	const snow = makeCloud(1200, new THREE.PointsMaterial({
		map: flakeTexture(), color: 0xffffff, size: 0.22, sizeAttenuation: true,
		transparent: true, opacity: 0.95, depthWrite: false,
	}));
	group.add(snow.points);

	let mode = "dusk";
	let elapsed = 0;

	function setMode(next) {
		if (!MODES[next]) next = "dusk";
		mode = next;
		const m = MODES[next];
		scene.fog.color.setHex(m.fog);
		scene.fog.near = m.fogNear;
		scene.fog.far = m.fogFar;

		if (m.skyRGB) env.skyMat.color.setRGB(...m.skyRGB);
		else env.skyMat.color.setHex(m.sky);
		env.sun.color.setHex(m.sun);
		env.sun.intensity = m.sunI;
		env.hemi.color.setHex(m.hemiSky);
		env.hemi.groundColor.setHex(m.hemiGnd);
		env.hemi.intensity = m.hemiI;
		renderer.toneMappingExposure = m.exposure;
		env.sunSpriteMat.opacity = m.sunSprite;
		env.groundMat.roughness = m.groundRough;
		if (m.groundRGB) env.groundMat.color.setRGB(...m.groundRGB);
		else env.groundMat.color.setHex(m.groundCol);
		env.apronMat.color.setHex(m.apron);
		env.puddleMat.roughness = m.puddleRough;
		env.puddleMat.envMapIntensity = m.puddleEnv;
		for (const w of env.wallMats) w.mat.color.copy(w.base).multiplyScalar(m.wallMul);
		for (const s of env.shaftMats) s.opacity = m.shaft;
		env.snowCaps.visible = m.caps;
		rain.points.visible = next === "rain";
		snow.points.visible = next === "snow";
	}

	function update(dt, cameraPos) {
		elapsed += dt;
		group.position.set(cameraPos.x, 0, cameraPos.z);
		if (mode === "rain") {
			const p = rain.pos;
			for (let i = 0; i < rain.count; i++) {
				let y = p[i * 3 + 1] - 26 * rain.speed[i] * dt;
				if (y < 0) y += 42;
				p[i * 3 + 1] = y;
				let x = p[i * 3] + 4.5 * dt;
				if (x > 35) x -= 70;
				p[i * 3] = x;
			}
			rain.points.geometry.attributes.position.needsUpdate = true;
		} else if (mode === "snow") {
			const p = snow.pos;
			for (let i = 0; i < snow.count; i++) {
				let y = p[i * 3 + 1] - 1.6 * snow.speed[i] * dt;
				if (y < 0) y += 42;
				p[i * 3 + 1] = y;
				p[i * 3] += Math.sin(elapsed * 0.8 + i * 1.7) * 0.35 * dt;
			}
			snow.points.geometry.attributes.position.needsUpdate = true;
		}
	}

	return {
		setMode,
		update,
		get mode() { return mode; },
	};
}
