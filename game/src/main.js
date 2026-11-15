// main.js - boot and glue for Ashfall Foundry.
// Owns the single state object G, builds every module, runs the fixed-step
// simulation (60 Hz, decoupled from rendering), routes the local player's
// combat input, and directs the deterministic ?shot= screenshot scenes.

import * as THREE from "three";
import { CFG, WEAPONS, ARMOR, GRENADES } from "./config.js";
import { rng, clamp } from "./util.js";
import { buildWorld } from "./world.js";
import { createActor } from "./actors.js";
import { createBotMind } from "./bots.js";
import { createEffects } from "./effects.js";
import { createAudio } from "./audio.js";
import { createInput } from "./input.js";
import { createPlayer } from "./player.js";
import { createHUD } from "./hud.js";
import { createMatch } from "./rounds.js";
import {
	createLoadout, giveWeapon, selectWeapon, fire, reload, releaseTrigger, selectSlot,
	currentWeapon, currentSpread, updateWeapons,
} from "./weapons.js";

const params = new URLSearchParams(location.search);
const shotMode = params.get("shot"); // start | play | end | null
const seed = Number(params.get("seed")) || CFG.defaultSeed;

// --- renderer / scene ---------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// --- the one state object -------------------------------------------------------

const G = {
	scene,
	renderer,
	rng: rng(seed),
	time: 0,
	simTime: 0,
	paused: false,
	shot: shotMode,
	noiseEvents: [],
	actors: [],
	player: null, // the local player's actor
	camera: null,
	world: null,
	effects: null,
	audio: null,
	input: null,
	hud: null,
	match: null,
	playerRig: null,
};
window.G = G; // debugging handle

G.world = buildWorld(scene);
G.effects = createEffects(scene);
G.audio = createAudio();

// --- actors: the local player plus nine bots -------------------------------------

function addActor(team, name, isPlayer) {
	const a = createActor(team, name, isPlayer);
	a.loadout = createLoadout();
	scene.add(a.mesh);
	const spawn = G.world.spawns[team === 0 ? "ember" : "guard"][G.actors.filter((x) => x.team === team).length % 5];
	a.pos.copy(spawn);
	a.mesh.position.copy(spawn);
	if (!isPlayer) a.mind = createBotMind(a, team);
	G.actors.push(a);
	return a;
}

const player = addActor(0, "You", true);
G.player = player;
for (const n of ["Vex", "Rho", "Sable", "Kite"]) addActor(0, n, false);
for (const n of ["Warden", "Piston", "Gauge", "Holt", "Brigg"]) addActor(1, n, false);

// --- input / player rig / HUD / match ----------------------------------------------

G.input = createInput(renderer.domElement);
const rig = createPlayer(player);
G.playerRig = rig;
G.camera = rig.camera;
scene.add(rig.camera);

G.hud = createHUD(G);
G.hud.hitmark = G.hud.hitmarker; // weapons.js asks for hitmark; hud named it hitmarker

G.match = createMatch(G);

// The HUD buys with a bare item id for the local player; rounds.js buys with
// (actor, kind, id). Adapt once, here, so both call shapes work.
const rawBuy = G.match.buy;
G.match.buy = function (a, b, c) {
	if (typeof a === "string") {
		const kind = WEAPONS[a] ? "weapon" : ARMOR[a] ? "armor" : GRENADES[a] ? "grenade" : null;
		return kind ? rawBuy(G.player, kind, a) : false;
	}
	return rawBuy(a, b, c);
};

// Kills: actors.js fires this exactly once per death (inside applyDamage).
G.onKill = (attacker, victim, part) => {
	G.match.handleKill(attacker, victim);
	const wid = attacker ? currentWeapon(attacker) : null;
	G.hud.killfeed(attacker, victim, {
		weapon: wid ? WEAPONS[wid].name : "",
		headshot: part === "head",
	});
};

// --- menu / pause flow --------------------------------------------------------------

function lockPointer() {
	try {
		const p = G.input.lock();
		if (p && p.catch) p.catch(() => {});
	} catch { /* a too-fast relock is fine; the next click retries */ }
}

