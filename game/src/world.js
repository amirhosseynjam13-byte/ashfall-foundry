// world.js - the Ashfall Foundry map: geometry, collision, lighting, and
// the waypoint graph the bots navigate by.
//
// The map is 96 x 72 m (x east, z south, y up). Ember Cell spawns on the
// west edge, Foundry Guard on the east. Site A is the Furnace Hall in the
// north-west, site B the Cooling Yard in the south-east, and a walled mid
// avenue with a catwalk runs between them. Three routes per site, per the
// tactical-shooter rulebook: a main lane, a mid link, and a sneaky one.
//
// Every solid mesh is created through solid()/cyl(), which also append
// the matching THREE.Box3 to `colliders` - visuals and collision can never
// drift apart. Flat decals (paint, molten channels, hazard strips) are the
// only non-colliding meshes, and they are flush with the floor.

import * as THREE from "three";
import {
	concreteTexture,
	crateTexture,
	glowTexture,
	groundTexture,
	hazardTexture,
	signTexture,
	skyTexture,
	wallTexture,
} from "./textures.js";

const WALL_H = 4.2; // standard wall height; lintels and towers vary
const DECK_Y = 2.6; // catwalk deck walking surface
const COVER_MIN = 0.8; // a solid this tall or taller (but crouch-cover
const COVER_MAX = 1.6; // height) is registered as a cover box

