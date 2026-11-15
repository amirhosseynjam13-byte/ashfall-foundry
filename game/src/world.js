// world.js - the Ashfall Foundry map: geometry, collision, lights, sites, the waypoint graph, dressing.
import * as THREE from "three";
import {
	asphaltTexture,
	barrelTexture,
	concreteTexture,
	corrugatedTexture,
	crateTexture,
	diamondPlateTexture,
	glowTexture,
	groundTexture,
	hazardTexture,
	signTexture,
	siteLetterTexture,
	skyTexture,
	smokeTexture,
	surfaceMaterial,
	wallTexture,
} from "./textures.js";

const WALL_H = 4.2;
const DECK_Y = 2.6;
const COVER_MIN = 0.8;
const COVER_MAX = 1.6;

export function buildWorld(scene) {
	const colliders = [];
	const coverBoxes = [];

	const env = { wallMats: [], shaftMats: [] };

	const wallTex = wallTexture();
	wallTex.repeat.set(2, 1.4);
	const corrTex = corrugatedTexture();
	corrTex.repeat.set(3, 1.3);
	const matWall = surfaceMaterial(corrTex, { roughness: 0.6, metalness: 0.55, bumpScale: 0.7 });
	const matWallWarm = surfaceMaterial(wallTex, { color: 0xe6c9ac, roughness: 0.8, metalness: 0.3, bumpScale: 0.35 });
	const matWallCool = surfaceMaterial(corrTex, { color: 0x9fc3cc, roughness: 0.6, metalness: 0.55, bumpScale: 0.7 });
	const concTex = concreteTexture();
	concTex.repeat.set(2, 2);
	const matConcrete = surfaceMaterial(concTex, { color: 0xbdbdbd, roughness: 0.95, metalness: 0, bumpScale: 0.25 });
	const tunTex = concreteTexture();
	tunTex.repeat.set(16, 1);
	const matTunnel = surfaceMaterial(tunTex, { color: 0x6f6f6f, roughness: 0.95, metalness: 0, bumpScale: 0.2 });
	const matCrate = surfaceMaterial(crateTexture(), { roughness: 0.9, metalness: 0, bumpScale: 0.3 });
	const plateTex = diamondPlateTexture();
	plateTex.repeat.set(24, 2);
	const matPlate = surfaceMaterial(plateTex, { roughness: 0.5, metalness: 0.7, bumpScale: 0.5 });
	const barrelTex = barrelTexture();
	const matBarrel = surfaceMaterial(barrelTex, { roughness: 0.8, metalness: 0.35, bumpScale: 0.3 });
	const matBarrelSteel = surfaceMaterial(barrelTex, { color: 0xaebfca, roughness: 0.65, metalness: 0.5, bumpScale: 0.3 });
	const matFurnace = surfaceMaterial(wallTex, { color: 0x77644e, roughness: 0.85, metalness: 0.3, bumpScale: 0.35 });
	const matDark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.7, metalness: 0.5 });
	const matMetal = new THREE.MeshStandardMaterial({ color: 0x49505a, roughness: 0.45, metalness: 0.75 });
	const matPipe = new THREE.MeshStandardMaterial({ color: 0x767d84, roughness: 0.4, metalness: 0.8 });
	const matRust = new THREE.MeshStandardMaterial({ color: 0x74502e, roughness: 0.95, metalness: 0.1 });
	const hzTex = hazardTexture();
	hzTex.repeat.set(4, 1);
	const matHazard = new THREE.MeshStandardMaterial({ map: hzTex, roughness: 0.9 });
	const matCore = new THREE.MeshStandardMaterial({ color: 0x1a0d06, emissive: 0xff6a1e, emissiveIntensity: 2.0, roughness: 0.6 });
	const matMolten = new THREE.MeshStandardMaterial({ color: 0x140a05, emissive: 0xff7d22, emissiveIntensity: 2.4, roughness: 0.8 });
	const matBulb = new THREE.MeshStandardMaterial({ color: 0x201409, emissive: 0xffb36b, emissiveIntensity: 2.4 });
	const matBeacon = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2a1a, emissiveIntensity: 0.2 });

	const matSilhouette = new THREE.MeshBasicMaterial({ color: 0x0e1218 });
	const matShade = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide });

	const matPuddle = new THREE.MeshStandardMaterial({
		color: 0x141a20, metalness: 0.9, roughness: 0.15, envMapIntensity: 1.6,
		transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -2,
	});
	env.puddleMat = matPuddle;
	env.wallMats.push(
		{ mat: matWall, base: new THREE.Color(0xffffff) },
		{ mat: matWallWarm, base: new THREE.Color(0xe6c9ac) },
		{ mat: matWallCool, base: new THREE.Color(0x9fc3cc) },
	);

	const bulbGeo = new THREE.SphereGeometry(0.09, 8, 8);
	const shadeGeo = new THREE.CylinderGeometry(0.07, 0.24, 0.2, 12, 1, true);
	const glowTex = glowTexture();
	const lampGlowMat = new THREE.SpriteMaterial({
		map: glowTex, color: 0xffc98a, transparent: true, opacity: 0.38,
		blending: THREE.AdditiveBlending, depthWrite: false,
	});

	const unitBox = new THREE.BoxGeometry(1, 1, 1);

	function solid(cx, y0, cz, w, h, d, mat, opts = {}) {
		const mesh = new THREE.Mesh(unitBox, mat);
		mesh.scale.set(w, h, d);
		mesh.position.set(cx, y0 + h / 2, cz);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		scene.add(mesh);
		if (opts.collide !== false) {
			const box = new THREE.Box3(
				new THREE.Vector3(cx - w / 2, y0, cz - d / 2),
				new THREE.Vector3(cx + w / 2, y0 + h, cz + d / 2),
			);
			colliders.push(box);

			const isCover = opts.cover === true ||
				(opts.cover !== false && h >= COVER_MIN && h <= COVER_MAX && w >= 0.8 && d >= 0.4);
			if (isCover) coverBoxes.push(box);
		}
		return mesh;
	}

	function cyl(cx, y0, cz, rTop, rBottom, h, mat, seg = 16) {
		const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat);
		mesh.position.set(cx, y0 + h / 2, cz);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		scene.add(mesh);
		const r = Math.max(rTop, rBottom);
		colliders.push(new THREE.Box3(
			new THREE.Vector3(cx - r, y0, cz - r),
			new THREE.Vector3(cx + r, y0 + h, cz + r),
		));
		return mesh;
	}

	function pipeX(cx, cy, cz, r, len, mat) {
		const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
		mesh.rotation.z = Math.PI / 2;
		mesh.position.set(cx, cy, cz);
		mesh.castShadow = true;
		scene.add(mesh);
		colliders.push(new THREE.Box3(
			new THREE.Vector3(cx - len / 2, cy - r, cz - r),
			new THREE.Vector3(cx + len / 2, cy + r, cz + r),
		));
		return mesh;
	}

	function flat(cx, cz, w, l, mat, y = 0.012) {
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
		mesh.rotation.x = -Math.PI / 2;
		mesh.position.set(cx, y, cz);
		mesh.receiveShadow = true;
		scene.add(mesh);
		return mesh;
	}

	function decoBox(cx, y0, cz, w, h, d, mat, ry = 0) {
		const mesh = new THREE.Mesh(unitBox, mat);
		mesh.scale.set(w, h, d);
		mesh.position.set(cx, y0 + h / 2, cz);
		mesh.rotation.y = ry;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		scene.add(mesh);
		return mesh;
	}

	const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
	function decoCyl(cx, y0, cz, r, h, mat) {
		const mesh = new THREE.Mesh(unitCyl, mat);
		mesh.scale.set(r * 2, h, r * 2);
		mesh.position.set(cx, y0 + h / 2, cz);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		scene.add(mesh);
		return mesh;
	}

	function wallRun(cx, cz, len, axis, h = WALL_H, mat = matWall) {
		const n = Math.max(1, Math.ceil(len / 7));
		const segLen = len / n;
		for (let i = 0; i < n; i++) {
			const off = -len / 2 + segLen * (i + 0.5);
			if (axis === "x") solid(cx + off, 0, cz, segLen, h, 0.4, mat);
			else solid(cx, 0, cz + off, 0.4, h, segLen, mat);
		}
	}

	function flight(x0, z0, dx, dz, steps, rise, tread, width, mat = matConcrete) {
		for (let i = 0; i < steps; i++) {
			const top = rise * (i + 1);
			const w = dx !== 0 ? tread : width;
			const d = dz !== 0 ? tread : width;
			solid(x0 + dx * tread * i, 0, z0 + dz * tread * i, w, top, d, mat);
		}
	}

	function sign(text, x, y, z, ry) {
		const mat = new THREE.MeshStandardMaterial({ map: signTexture(text), roughness: 0.8, side: THREE.DoubleSide });
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mat);
		mesh.position.set(x, y, z);
		mesh.rotation.y = ry;
		scene.add(mesh);
		return mesh;
	}

	function hangingSign(text, cx, cz) {
		solid(cx - 4.4, 0, cz, 0.25, 4.0, 0.25, matMetal);
		solid(cx + 4.4, 0, cz, 0.25, 4.0, 0.25, matMetal);
		solid(cx, 4.0, cz, 9.6, 0.3, 0.3, matMetal);
		solid(cx - 0.6, 3.55, cz, 0.06, 0.5, 0.06, matDark);
		solid(cx + 0.6, 3.55, cz, 0.06, 0.5, 0.06, matDark);
		sign(text, cx, 2.95, cz, -Math.PI / 2);
	}

	function crate(cx, cz, stacked = false) {
		solid(cx, 0, cz, 1.1, 1.1, 1.1, matCrate);
		if (stacked) solid(cx, 1.1, cz, 1.1, 1.1, 1.1, matCrate);
	}

	scene.fog = new THREE.Fog(0x3d3129, 45, 120);
	const sky = new THREE.Mesh(
		new THREE.SphereGeometry(300, 24, 16),
		new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
	);
	scene.add(sky);
	env.skyMat = sky.material;
	const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
		map: glowTex, color: 0xff9a4a, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
	}));
	sunSprite.position.set(-190, 52, -150);
	sunSprite.scale.setScalar(120);
	scene.add(sunSprite);
	env.sunSpriteMat = sunSprite.material;

	const hemi = new THREE.HemisphereLight(0x3d7a80, 0x201612, 0.85);
	scene.add(hemi);
	env.hemi = hemi;
	const sun = new THREE.DirectionalLight(0xff8c3a, 2.1);
	sun.position.set(-55, 42, -38);
	sun.castShadow = true;
	env.sun = sun;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.camera.left = -62;
	sun.shadow.camera.right = 62;
	sun.shadow.camera.top = 48;
	sun.shadow.camera.bottom = -48;
	sun.shadow.camera.near = 10;
	sun.shadow.camera.far = 170;
	sun.shadow.bias = -0.0004;
	sun.shadow.normalBias = 0.03;
	scene.add(sun);
	scene.add(sun.target);

	const furnaceLight = new THREE.PointLight(0xff5a1a, 90, 34, 1.8);
	furnaceLight.position.set(-30, 2.0, -24.2);
	scene.add(furnaceLight);

	function lampGlow(x, y, z) {
		const glow = new THREE.Sprite(lampGlowMat);
		glow.position.set(x, y, z);
		glow.scale.setScalar(1.7);
		scene.add(glow);
	}
	function lampFixture(x, y, z, rod = true) {
		if (rod) decoBox(x, y + 0.3, z, 0.05, 0.55, 0.05, matDark);
		const shade = new THREE.Mesh(shadeGeo, matShade);
		shade.position.set(x, y + 0.18, z);
		shade.castShadow = true;
		scene.add(shade);
	}
	function workLight(x, y, z, intensity = 50, dist = 26) {
		const light = new THREE.PointLight(0xffb36b, intensity, dist, 1.8);
		light.position.set(x, y, z);
		scene.add(light);
		const bulb = new THREE.Mesh(bulbGeo, matBulb);
		bulb.position.set(x, y, z);
		scene.add(bulb);
		lampGlow(x, y, z);
	}

	function hangLamp(x, y, z, intensity = 42, dist = 22) {
		workLight(x, y, z, intensity, dist);
		lampFixture(x, y, z, false);
	}
	workLight(-24.2, 3.3, -22);
	workLight(0, 3.5, 0);
	workLight(30.6, 3.3, 22);
	workLight(-10, 2.25, 30, 20, 14);
	workLight(40, 3.4, 6);

	lampFixture(-24.2, 3.3, -22);
	lampFixture(0, 3.5, 0);
	lampFixture(30.6, 3.3, 22);
	lampFixture(40, 3.4, 6, false);
	decoBox(40.7, 3.52, 6, 1.6, 0.07, 0.07, matDark);

	hangLamp(0, 2.1, -18, 40, 20);
	hangLamp(-20, 3.3, -26.55, 44, 22);
	decoBox(-20, 3.52, -27.1, 0.07, 0.07, 1.1, matDark);
	hangLamp(10, 2.22, 30, 30, 16);
	decoBox(-42, 0, 14, 0.12, 3.6, 0.12, matMetal);
	decoBox(-41.6, 3.5, 14, 0.9, 0.07, 0.07, matDark);
	hangLamp(-41.3, 3.32, 14, 42, 22);

	const matShaft = new THREE.MeshBasicMaterial({
		color: 0xffc98a, transparent: true, opacity: 0.05,
		blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
	});
	env.shaftMats.push(matShaft);
	for (const [sx, sy, sz] of [[-24.2, 3.3, -22], [30.6, 3.3, 22], [40, 3.4, 6], [-41.3, 3.32, 14]]) {
		const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, sy, 18, 1, true), matShaft);
		cone.position.set(sx, sy / 2, sz);
		scene.add(cone);
	}

	colliders.push(new THREE.Box3(new THREE.Vector3(-70, -0.5, -60), new THREE.Vector3(70, 0, 60)));
	const matGround = new THREE.MeshStandardMaterial({
		map: groundTexture(), roughness: 0.95,
	});
	env.groundMat = matGround;
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 72), matGround);
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);
	const apronTex = asphaltTexture();
	apronTex.repeat.set(90, 90);
	const matApron = surfaceMaterial(apronTex, {
		color: 0x8a8a8a, roughness: 1, metalness: 0, bumpScale: 0.25,
	});
	env.apronMat = matApron;
	const apron = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), matApron);
	apron.rotation.x = -Math.PI / 2;
	apron.position.y = -0.05;
	scene.add(apron);

	const matPadEmber = new THREE.MeshBasicMaterial({ color: 0xff7a26, transparent: true, opacity: 0.16 });
	const matPadGuard = new THREE.MeshBasicMaterial({ color: 0x2fd4c4, transparent: true, opacity: 0.16 });
	for (const mz of [-8, -4, 0, 4, 8]) {
		flat(-44, mz, 1.9, 1.9, matPadEmber, 0.014);
		flat(44, mz, 1.9, 1.9, matPadGuard, 0.014);
	}

	wallRun(0, -36, 96.8, "x");
	wallRun(0, 36, 96.8, "x");
	wallRun(-48, 0, 72.8, "z");
	wallRun(48, 0, 72.8, "z");

	solid(-20, 0, -46, 4, 14, 4, matSilhouette);
	solid(14, 0, -48, 5, 18, 5, matSilhouette);
	solid(36, 0, -44, 3.5, 11, 3.5, matSilhouette);
	solid(58, 0, -10, 4, 12, 4, matSilhouette);

	wallRun(-25.5, -34, 25.6, "x", WALL_H, matWallWarm);
	wallRun(-25.5, -9, 25.6, "x", WALL_H, matWallWarm);
	wallRun(-38, -29, 10, "z", WALL_H, matWallWarm);
	wallRun(-38, -14.5, 11, "z", WALL_H, matWallWarm);
	solid(-38, 3.0, -22, 0.4, 1.2, 4.4, matWallWarm);

	wallRun(-13, -31, 6, "z", WALL_H, matWallWarm);
	solid(-13, 3.0, -26, 0.4, 1.2, 4.4, matWallWarm);
	wallRun(-13, -21.7, 4.6, "z", WALL_H, matWallWarm);
	solid(-13, 0, -18, 0.4, DECK_Y - 0.25, 2.8, matWallWarm);
	solid(-13, 0, -19.9, 0.5, 5.0, 0.6, matWallWarm);
	solid(-13, 0, -16.1, 0.5, 5.0, 0.6, matWallWarm);
	solid(-13, 4.5, -18, 0.5, 0.5, 3.6, matWallWarm);
	wallRun(-13, -12.8, 7.6, "z", WALL_H, matWallWarm);

	solid(-30, 0, -28, 8, 0.5, 6, matRust);
	solid(-30, 0.5, -28, 7, 4.7, 5, matFurnace);
	solid(-30, 0.8, -25.35, 3.2, 2.2, 0.3, matCore, { collide: false });
	cyl(-30, 5.2, -28, 0.9, 1.1, 4.8, matMetal);
	pipeX(-30, 3.9, -25.2, 0.22, 5.4, matPipe);

	flat(-30, -21.6, 0.9, 7.0, matMolten, 0.016);
	flat(-24.2, -28, 5.4, 0.7, matMolten, 0.016);

	solid(-20, 0, -28, 1, WALL_H, 1, matWallWarm);
	solid(-20, 0, -13, 1, WALL_H, 1, matWallWarm);
	crate(-21, -12.8, true);
	solid(-14.8, 0, -30, 0.5, 1.2, 2.2, matMetal);
	hangingSign("A", -28, -22);
	sign("A", -38.35, 2.9, -22, -Math.PI / 2);
	flat(-38, -22, 0.9, 4.4, matHazard, 0.014);
	flat(-13, -26, 0.9, 4.4, matHazard, 0.014);

	solid(-9.5, 0, -24, 7, WALL_H, 0.4, matWall);
	solid(-9.5, 0, -31, 7, WALL_H, 6, matWall);
	cyl(-7, 0, -33, 0.3, 0.3, 5.5, matPipe);
	cyl(-8.2, 0, -33, 0.22, 0.22, 4.8, matPipe);
	solid(-9.5, 0, -16.5, 7, WALL_H, 15, matWall);

	solid(-41, 0, -24.6, 6.4, 3.0, 0.4, matWallWarm);
	solid(-41, 0, -19.4, 6.4, 3.0, 0.4, matWallWarm);
	solid(-35.5, 0, -20.2, 1.8, 1.2, 0.4, matMetal);

	wallRun(-6, -32, 8, "z");
	wallRun(-6, -7, 34, "z");
	wallRun(-6, 26, 20, "z");

	wallRun(6, -27.8, 16.6, "z");
	solid(6, 0, -18, 0.4, DECK_Y - 0.25, 2.8, matWall);
	solid(6, 0, -19.9, 0.5, 5.0, 0.6, matWall);
	solid(6, 0, -16.1, 0.5, 5.0, 0.6, matWall);
	solid(6, 4.5, -18, 0.5, 0.5, 3.6, matWall);
	wallRun(6, -7.3, 18.6, "z");
	wallRun(6, 11, 10, "z");
	wallRun(6, 29, 14, "z");

	solid(-3.85, 0, 0, 4.3, 3.4, 0.5, matWall);
	solid(3.85, 0, 0, 4.3, 3.4, 0.5, matWall);
	solid(0, 3.4, 0, 12.4, 0.8, 0.5, matWall);
	solid(-1.78, 0, 1.15, 0.12, 3.0, 1.7, matRust);
	solid(1.78, 0, 1.15, 0.12, 3.0, 1.7, matRust);
	flat(0, 0, 3.8, 0.9, matHazard, 0.014);

	solid(2.2, 0, -8, 1.2, 0.4, 3.2, matConcrete);
	solid(3.3, 0, -8, 1.0, 0.8, 3.2, matConcrete, { cover: false });
	solid(4.9, 0, -8, 2.2, 1.2, 3.2, matConcrete);
	solid(5.9, 1.2, -8, 0.15, 0.5, 3.2, matMetal);

	solid(-3, 0, 10, 2.4, 1.2, 0.5, matMetal);
	crate(3.5, 20);
	crate(-4, 28, true);

	solid(-4, DECK_Y - 0.25, -18, 30, 0.25, 2.4, matPlate);
	for (const px of [-3, 3]) solid(px, 0, -19.0, 0.35, DECK_Y - 0.25, 0.35, matMetal);
	solid(-4, 3.38, -19.16, 30, 0.07, 0.07, matPipe);
	solid(-9.1, 3.38, -16.84, 19.8, 0.07, 0.07, matPipe);
	solid(7.1, 3.38, -16.84, 7.8, 0.07, 0.07, matPipe);
	for (let px = -18; px <= 10; px += 4) solid(px, DECK_Y, -19.16, 0.07, 0.8, 0.07, matPipe);
	flight(2, -12.3, 0, -1, 8, 0.325, 0.6, 2.4);
	flight(-25.4, -18, 1, 0, 8, 0.325, 0.86, 2.4);
	flight(17.2, -18, -1, 0, 8, 0.325, 0.86, 2.4);

	solid(6.9, 0, 4, 1.8, 0.45, 3.6, matConcrete);
	solid(10.9, 0, 5, 6.2, 0.9, 10, matConcrete, { cover: false });
	wallRun(10, 0, 8.4, "x", WALL_H, matWallCool);
	wallRun(14, 5, 10.4, "z", WALL_H, matWallCool);
	solid(7.4, 0, 10, 3.2, WALL_H, 0.4, matWallCool);
	solid(11, 0, 10, 4, 0.9, 0.4, matWallCool, { cover: false });
	solid(11, 2.8, 10, 4, 1.4, 0.4, matWallCool);
	solid(13.6, 0, 10, 1.2, WALL_H, 0.4, matWallCool);
	solid(12.5, 0.9, 2, 1.1, 1.1, 1.1, matCrate);

	wallRun(27, 10, 26, "x", WALL_H, matWallCool);
	wallRun(14, 13, 6, "z", WALL_H, matWallCool);
	wallRun(14, 24, 8, "z", WALL_H, matWallCool);
	solid(14, 0, 33, 0.4, WALL_H, 2.4, matWallCool);
	wallRun(40, 15, 10, "z", WALL_H, matWallCool);
	wallRun(40, 29, 10, "z", WALL_H, matWallCool);
	solid(40, 3.0, 22, 0.4, 1.2, 4.4, matWallCool);
	wallRun(27, 34, 26.4, "x", WALL_H, matWallCool);

	for (const [tx, tz] of [[32, 28], [37, 14.5]]) {
		cyl(tx, 0, tz, 2.2, 2.2, 0.4, matRust);
		cyl(tx, 0.4, tz, 2.0, 2.0, 6.1, matWallCool);
		cyl(tx, 6.5, tz, 0.3, 2.35, 1.3, matRust);
	}
	const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), matBeacon);
	beacon.position.set(37, 8.05, 14.5);
	scene.add(beacon);
	hangingSign("B", 27, 22);
	sign("B", 39.72, 2.9, 22, -Math.PI / 2);
	flat(40, 22, 0.9, 4.4, matHazard, 0.014);

	crate(23, 17.2, true);
	crate(24, 28.3);
	solid(19, 0, 26, 0.5, 1.2, 2.4, matMetal);
	crate(36, 20);
	crate(18, 12);

	solid(43, 0, 20, 6, 3.2, 0.4, matWallCool);
	solid(43, 0, 24, 6, 3.2, 0.4, matWallCool);

	solid(-10, 0, 28, 48, 3.0, 0.4, matTunnel);
	solid(-10, 0, 32, 48, 3.0, 0.4, matTunnel);
	solid(-10, 2.4, 30, 48, 0.5, 4.4, matTunnel);
	solid(-34, 0, 28.2, 0.4, 2.4, 0.4, matDark);
	solid(-34, 0, 31.8, 0.4, 2.4, 0.4, matDark);
	pipeX(-8, 2.15, 29, 0.22, 20, matPipe);
	solid(-10, 0, 30.9, 1.1, 1.1, 1.0, matCrate);
	sign("B", -34.25, 2.6, 30, -Math.PI / 2);
	flat(-34, 30, 0.9, 4.2, matHazard, 0.014);

	crate(-30, 12, true);
	pipeX(-20, 0.45, 20, 0.45, 5, matRust);
	pipeX(-20, 0.45, 21.1, 0.45, 5, matRust);
	solid(-14, 0, 26, 0.5, 1.2, 2.4, matMetal);

	crate(29, -21, true);
	solid(24.5, 0, -31, 2.4, 1.2, 0.5, matMetal);
	crate(44, 16);
	solid(41.5, 0, 6, 0.12, 3.5, 0.12, matMetal);

	const sites = {
		A: {
			zone: new THREE.Box3(new THREE.Vector3(-33, 0, -26), new THREE.Vector3(-23, 3, -18)),
			plantPos: new THREE.Vector3(-28, 0, -22),
		},
		B: {
			zone: new THREE.Box3(new THREE.Vector3(22, 0, 18), new THREE.Vector3(32, 3, 26)),
			plantPos: new THREE.Vector3(27, 0, 22),
		},
	};
	const spawns = {
		ember: [-8, -4, 0, 4, 8].map((z) => new THREE.Vector3(-44, 0, z)),
		guard: [-8, -4, 0, 4, 8].map((z) => new THREE.Vector3(44, 0, z)),
	};

	const nodes = new Map();
	const edges = new Map();
	function node(name, x, y, z, cover = false) {
		nodes.set(name, { pos: new THREE.Vector3(x, y, z), cover });
		edges.set(name, []);
	}
	function link(a, b) {
		edges.get(a).push(b);
		edges.get(b).push(a);
	}
	function link1(a, b) {
		edges.get(a).push(b);
	}

	node("espawn1", -44, 0, -8); node("espawn2", -44, 0, -4); node("espawn3", -44, 0, 0);
	node("espawn4", -44, 0, 4); node("espawn5", -44, 0, 8);
	node("e_yard", -37, 0, -2);
	node("e_south", -30, 0, 24);
	node("e_gate", -8, 0, 13);
	node("a_main", -35, 0, -22);
	node("a_site", -28, 0, -22);
	node("a_furnace", -33, 0, -21, true);
	node("a_hall", -30, 0, -13);
	node("a_stairs", -27, 0, -18);
	node("a_link", -16, DECK_Y, -18);
	node("a_door", -9, 0, -26);
	node("a_cover1", -21, 0, -11, true);
	node("a_cover2", -16, 0, -29, true);
	node("mid_s", 0, 0, 24);
	node("mid_doors", 0, 0, 0);
	node("mid_n", 0, 0, -26);
	node("mid_nest", 5, 1.2, -8);
	node("nest_step", 2.2, 0.4, -8);
	node("mid_cover", -3, 0, 11.2, true);
	node("mid_stairs", 2, 0, -11);
	node("mid_top", 2, DECK_Y, -17.5);
	node("catwalk", 0, DECK_Y, -18);
	node("cw_east", 8, DECK_Y, -18);
	node("window", 11, 0.9, 8);
	node("win_door", 8, 0.9, 4);
	node("b_yard", 18, 0, 16);
	node("b_site", 27, 0, 22);
	node("b_main", 37, 0, 22);
	node("b_tun", -16, 0, 30);
	node("tun_west", -36, 0, 30);
	node("tun_exit", 12, 0, 30);
	node("b_cover1", 23, 0, 15.8, true);
	node("b_cover2", 24, 0, 29.6, true);
	node("b_cover3", 17.8, 0, 26, true);
	node("econn", 10, 0, 19);
	node("gspawn1", 44, 0, -8); node("gspawn2", 44, 0, -4); node("gspawn3", 44, 0, 0);
	node("gspawn4", 44, 0, 4); node("gspawn5", 44, 0, 8);
	node("g_yard", 40, 0, 1);
	node("g_main", 44, 0, 22);
	node("g_a", 24, 0, -28);
	node("g_stairs", 18.5, 0, -18);
	node("g_cover", 27.8, 0, -21, true);

	for (const s of ["espawn1", "espawn2", "espawn3", "espawn4", "espawn5"]) link(s, "e_yard");
	link("e_yard", "a_main"); link("e_yard", "e_south");
	link("a_main", "a_site");
	link("a_site", "a_furnace"); link("a_site", "a_hall"); link("a_site", "a_stairs"); link("a_site", "a_cover2");
	link("a_hall", "a_cover1"); link("a_hall", "a_stairs");
	link("a_stairs", "a_link");
	link("a_link", "catwalk"); link("catwalk", "cw_east"); link("catwalk", "mid_top");
	link("mid_top", "mid_stairs");
	link("cw_east", "g_stairs");
	link("a_door", "a_cover2"); link("a_door", "mid_n");
	link("mid_n", "mid_doors"); link("mid_doors", "mid_s");
	link("mid_doors", "nest_step"); link("nest_step", "mid_nest"); link("mid_doors", "win_door");
	link("mid_s", "mid_cover"); link("mid_s", "e_gate"); link("mid_s", "econn");
	link("e_gate", "e_south");
	link("e_south", "tun_west");
	link("tun_west", "b_tun"); link("b_tun", "tun_exit"); link("tun_exit", "b_cover3");
	link("win_door", "window");
	link1("window", "b_yard");
	link("b_yard", "b_site"); link("b_yard", "b_cover3"); link("b_yard", "b_cover1"); link("b_yard", "econn");
	link("b_site", "b_cover1"); link("b_site", "b_cover2"); link("b_site", "b_main");
	link("b_main", "g_main"); link("g_main", "g_yard");
	for (const s of ["gspawn1", "gspawn2", "gspawn3", "gspawn4", "gspawn5"]) link(s, "g_yard");
	link("g_yard", "g_a"); link("g_a", "g_stairs"); link("g_a", "g_cover");

	const graph = { nodes, edges };

	function barrel(x, z, mat = matBarrel) {
		decoCyl(x, 0, z, 0.34, 0.96, mat);
	}
	function decoCrate(x, z, ry = 0, stacked = false) {
		decoBox(x, 0, z, 1.1, 1.1, 1.1, matCrate, ry);
		if (stacked) decoBox(x, 1.1, z, 1.1, 1.1, 1.1, matCrate, ry);
	}

	barrel(-36.6, -32.6); barrel(-35.5, -33.2); barrel(-36.3, -31.5, matBarrelSteel);
	decoCrate(-24, -8.15, 0.12); barrel(-22.4, -8.1);

	barrel(-5.1, -33); barrel(-5.1, -31.7, matBarrelSteel);

	barrel(38.6, 32.6); barrel(37.5, 33.1); barrel(38.9, 31.4, matBarrelSteel);
	barrel(17.2, 33); decoCrate(15.7, 33.2, -0.08);

	barrel(-46.2, 33.4); decoCrate(-45.9, -33.5, 0.2, true);
	barrel(46.3, -33.4); decoCrate(45.9, 33.3, -0.15);
	decoCrate(-5.3, 33.6, 0.05);

	decoBox(-4, 2.26, -16.68, 28, 0.05, 0.05, matDark);
	decoBox(-5.72, 3.55, -7, 0.06, 0.06, 32, matDark);
	decoBox(-30, 4.14, -25.2, 6.6, 0.05, 0.05, matDark);
	decoBox(27, 3.55, 10.28, 24, 0.06, 0.06, matDark);

	flat(2, 7, 5.2, 3.4, matPuddle, 0.021);
	flat(-22, -15.5, 4.6, 3.0, matPuddle, 0.021);
	flat(26, 15.5, 5.4, 3.4, matPuddle, 0.021);
	flat(-37, 13, 4.4, 3.0, matPuddle, 0.021);
	flat(7, 26.6, 4.6, 2.4, matPuddle, 0.021);

	const matDecalA = new THREE.MeshStandardMaterial({
		map: siteLetterTexture("A"), transparent: true, roughness: 0.9,
		polygonOffset: true, polygonOffsetFactor: -2,
	});
	const matDecalB = new THREE.MeshStandardMaterial({
		map: siteLetterTexture("B"), transparent: true, roughness: 0.9,
		polygonOffset: true, polygonOffsetFactor: -2,
	});
	flat(-28, -22, 7.5, 7.5, matDecalA, 0.024);
	flat(27, 22, 7.5, 7.5, matDecalB, 0.024);
	sign("A", -20, 2.6, -33.78, 0);
	sign("B", 27, 2.6, 10.22, 0);

	decoBox(-10, 0, -64, 1, 17, 1, matSilhouette);
	decoBox(18, 0, -64, 1, 17, 1, matSilhouette);
	decoBox(4, 16.4, -64, 30, 1.1, 1.1, matSilhouette);
	decoBox(2, 15.1, -64, 1.6, 1.3, 1.6, matSilhouette);
	decoBox(2, 8.6, -64, 0.08, 6.5, 0.08, matSilhouette);
	decoCyl(68, 0, -20, 2.6, 23, matSilhouette);
	decoCyl(74, 0, 8, 2.0, 16, matSilhouette);
	decoBox(-18, 0, 56, 34, 8, 12, matSilhouette);
	decoBox(24, 0, 58, 40, 10, 12, matSilhouette);
	decoCyl(-66, 0, 18, 2.4, 14, matSilhouette);
	decoCyl(-66, 14, 18, 3.4, 3.5, matSilhouette);

	const smokeTex = smokeTexture();
	const smokes = [];
	function smokeStack(x, y, z, count, baseScale) {
		for (let i = 0; i < count; i++) {
			const mat = new THREE.SpriteMaterial({
				map: smokeTex, color: 0x8a8d90, transparent: true, opacity: 0.12, depthWrite: false,
			});
			const s = new THREE.Sprite(mat);
			s.position.set(x, y, z);
			scene.add(s);
			smokes.push({ s, x, y, z, off: i / count, baseScale });
		}
	}
	smokeStack(-30, 10.3, -28, 3, 6.5);
	smokeStack(14, 18.5, -48, 2, 10);
	smokeStack(-20, 14.5, -46, 2, 9);

	const matWood = new THREE.MeshStandardMaterial({ color: 0x8a6b42, roughness: 0.95 });
	const matTire = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 1 });
	const matFork = new THREE.MeshStandardMaterial({ color: 0x9c7422, roughness: 0.6, metalness: 0.3 });
	function palletStack(x, z, n) {
		for (let i = 0; i < n; i++) {
			const y0 = i * 0.14;
			for (const off of [-0.5, 0, 0.5]) decoBox(x + off, y0, z, 0.14, 0.11, 1.2, matWood);
			decoBox(x, y0 + 0.11, z, 1.25, 0.03, 1.25, matWood);
		}
		return n * 0.14;
	}
	function spool(x, z) {
		decoCyl(x, 0, z, 0.55, 0.07, matDark);
		decoCyl(x, 0.07, z, 0.3, 0.45, matDark);
		decoCyl(x, 0.52, z, 0.55, 0.07, matDark);
	}
	function tires(x, z) {
		for (let i = 0; i < 3; i++) decoCyl(x, i * 0.25, z, 0.34, 0.24, matTire);
	}
	const coneGeo = new THREE.ConeGeometry(0.17, 0.52, 12);
	const matCone = new THREE.MeshStandardMaterial({ color: 0xc85a1e, roughness: 0.7 });
	const matBand = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.7 });
	function cone(x, z) {
		const m = new THREE.Mesh(coneGeo, matCone);
		m.position.set(x, 0.26, z);
		m.castShadow = true;
		scene.add(m);
		decoCyl(x, 0.24, z, 0.08, 0.09, matBand);
	}
	const top1 = palletStack(20, 32.9, 3);
	decoBox(20, top1, 32.9, 1.1, 1.1, 1.1, matCrate);
	palletStack(-45.3, 19, 2);
	palletStack(34.5, 33.1, 2);
	spool(31.8, 33.2); spool(-44.8, 24);
	tires(-36.9, -10.8); tires(16.6, 11.6);
	cone(-37.2, -20.3); cone(-37.2, -23.7);
	cone(38.6, 20.6); cone(38.6, 23.4);

	decoBox(44.2, 0.35, -16, 1.05, 0.5, 2.1, matFork);
	decoBox(45.05, 0.3, -16, 0.5, 0.75, 1.0, matFork);
	for (const px of [43.75, 44.65]) for (const pz of [-16.65, -15.35]) {
		decoBox(px, 0.85, pz, 0.07, 1.05, 0.07, matDark);
	}
	decoBox(44.2, 1.9, -16, 1.1, 0.06, 1.5, matDark);
	decoBox(43.52, 0, -16.45, 0.08, 2.4, 0.1, matMetal);
	decoBox(43.52, 0, -15.55, 0.08, 2.4, 0.1, matMetal);
	decoBox(43.52, 2.3, -16, 0.08, 0.1, 1.0, matMetal);
	decoBox(43.0, 0.04, -16.35, 1.0, 0.04, 0.12, matMetal);
	decoBox(43.0, 0.04, -15.65, 1.0, 0.04, 0.12, matMetal);
	const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14);
	for (const [wx, wz] of [[43.65, -17.02], [44.75, -17.02], [43.65, -14.98], [44.75, -14.98]]) {
		const wheel = new THREE.Mesh(wheelGeo, matTire);
		wheel.rotation.x = Math.PI / 2;
		wheel.position.set(wx, 0.3, wz);
		wheel.castShadow = true;
		scene.add(wheel);
	}

	const matSnow = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.85 });
	const snowGroup = new THREE.Group();
	snowGroup.visible = false;
	scene.add(snowGroup);
	env.snowCaps = snowGroup;
	function capBox(cx, cz, y0, w, d) {
		const m = new THREE.Mesh(unitBox, matSnow);
		m.scale.set(w, 0.07, d);
		m.position.set(cx, y0 + 0.035, cz);
		m.receiveShadow = true;
		snowGroup.add(m);
	}
	function capDisc(cx, cz, y0, r) {
		const m = new THREE.Mesh(unitCyl, matSnow);
		m.scale.set(r * 2, 0.06, r * 2);
		m.position.set(cx, y0 + 0.03, cz);
		snowGroup.add(m);
	}
	for (const [cx, cz, top] of [
		[-21, -12.8, 2.2], [3.5, 20, 1.1], [-4, 28, 2.2], [23, 17.2, 2.2],
		[24, 28.3, 1.1], [36, 20, 1.1], [18, 12, 1.1], [29, -21, 2.2],
		[44, 16, 1.1], [-30, 12, 2.2], [12.5, 2, 2.0], [-10, 30.9, 1.1],
		[-24, -8.15, 1.1], [15.7, 33.2, 1.1], [-45.9, -33.5, 2.2],
		[45.9, 33.3, 1.1], [-5.3, 33.6, 1.1], [20, 32.9, 1.52],
	]) capBox(cx, cz, top, 1.24, 1.24);
	capBox(-30, -28, 5.2, 7.3, 5.3);
	capBox(-4, -18, DECK_Y, 30, 2.54);
	capBox(-3, 10, 1.2, 2.54, 0.64);
	capBox(19, 26, 1.2, 0.64, 2.54);
	for (const [cx, cz] of [
		[-36.6, -32.6], [-35.5, -33.2], [-36.3, -31.5], [-22.4, -8.1],
		[-5.1, -33], [-5.1, -31.7], [38.6, 32.6], [37.5, 33.1],
		[38.9, 31.4], [17.2, 33], [-46.2, 33.4], [46.3, -33.4],
	]) capDisc(cx, cz, 0.96, 0.4);

	for (const [tx, tz] of [[32, 28], [37, 14.5]]) {
		const shell = new THREE.Mesh(
			new THREE.CylinderGeometry(0.36, 2.42, 1.36, 20), matSnow);
		shell.position.set(tx, 6.5 + 0.68, tz);
		snowGroup.add(shell);
	}

	function update(dt, t) {
		const flicker = Math.sin(t * 11.3) * 7 + Math.sin(t * 23.7 + 1.7) * 5 + Math.sin(t * 3.1) * 4;
		furnaceLight.intensity = 90 + flicker;
		matCore.emissiveIntensity = 1.35 + flicker * 0.015;
		matMolten.emissiveIntensity = 1.9 + Math.sin(t * 2.3) * 0.25;
		matBeacon.emissiveIntensity = t % 1.6 < 0.15 ? 3.0 : 0.15;

		for (const sm of smokes) {
			const ph = (t * 0.045 + sm.off) % 1;
			sm.s.position.set(sm.x + ph * 4.5, sm.y + ph * 6.5, sm.z + ph * 1.2);
			const sc = sm.baseScale * (0.7 + ph * 1.1);
			sm.s.scale.set(sc, sc, 1);
			sm.s.material.opacity = 0.15 * (1 - ph) * Math.min(1, ph * 6);
		}
	}

	return { colliders, coverBoxes, sites, spawns, graph, update, env };
}