G.onPlay = () => {
	G.audio.unlock();
	G.audio.startAmbient();
	G.match.startMatch();
	G.paused = false;
	lockPointer();
};
G.onRestart = () => {
	G.audio.unlock();
	G.match.startMatch();
	G.paused = false;
	lockPointer();
};
G.onResume = () => {
	G.paused = false;
	lockPointer();
};
let wasLocked = false;
G.input.onLockChange = (locked) => {
	// Pause only when a lock we actually held is lost (Esc). A failed lock
	// request — no gesture, browser still cooling down — is not a pause.
	if (!locked && wasLocked && !G.shot && ["freeze", "live", "planted", "end"].includes(G.match.phase)) {
		G.paused = true;
		releaseTrigger(player);
	}
	wasLocked = locked;
};

// --- discrete input events --------------------------------------------------------------

let buyOpen = false;
function setBuy(open) {
	buyOpen = open;
	G.hud.showBuy(open);
}

G.input.on("reload", () => {
	if (player.alive && ["live", "planted"].includes(G.match.phase)) reload(player);
});
G.input.on("slot", (n) => {
	if (!buyOpen && player.alive && ["live", "planted"].includes(G.match.phase)) selectSlot(player, n);
});
G.input.on("scoreboard", (held) => G.hud.scoreboard(!!held));
G.input.on("mute", () => G.audio.toggleMute());
G.input.on("buy", () => {
	if (G.match.phase === "freeze" && player.alive) setBuy(!buyOpen);
});

// --- fixed-step simulation --------------------------------------------------------------

const STEP = 1 / CFG.simRate;
const lookDir = new THREE.Vector3();
let lastPhase = "menu";
let lastWeaponId = null;
let lastPlayerHp = 100;

function step(dt) {
	G.simTime += dt;
	const M = G.match;
	const phase = M.phase;

	if (!G.paused) {
		M.update(dt);

		if (!G.shot && phase !== "menu" && phase !== "over") {
			rig.update(dt, G.input, G);
		}

		// bot brains run while a round is in progress
		if (!G.shot && (phase === "freeze" || phase === "live" || phase === "planted")) {
			for (const a of G.actors) if (a.mind && a.alive) a.mind.update(dt, G);
		}

		routePlayerCombat(dt);
		updateWeapons(G, dt);
	}

	// buy menu follows the freeze phase
	if (phase === "freeze" && lastPhase !== "freeze" && !G.shot) setBuy(true);
	if (phase !== "freeze" && lastPhase === "freeze") setBuy(false);
	lastPhase = phase;

	// viewmodel follows the weapon in hand
	const wid = currentWeapon(player);
	if (wid !== lastWeaponId) {
		lastWeaponId = wid;
		rig.setWeapon(wid);
	}

	// HUD mirrors the HUD reads off the player actor
	player.flash01 = clamp((player.flashT || 0) / (GRENADES.flash.duration || 2.2), 0, 1);
	if (M.channel) {
		G.hud.progress(M.channel.kind === "plant" ? "PLANTING" : "DEFUSING", M.channel.t / M.channel.dur);
	} else {
		G.hud.progress(null, 0);
	}

	// damage direction: hp dropped and we know who did it
	if (player.hp < lastPlayerHp && player.lastAttacker && player.alive) {
		const atk = player.lastAttacker;
		const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
		let dx = atk.pos.x - player.pos.x, dz = atk.pos.z - player.pos.z;
		const len = Math.hypot(dx, dz) || 1;
		dx /= len; dz /= len;
		G.hud.damageFrom(Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz));
	}
	lastPlayerHp = player.hp;
}

function routePlayerCombat(dt) {
	const M = G.match;
	if (G.shot || G.paused) return;
	const inRound = M.phase === "live" || M.phase === "planted";

	// planting is a hold-E channel; releasing E cancels it
	if (M.phase === "live" && player.alive && player.hasBomb && G.input.keys.has("KeyE")) {
		M.requestPlant(player);
	}
	if (!G.input.keys.has("KeyE") && M.channel && M.channel.actor === player) {
		player.planting = false;
		M.channel = null;
	}

	if (!inRound || !player.alive || !G.input.locked) {
		releaseTrigger(player);
		return;
	}

	// mouse wheel cycles weapon slots
	const wheel = G.input.consumeWheel();
	if (wheel !== 0) {
		const cur = (player.loadout.slot || 1) + (wheel > 0 ? 1 : -1);
		selectSlot(player, ((cur - 1 + 4) % 4) + 1);
	}

	if (G.input.firing) {
		G.camera.getWorldDirection(lookDir);
		fire(G, player, lookDir);
	} else {
		releaseTrigger(player);
	}
}

// --- screenshot scenes ----------------------------------------------------------------------