export function buildWorld(scene) {
	const colliders = [];
	const coverBoxes = [];

	// --- materials -------------------------------------------------------
	const wallTex = wallTexture();
	wallTex.repeat.set(2, 1.4);
	const matWall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.82, metalness: 0.25 });
	const matWallWarm = new THREE.MeshStandardMaterial({ map: wallTex, color: 0xe6c9ac, roughness: 0.82, metalness: 0.25 });
	const matWallCool = new THREE.MeshStandardMaterial({ map: wallTex, color: 0xaecdd4, roughness: 0.82, metalness: 0.25 });
	const concTex = concreteTexture();
	concTex.repeat.set(2, 2);
	const matConcrete = new THREE.MeshStandardMaterial({ map: concTex, color: 0xbdbdbd, roughness: 0.95 });
	const matCrate = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.9 });
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

	// --- build helpers -----------------------------------------------------
	const unitBox = new THREE.BoxGeometry(1, 1, 1);

	// One solid: a scaled unit box whose base sits at y0, plus its collider.
	// opts.cover flags crouch-height cover; opts.collide=false is for the
	// rare solid that must not block (none in this map - decals use flat()).
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
			// Cover auto-detects crouch-height solids; floors and sills opt
			// out explicitly with { cover: false }.
			const isCover = opts.cover === true ||
				(opts.cover !== false && h >= COVER_MIN && h <= COVER_MAX && w >= 0.8 && d >= 0.4);
			if (isCover) coverBoxes.push(box);
		}
		return mesh;
	}

	// One vertical cylinder plus its AABB collider (r = the larger radius).
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

	// A horizontal pipe along x, plus its AABB collider.
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

	// A floor decal: paint, hazard striping, a molten channel. Flush with
	// the ground and never colliding - actors walk straight over it.
	function flat(cx, cz, w, l, mat, y = 0.012) {
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
		mesh.rotation.x = -Math.PI / 2;
		mesh.position.set(cx, y, cz);
		mesh.receiveShadow = true;
		scene.add(mesh);
		return mesh;
	}

	// A straight wall run, segmented so the panel texture keeps its scale.
	function wallRun(cx, cz, len, axis, h = WALL_H, mat = matWall) {
		const n = Math.max(1, Math.ceil(len / 7));
		const segLen = len / n;
		for (let i = 0; i < n; i++) {
			const off = -len / 2 + segLen * (i + 0.5);
			if (axis === "x") solid(cx + off, 0, cz, segLen, h, 0.4, mat);
			else solid(cx, 0, cz + off, 0.4, h, segLen, mat);
		}
	}

	// A flight of solid steps from the ground up to rise*steps. (x0, z0) is
	// the centre of the bottom step; the flight climbs along (dx, dz).
	function flight(x0, z0, dx, dz, steps, rise, tread, width, mat = matConcrete) {
		for (let i = 0; i < steps; i++) {
			const top = rise * (i + 1);
			const w = dx !== 0 ? tread : width;
			const d = dz !== 0 ? tread : width;
			solid(x0 + dx * tread * i, 0, z0 + dz * tread * i, w, top, d, mat);
		}
	}

	// A site sign, printed on both faces so it reads from either side.
	function sign(text, x, y, z, ry) {
		const mat = new THREE.MeshStandardMaterial({ map: signTexture(text), roughness: 0.8, side: THREE.DoubleSide });
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mat);
		mesh.position.set(x, y, z);
		mesh.rotation.y = ry;
		scene.add(mesh);
		return mesh;
	}

	// A hanging sign over a plant zone: posts, a beam, rods, the plate.
	function hangingSign(text, cx, cz) {
		solid(cx - 4.4, 0, cz, 0.25, 4.0, 0.25, matMetal);
		solid(cx + 4.4, 0, cz, 0.25, 4.0, 0.25, matMetal);
		solid(cx, 4.0, cz, 9.6, 0.3, 0.3, matMetal);
		solid(cx - 0.6, 3.55, cz, 0.06, 0.5, 0.06, matDark);
		solid(cx + 0.6, 3.55, cz, 0.06, 0.5, 0.06, matDark);
		sign(text, cx, 2.95, cz, -Math.PI / 2);
	}

	// A crate, or a two-high stack when `stacked` - the map's basic cover.
	function crate(cx, cz, stacked = false) {
		solid(cx, 0, cz, 1.1, 1.1, 1.1, matCrate);
		if (stacked) solid(cx, 1.1, cz, 1.1, 1.1, 1.1, matCrate);
	}

	// --- sky, fog, lights --------------------------------------------------
	scene.fog = new THREE.Fog(0x2b2f2c, 45, 120);
	const sky = new THREE.Mesh(
		new THREE.SphereGeometry(300, 24, 16),
		new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
	);
	scene.add(sky);
	const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
		map: glowTexture(), color: 0xff9a4a, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
	}));
	sunSprite.position.set(-190, 52, -150);
	sunSprite.scale.setScalar(120);
	scene.add(sunSprite);

	scene.add(new THREE.HemisphereLight(0x3d7a80, 0x201612, 0.55));
	const sun = new THREE.DirectionalLight(0xff8c3a, 1.8);
	sun.position.set(-55, 42, -38);
	sun.castShadow = true;
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

	// The furnace light is the one animated light in the map (see update).
	const furnaceLight = new THREE.PointLight(0xff5a1a, 90, 34, 1.8);
	furnaceLight.position.set(-30, 2.0, -24.2);
	scene.add(furnaceLight);

	// Warm work-lights at the places fights happen. No shadows - the sun
	// owns the only shadow map.
	function workLight(x, y, z, intensity = 50, dist = 26) {
		const light = new THREE.PointLight(0xffb36b, intensity, dist, 1.8);
		light.position.set(x, y, z);
		scene.add(light);
		const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), matBulb);
		bulb.position.set(x, y, z);
		scene.add(bulb);
	}
	workLight(-24.2, 3.3, -22); // site A, off the sign post
	workLight(0, 3.5, 0); // mid, under the door lintel
	workLight(30.6, 3.3, 22); // site B, off the sign post
	workLight(-10, 2.25, 30, 20, 14); // B tunnel
	workLight(40, 3.4, 6); // Guard yard

	// --- ground --------------------------------------------------------------
	// The floor slab is a collider with no mesh: actors stand on it via the
	// same mover that handles stairs and the catwalk deck.
	colliders.push(new THREE.Box3(new THREE.Vector3(-70, -0.5, -60), new THREE.Vector3(70, 0, 60)));
	const ground = new THREE.Mesh(
		new THREE.PlaneGeometry(96, 72),
		new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 }),
	);
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);
	const apronTex = concreteTexture();
	apronTex.repeat.set(90, 90);
	const apron = new THREE.Mesh(
		new THREE.PlaneGeometry(600, 600),
		new THREE.MeshStandardMaterial({ map: apronTex, color: 0x8a8a8a, roughness: 1 }),
	);
	apron.rotation.x = -Math.PI / 2;
	apron.position.y = -0.05;
	scene.add(apron);

	// Spawn pads glow faintly in team colours (the paint itself is in the
	// ground texture; these quads just lift it at dusk).
	const matPadEmber = new THREE.MeshBasicMaterial({ color: 0xff7a26, transparent: true, opacity: 0.16 });
	const matPadGuard = new THREE.MeshBasicMaterial({ color: 0x2fd4c4, transparent: true, opacity: 0.16 });
	for (const mz of [-8, -4, 0, 4, 8]) {
		flat(-44, mz, 1.9, 1.9, matPadEmber, 0.014);
		flat(44, mz, 1.9, 1.9, matPadGuard, 0.014);
	}

	// --- perimeter -----------------------------------------------------------
	wallRun(0, -36, 96.8, "x");
	wallRun(0, 36, 96.8, "x");
	wallRun(-48, 0, 72.8, "z");
	wallRun(48, 0, 72.8, "z");
	// Silhouette chimneys beyond the north wall - the foundry goes on.
	solid(-20, 0, -46, 4, 14, 4, matDark);
	solid(14, 0, -48, 5, 18, 5, matDark);
	solid(36, 0, -44, 3.5, 11, 3.5, matDark);
	solid(58, 0, -10, 4, 12, 4, matDark);

	// --- site A: the Furnace Hall (x -38..-13, z -34..-9) --------------------
	wallRun(-25.5, -34, 25.6, "x", WALL_H, matWallWarm); // north
	wallRun(-25.5, -9, 25.6, "x", WALL_H, matWallWarm); // south
	wallRun(-38, -29, 10, "z", WALL_H, matWallWarm); // west, north of A-Main
	wallRun(-38, -14.5, 11, "z", WALL_H, matWallWarm); // west, south of A-Main
	solid(-38, 3.0, -22, 0.4, 1.2, 4.4, matWallWarm); // A-Main lintel
	// east wall: A-Door gap at z -28..-24, catwalk opening at z -19.4..-16.6
	wallRun(-13, -31, 6, "z", WALL_H, matWallWarm);
	solid(-13, 3.0, -26, 0.4, 1.2, 4.4, matWallWarm); // A-Door lintel
	wallRun(-13, -21.7, 4.6, "z", WALL_H, matWallWarm);
	solid(-13, 0, -18, 0.4, DECK_Y - 0.25, 2.8, matWallWarm); // below the deck opening
	solid(-13, 0, -19.9, 0.5, 5.0, 0.6, matWallWarm); // opening pillars + lintel
	solid(-13, 0, -16.1, 0.5, 5.0, 0.6, matWallWarm);
	solid(-13, 4.5, -18, 0.5, 0.5, 3.6, matWallWarm);
	wallRun(-13, -12.8, 7.6, "z", WALL_H, matWallWarm);

	// The furnace itself: a riveted hulk with a glowing core facing the
	// plant apron, a skirt too tall to step onto, and its chimney.
	solid(-30, 0, -28, 8, 0.5, 6, matRust); // skirt
	solid(-30, 0.5, -28, 7, 4.7, 5, matDark); // body
	solid(-30, 0.8, -25.35, 3.2, 2.2, 0.3, matCore, { collide: false }); // core face
	cyl(-30, 5.2, -28, 0.9, 1.1, 4.8, matMetal); // chimney
	pipeX(-30, 3.9, -25.2, 0.22, 5.4, matPipe); // feed pipe across the face
	// Molten channels run out of the furnace across the hall floor.
	flat(-30, -21.6, 0.9, 7.0, matMolten, 0.016);
	flat(-24.2, -28, 5.4, 0.7, matMolten, 0.016);
	// Hall cover: two pillars, a crate stack by the south door, a barrier.
	solid(-20, 0, -28, 1, WALL_H, 1, matWallWarm);
	solid(-20, 0, -13, 1, WALL_H, 1, matWallWarm);
	crate(-21, -12.8, true);
	solid(-14.8, 0, -30, 0.5, 1.2, 2.2, matMetal); // barrier by A-Door
	hangingSign("A", -28, -22);
	sign("A", -38.35, 2.9, -22, -Math.PI / 2); // over A-Main, facing Ember
	flat(-38, -22, 0.9, 4.4, matHazard, 0.014); // A-Main threshold
	flat(-13, -26, 0.9, 4.4, matHazard, 0.014); // A-Door threshold

	// A-Door corridor (x -13..-6 at z -28..-24) and the blocks flanking it.
	solid(-9.5, 0, -24, 7, WALL_H, 0.4, matWall);
	solid(-9.5, 0, -31, 7, WALL_H, 6, matDark); // boiler house (north block)
	cyl(-7, 0, -33, 0.3, 0.3, 5.5, matPipe);
	cyl(-8.2, 0, -33, 0.22, 0.22, 4.8, matPipe);
	solid(-9.5, 0, -16.5, 7, WALL_H, 15, matWall); // warehouse block (south)

	// A-Main chute: two guide walls funnelling Ember out of their yard.
	solid(-41, 0, -24.6, 6.4, 3.0, 0.4, matWallWarm);
	solid(-41, 0, -19.4, 6.4, 3.0, 0.4, matWallWarm);
	solid(-35.5, 0, -20.2, 1.8, 1.2, 0.4, matMetal); // corridor barrier

	// --- mid avenue (x -6..6) --------------------------------------------------
	// West wall: A-Door corridor mouth (z -28..-24), south gate (z 10..16).
	wallRun(-6, -32, 8, "z");
	wallRun(-6, -7, 34, "z");
	wallRun(-6, 26, 20, "z");
	// East wall: catwalk opening (z -19.4..-16.6), window-room door
	// (z 2..6), south-east gate (z 16..22).
	wallRun(6, -27.8, 16.6, "z");
	solid(6, 0, -18, 0.4, DECK_Y - 0.25, 2.8, matWall);
	solid(6, 0, -19.9, 0.5, 5.0, 0.6, matWall);
	solid(6, 0, -16.1, 0.5, 5.0, 0.6, matWall);
	solid(6, 4.5, -18, 0.5, 0.5, 3.6, matWall);
	wallRun(6, -7.3, 18.6, "z");
	wallRun(6, 11, 10, "z");
	wallRun(6, 29, 14, "z");

	// The double doors at z 0: frame walls, a lintel, and both slabs swung
	// open against the frame - a chokepoint you can still read at a glance.
	solid(-3.85, 0, 0, 4.3, 3.4, 0.5, matWall);
	solid(3.85, 0, 0, 4.3, 3.4, 0.5, matWall);
	solid(0, 3.4, 0, 12.4, 0.8, 0.5, matWall);
	solid(-1.78, 0, 1.15, 0.12, 3.0, 1.7, matRust);
	solid(1.78, 0, 1.15, 0.12, 3.0, 1.7, matRust);
	flat(0, 0, 3.8, 0.9, matHazard, 0.014);

	// Sniper nest: a stepped platform against the east wall of mid.
	solid(2.2, 0, -8, 1.2, 0.4, 3.2, matConcrete);
	solid(3.3, 0, -8, 1.0, 0.8, 3.2, matConcrete, { cover: false });
	solid(4.9, 0, -8, 2.2, 1.2, 3.2, matConcrete);
	solid(5.9, 1.2, -8, 0.15, 0.5, 3.2, matMetal); // nest lip
	// Mid cover and clutter.
	solid(-3, 0, 10, 2.4, 1.2, 0.5, matMetal); // barrier, mid_cover stands behind it
	crate(3.5, 20);
	crate(-4, 28, true);

	// --- the catwalk (deck at y 2.6, z -18, x -19..11) -------------------------
	solid(-4, DECK_Y - 0.25, -18, 30, 0.25, 2.4, matMetal);
	for (const px of [-3, 3]) solid(px, 0, -19.0, 0.35, DECK_Y - 0.25, 0.35, matMetal); // mid pillars
	solid(-4, 3.38, -19.16, 30, 0.07, 0.07, matPipe); // north rail
	solid(-9.1, 3.38, -16.84, 19.8, 0.07, 0.07, matPipe); // south rail, west of the mid flight
	solid(7.1, 3.38, -16.84, 7.8, 0.07, 0.07, matPipe); // south rail, east of it
	for (let px = -18; px <= 10; px += 4) solid(px, DECK_Y, -19.16, 0.07, 0.8, 0.07, matPipe);
	flight(2, -12.3, 0, -1, 8, 0.325, 0.6, 2.4); // mid scaffold flight, up from mid floor
	flight(-25.4, -18, 1, 0, 8, 0.325, 0.86, 2.4); // in-hall flight, down to site A
	flight(17.2, -18, -1, 0, 8, 0.325, 0.86, 2.4); // east flight, down to the Guard yard

	// --- window room (x 6..14, z 0..10) ----------------------------------------
	// A raised room off mid: two steps up, a window out over site B. The
	// drop outside is 0.9 m - more than a step-up or a jump - so the graph
	// edge out of the window is one-way.
	solid(6.9, 0, 4, 1.8, 0.45, 3.6, matConcrete); // entry step (0 -> 0.45)
	solid(10.9, 0, 5, 6.2, 0.9, 10, matConcrete, { cover: false }); // platform floor (0.45 -> 0.9)
	wallRun(10, 0, 8.4, "x", WALL_H, matWallCool); // north
	wallRun(14, 5, 10.4, "z", WALL_H, matWallCool); // east
	solid(7.4, 0, 10, 3.2, WALL_H, 0.4, matWallCool); // south, west of the window
	solid(11, 0, 10, 4, 0.9, 0.4, matWallCool, { cover: false }); // window sill, flush with the platform
	solid(11, 2.8, 10, 4, 1.4, 0.4, matWallCool); // window lintel
	solid(13.6, 0, 10, 1.2, WALL_H, 0.4, matWallCool); // south, east of the window
	solid(12.5, 0.9, 2, 1.1, 1.1, 1.1, matCrate); // a crate on the platform

	// --- site B: the Cooling Yard (x 14..40, z 10..34) -------------------------
	wallRun(27, 10, 26, "x", WALL_H, matWallCool); // north
	wallRun(14, 13, 6, "z", WALL_H, matWallCool); // west, north segment
	wallRun(14, 24, 8, "z", WALL_H, matWallCool); // west, between the two gates
	solid(14, 0, 33, 0.4, WALL_H, 2.4, matWallCool); // west, south of the tunnel mouth
	wallRun(40, 15, 10, "z", WALL_H, matWallCool); // east, north of B-Main
	wallRun(40, 29, 10, "z", WALL_H, matWallCool); // east, south of B-Main
	solid(40, 3.0, 22, 0.4, 1.2, 4.4, matWallCool); // B-Main lintel
	wallRun(27, 34, 26.4, "x", WALL_H, matWallCool); // south
	// Two water towers (silo tanks) - the yard's landmarks and hard cover.
	for (const [tx, tz] of [[32, 28], [37, 14.5]]) {
		cyl(tx, 0, tz, 2.2, 2.2, 0.4, matRust);
		cyl(tx, 0.4, tz, 2.0, 2.0, 6.1, matWallCool);
		cyl(tx, 6.5, tz, 0.3, 2.35, 1.3, matRust);
	}
	const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), matBeacon);
	beacon.position.set(37, 8.05, 14.5);
	scene.add(beacon);
	hangingSign("B", 27, 22);
	sign("B", 39.72, 2.9, 22, -Math.PI / 2); // on the yard face of the B-Main wall
	flat(40, 22, 0.9, 4.4, matHazard, 0.014); // B-Main threshold
	// Yard cover: crate stacks watching the plant zone from three sides.
	crate(23, 17.2, true);
	crate(24, 28.3);
	solid(19, 0, 26, 0.5, 1.2, 2.4, matMetal); // barrier by the tunnel exit
	crate(36, 20);
	crate(18, 12);

	// B-Main corridor, from the yard's east wall into the Guard spawn lane.
	solid(43, 0, 20, 6, 3.2, 0.4, matWallCool);
	solid(43, 0, 24, 6, 3.2, 0.4, matWallCool);

	// --- B tunnel (x -34..14 at z 28..32) ---------------------------------------
	// A low vent run under the yard's south edge: 3 m walls, a ceiling at
	// 2.4 m, one work-light. Low enough to feel like a vent, tall enough
	// that a standing actor (1.78 m) passes cleanly.
	solid(-10, 0, 28, 48, 3.0, 0.4, matDark);
	solid(-10, 0, 32, 48, 3.0, 0.4, matDark);
	solid(-10, 2.4, 30, 48, 0.5, 4.4, matDark); // ceiling slab
	solid(-34, 0, 28.2, 0.4, 2.4, 0.4, matDark); // mouth frame
	solid(-34, 0, 31.8, 0.4, 2.4, 0.4, matDark);
	pipeX(-8, 2.15, 29, 0.22, 20, matPipe); // vent pipe along the ceiling
	solid(-10, 0, 30.9, 1.1, 1.1, 1.0, matCrate); // alcove crate
	sign("B", -34.25, 2.6, 30, -Math.PI / 2); // tunnel mouth sign
	flat(-34, 30, 0.9, 4.2, matHazard, 0.014); // mouth threshold

	// --- Ember south yard clutter ------------------------------------------------
	crate(-30, 12, true);
	pipeX(-20, 0.45, 20, 0.45, 5, matRust); // a stack of dead pipes (low cover)
	pipeX(-20, 0.45, 21.1, 0.45, 5, matRust);
	solid(-14, 0, 26, 0.5, 1.2, 2.4, matMetal);

	// --- Guard yard clutter --------------------------------------------------------
	crate(29, -21, true); // north-yard stack (g_cover)
	solid(24.5, 0, -31, 2.4, 1.2, 0.5, matMetal); // barrier on the A rotation
	crate(44, 16);
	solid(41.5, 0, 6, 0.12, 3.5, 0.12, matMetal); // yard light pole

	// --- sites and spawns ----------------------------------------------------------
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

	// --- waypoint graph --------------------------------------------------------------
	// Nodes are stand points (feet positions, y = floor height there);
	// cover nodes are the spots a bot ducks to beside a cover box. Edges
	// are walkable straight lines - every one was checked against the
	// walls above. Bots A* over this, then steer with the collision mover.
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
		edges.get(a).push(b); // one-way: the window drop
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
	link1("window", "b_yard"); // out of the window is a drop - no way back up
	link("b_yard", "b_site"); link("b_yard", "b_cover3"); link("b_yard", "b_cover1"); link("b_yard", "econn");
	link("b_site", "b_cover1"); link("b_site", "b_cover2"); link("b_site", "b_main");
	link("b_main", "g_main"); link("g_main", "g_yard");
	for (const s of ["gspawn1", "gspawn2", "gspawn3", "gspawn4", "gspawn5"]) link(s, "g_yard");
	link("g_yard", "g_a"); link("g_a", "g_stairs"); link("g_a", "g_cover");

	const graph = { nodes, edges };

	// --- per-frame life --------------------------------------------------------------
	// Only the furnace breathes: its light and core pulse with layered
	// sines (deterministic in t), the molten channels glow along with it,
	// and the yard tower's beacon blinks. No allocations - everything
	// animated was captured in this closure at build time.
	function update(dt, t) {
		const flicker = Math.sin(t * 11.3) * 7 + Math.sin(t * 23.7 + 1.7) * 5 + Math.sin(t * 3.1) * 4;
		furnaceLight.intensity = 90 + flicker;
		matCore.emissiveIntensity = 2.0 + flicker * 0.02;
		matMolten.emissiveIntensity = 2.4 + Math.sin(t * 2.3) * 0.3;
		matBeacon.emissiveIntensity = t % 1.6 < 0.15 ? 3.0 : 0.15;
	}

	return { colliders, coverBoxes, sites, spawns, graph, update };
}