function nodePos(name) {
	const n = G.world.graph.nodes.get(name);
	return n ? n.pos : new THREE.Vector3();
}

function setupShot(mode) {
	G.match.startMatch(); // freeze phase, everyone at spawn, bomb handed out
	const cam = G.camera;
	const eye = new THREE.Vector3();

	if (mode === "start") {
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		cam.lookAt(G.world.sites.A.plantPos.x, 2.2, G.world.sites.A.plantPos.z);
		setBuy(true);
		return;
	}

	if (mode === "play") {
		const M = G.match;
		M.phase = "live"; M.phaseT = 73; M.timeLeft = 73;
		giveWeapon(player, "vulcan");
		selectWeapon(player, "vulcan");
		rig.setWeapon("vulcan");
		player.pos.copy(nodePos("a_link"));
		const target = G.actors.find((a) => a.team === 1 && a.name === "Warden");
		target.pos.copy(nodePos("a_site"));
		target.yaw = Math.PI / 2; // face the incoming player
		const second = G.actors.find((a) => a.team === 1 && a.name === "Piston");
		second.pos.copy(nodePos("a_cover1"));
		const mate = G.actors.find((a) => a.team === 0 && a.name === "Vex");
		mate.pos.copy(nodePos("a_door"));
		for (const a of G.actors) a.mesh.position.copy(a.pos);
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		const chest = new THREE.Vector3(target.pos.x, target.pos.y + 1.3, target.pos.z);
		cam.lookAt(chest);
		// one live burst in the composed frame: tracer, muzzle, hitmarker
		lookDir.subVectors(chest, eye).normalize();
		fire(G, player, lookDir);
		fire(G, player, lookDir);
		G.hud.hitmarker(false);
		return;
	}

	if (mode === "end") {
		const M = G.match;
		M.score = [4, 2];
		M.history = [0, 1, 0, 1, 0, 0];
		M.phase = "planted"; M.phaseT = 6; M.timeLeft = 6;
		const plantPos = G.world.sites.A.plantPos.clone();
		M.bomb = { state: "planted", carrier: null, site: "A", pos: plantPos, t: 6, planted: true };
		M.bombPlanted = true; M.bombPos = plantPos; M.bombSite = "A";
		const guard = G.actors.find((a) => a.team === 1 && a.name === "Warden");
		guard.pos.copy(plantPos); guard.pos.x += 1.1;
		guard.crouch01 = 1;
		guard.yaw = -Math.PI / 2;
		player.pos.copy(nodePos("a_site"));
		player.pos.x -= 3.5;
		for (const a of G.actors) a.mesh.position.copy(a.pos);
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		cam.lookAt(plantPos.x, 0.7, plantPos.z);
		G.hud.progress("DEFUSING", 0.45);
		G.hud.banner("Charge planted", "Site A — Furnace", 0);
	}
}

if (shotMode) setupShot(shotMode);

// --- render loop ------------------------------------------------------------------------------

let last = performance.now();
let acc = 0;
let framesRendered = 0;

function frame(now) {
	requestAnimationFrame(frame);
	const frameDt = Math.min((now - last) / 1000, 0.1);
	last = now;
	G.time += frameDt;

	acc += frameDt;
	let steps = 0;
	while (acc >= STEP && steps < 5) {
		step(STEP);
		acc -= STEP;
		steps++;
	}
	if (steps === 5) acc = 0;

	// menu backdrop: a slow orbit over the foundry yard
	if (!G.shot && G.match.phase === "menu") {
		const t = G.time * 0.05;
		G.camera.position.set(Math.cos(t) * 34, 13, Math.sin(t) * 34);
		G.camera.lookAt(0, 2, 0);
	}

	G.world.update(frameDt, G.time);
	G.effects.update(frameDt);
	for (const a of G.actors) a.setPose(frameDt);
	G.hud.update(frameDt);

	// trauma shake rides on top of the rig camera for this frame only
	G.camera.position.add(G.effects.shakeOffset);
	renderer.render(scene, G.camera);
	G.camera.position.sub(G.effects.shakeOffset);

	G.input.endFrame();
	framesRendered++;
	if (G.shot && framesRendered === 6) window.__shotReady = true;
}
requestAnimationFrame(frame);

addEventListener("resize", () => {
	renderer.setSize(innerWidth, innerHeight);
	G.camera.aspect = innerWidth / innerHeight;
	G.camera.updateProjectionMatrix();
});

console.log("Ashfall Foundry booted — three.js", THREE.REVISION);
