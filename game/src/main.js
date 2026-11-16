// main.js - boot and glue: the state object G, module wiring, the fixed-step loop, the shot director.
import * as THREE from "three";
import { CFG,WEAPONS,ARMOR,GRENADES } from "./config.js";
import { rng,clamp } from "./util.js";
import { createWeather,WEATHER_MODES } from "./weather.js";
import { createHUD } from "./hud.js";
import { createMatch } from "./rounds.js";
import { createBotMind } from "./bots.js";
import { buildWorld } from "./world.js";
import { createPlayer } from "./player.js";
import { createActor } from "./actors.js";
import {
	createLoadout,giveWeapon,selectWeapon,fire,reload,releaseTrigger,selectSlot,
	currentWeapon,currentSpread,updateWeapons,
} from "./weapons.js";
import { createEffects } from "./effects.js";
import { createInput } from "./input.js";
import { createAudio } from "./audio.js";

const params=new URLSearchParams(location.search);
const shotMode=params.get("shot");
const seed=Number(params.get("seed")) || CFG.defaultSeed;

const weatherParam=params.get("weather");
let storedWeather=null;
try { storedWeather=localStorage.getItem("ashfall-weather"); } catch {  }
const initialWeather=WEATHER_MODES.includes(weatherParam) ? weatherParam
	: WEATHER_MODES.includes(storedWeather) ? storedWeather : "dusk";

const renderer=new THREE.WebGLRenderer({ antialias: true,powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;
document.body.appendChild(renderer.domElement);

const scene=new THREE.Scene();

const G={
	scene,
	renderer,
	rng: rng(seed),
	time: 0,
	simTime: 0,
	paused: false,
	shot: shotMode,
	shotMenu: shotMode === "menu" || shotMode === "menu2",
	weatherMode: initialWeather,
	weather: null,
	noiseEvents: [],
	actors: [],
	player: null,
	camera: null,
	world: null,
	effects: null,
	audio: null,
	input: null,
	hud: null,
	match: null,
	playerRig: null,
};
window.G=G;

G.world=buildWorld(scene);
G.effects=createEffects(scene);
G.audio=createAudio();
G.weather=createWeather(scene,renderer,G.world.env);
G.weather.setMode(initialWeather);
G.onWeather=(mode) => {
	G.weatherMode=mode;
	G.weather.setMode(mode);
};

function addActor(team,name,isPlayer) {
	const a=createActor(team,name,isPlayer);
	a.loadout=createLoadout();
	scene.add(a.mesh);
	const spawn=G.world.spawns[team === 0 ? "ember" : "guard"][G.actors.filter((x) => x.team === team).length % 5];
	a.pos.copy(spawn);
	a.mesh.position.copy(spawn);
	if (!isPlayer) a.mind=createBotMind(a,team);
	G.actors.push(a);
	return a;
}

const player=addActor(0,"You",true);
G.player=player;
for (const n of ["Vex","Rho","Sable","Kite"]) addActor(0,n,false);
for (const n of ["Warden","Piston","Gauge","Holt","Brigg"]) addActor(1,n,false);

G.input=createInput(renderer.domElement);
const rig=createPlayer(player);
G.playerRig=rig;
G.camera=rig.camera;
scene.add(rig.camera);

G.hud=createHUD(G);
G.hud.hitmark=G.hud.hitmarker;

G.match=createMatch(G);

const rawBuy=G.match.buy;
G.match.buy=function (a,b,c) {
	if (typeof a === "string") {
		const kind=WEAPONS[a] ? "weapon" : ARMOR[a] ? "armor" : GRENADES[a] ? "grenade" : null;
		return kind ? rawBuy(G.player,kind,a) : false;
	}
	return rawBuy(a,b,c);
};

G.onKill=(attacker,victim,part) => {
	G.match.handleKill(attacker,victim);
	const wid=attacker ? currentWeapon(attacker) : null;
	G.hud.killfeed(attacker,victim,{
		weapon: wid ? WEAPONS[wid].name : "",
		headshot: part === "head",
	});
};

function lockPointer() {
	try {
		const p=G.input.lock();
		if (p && p.catch) p.catch(() => {});
	} catch {  }
}

G.onPlay=() => {
	G.audio.unlock();
	G.audio.startAmbient();
	G.match.startMatch();
	G.paused=false;
	lockPointer();
};
G.onRestart=() => {
	G.audio.unlock();
	G.match.startMatch();
	G.paused=false;
	lockPointer();
};
G.onResume=() => {
	G.paused=false;
	lockPointer();
};
let wasLocked=false;
G.input.onLockChange=(locked) => {

	if (!locked && wasLocked && !G.shot && ["freeze","live","planted","end"].includes(G.match.phase)) {
		G.paused=true;
		releaseTrigger(player);
	}
	wasLocked=locked;
};

let buyOpen=false;
function setBuy(open) {
	buyOpen=open;
	G.hud.showBuy(open);
}

G.input.on("reload",() => {
	if (player.alive && ["live","planted"].includes(G.match.phase)) reload(player);
});
G.input.on("slot",(n) => {
	if (!buyOpen && player.alive && ["live","planted"].includes(G.match.phase)) selectSlot(player,n);
});
G.input.on("scoreboard",(held) => G.hud.scoreboard(!!held));
G.input.on("mute",() => G.audio.toggleMute());
G.input.on("buy",() => {
	if (G.match.phase === "freeze" && player.alive) setBuy(!buyOpen);
});

const STEP=1 / CFG.simRate;
const lookDir=new THREE.Vector3();
let lastPhase="menu";
let lastWeaponId=null;
let lastPlayerHp=100;

function step(dt) {
	G.simTime += dt;
	const M=G.match;
	const phase=M.phase;

	if (!G.paused) {
		M.update(dt);

		if (!G.shot && phase !== "menu" && phase !== "over") {
			rig.update(dt,G.input,G);
		}

		if (!G.shot && (phase === "freeze" || phase === "live" || phase === "planted")) {
			for (const a of G.actors) if (a.mind && a.alive) a.mind.update(dt,G);
		}

		routePlayerCombat(dt);
		updateWeapons(G,dt);

		for (const a of G.actors) {
			if (a.pos.y < -8) {
				const mates=G.actors.filter((x) => x.team === a.team);
				const sp=G.world.spawns[a.team === 0 ? "ember" : "guard"][mates.indexOf(a) % 5];
				a.pos.copy(sp);
				a.vel.set(0,0,0);
			}
		}
	}

	if (phase === "freeze" && lastPhase !== "freeze" && !G.shot) setBuy(true);
	if (phase !== "freeze" && lastPhase === "freeze") setBuy(false);
	lastPhase=phase;

	const wid=currentWeapon(player);
	if (wid !== lastWeaponId) {
		lastWeaponId=wid;
		rig.setWeapon(wid);
	}

	player.flash01=clamp((player.flashT || 0) / (GRENADES.flash.duration || 2.2),0,1);
	if (M.channel) {
		G.hud.progress(M.channel.kind === "plant" ? "PLANTING" : "DEFUSING",M.channel.t / M.channel.dur);
	} else {
		G.hud.progress(null,0);
	}

	if (player.hp < lastPlayerHp && player.lastAttacker && player.alive) {
		const atk=player.lastAttacker;
		const fx=-Math.sin(player.yaw),fz=-Math.cos(player.yaw);
		let dx=atk.pos.x - player.pos.x,dz=atk.pos.z - player.pos.z;
		const len=Math.hypot(dx,dz) || 1;
		dx /= len; dz /= len;
		G.hud.damageFrom(Math.atan2(fx * dz - fz * dx,fx * dx + fz * dz));
	}
	lastPlayerHp=player.hp;
}

function routePlayerCombat(dt) {
	const M=G.match;
	if (G.shot || G.paused) return;
	const inRound=M.phase === "live" || M.phase === "planted";

	if (M.phase === "live" && player.alive && player.hasBomb && G.input.keys.has("KeyE")) {
		M.requestPlant(player);
	}
	if (!G.input.keys.has("KeyE") && M.channel && M.channel.actor === player) {
		player.planting=false;
		M.channel=null;
	}

	if (!inRound || !player.alive || !G.input.locked) {
		releaseTrigger(player);
		return;
	}

	const wheel=G.input.consumeWheel();
	if (wheel !== 0) {
		const cur=(player.loadout.slot || 1) + (wheel > 0 ? 1 : -1);
		selectSlot(player,((cur - 1 + 4) % 4) + 1);
	}

	if (G.input.firing) {
		G.camera.getWorldDirection(lookDir);
		fire(G,player,lookDir);
	} else {
		releaseTrigger(player);
	}
}

function nodePos(name) {
	const n=G.world.graph.nodes.get(name);
	return n ? n.pos : new THREE.Vector3();
}

function setupShot(mode) {
	const byName=(team,name) => G.actors.find((a) => a.team === team && a.name === name);
	const cam=G.camera;
	const eye=new THREE.Vector3();

	if (mode === "menu" || mode === "menu2") {

		if (mode === "menu") {
			cam.position.set(-16,4.22,-18);
			cam.lookAt(-28,1.6,-22);
		} else {
			cam.position.set(18,3.2,13);
			cam.lookAt(28,1.8,23);
		}
		return;
	}

	G.match.startMatch();

	if (mode === "start") {

		player.pos.copy(nodePos("a_hall"));
		const vex=byName(0,"Vex");
		vex.pos.copy(nodePos("a_site")); vex.pos.x += 2.5;
		const rho=byName(0,"Rho");
		rho.pos.copy(nodePos("a_main"));
		for (const a of G.actors) a.mesh.position.copy(a.pos);
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		cam.lookAt(G.world.sites.A.plantPos.x,1.8,G.world.sites.A.plantPos.z);
		setBuy(true);
		return;
	}

	if (mode === "play" || mode === "duel") {
		const M=G.match;
		M.phase="live"; M.phaseT=73; M.timeLeft=73;
		giveWeapon(player,"vulcan");
		selectWeapon(player,"vulcan");
		rig.setWeapon("vulcan");

		player.pos.copy(nodePos(mode === "duel" ? "a_stairs" : "a_link"));
		if (mode === "duel") player.pos.set(-26.8,0,-24.6);
		const target=byName(1,"Warden");

		target.pos.set(-24.8,0,-21.5);
		target.yaw=Math.atan2(player.pos.x - target.pos.x,player.pos.z - target.pos.z);
		target._combatT=5;
		const second=byName(1,"Piston");
		second.pos.copy(nodePos("a_cover1"));
		second.yaw=Math.atan2(player.pos.x - second.pos.x,player.pos.z - second.pos.z);
		second._combatT=5;
		const mate=byName(0,"Vex");
		mate.pos.copy(nodePos("a_door"));
		for (const a of G.actors) a.mesh.position.copy(a.pos);
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		const chest=new THREE.Vector3(target.pos.x,target.pos.y + 1.3,target.pos.z);
		cam.lookAt(chest);

		target.hp=100000;
		lookDir.subVectors(chest,eye).normalize();
		const st=player.loadout.states?.vulcan;
		G._shotBurst=() => {
			if (st) { st.ammo=30; st.drawT=0; st.fireT=0; }
			fire(G,player,lookDir);
			fire(G,player,lookDir);
			G.hud.hitmarker(false);
		};
		G._shotBurst();
		return;
	}

	if (mode === "snow") {

		const M=G.match;
		M.phase="live"; M.phaseT=41; M.timeLeft=41;
		giveWeapon(player,"vulcan");
		selectWeapon(player,"vulcan");
		rig.setWeapon("vulcan");
		player.pos.set(20.0,0,13.5);
		const target=byName(1,"Warden");
		target.pos.set(25.5,0,21.0);
		target.yaw=Math.atan2(player.pos.x - target.pos.x,player.pos.z - target.pos.z);
		target._combatT=5;
		const mate=byName(0,"Vex");
		mate.pos.copy(nodePos("b_cover1"));
		mate.yaw=Math.atan2(27 - mate.pos.x,22 - mate.pos.z);
		mate._combatT=5;
		const second=byName(1,"Piston");
		second.pos.set(31.5,0,24.5);
		second.yaw=Math.atan2(player.pos.x - second.pos.x,player.pos.z - second.pos.z);
		second._combatT=5;
		for (const a of G.actors) a.mesh.position.copy(a.pos);
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		cam.lookAt(26.5,1.1,22.0);

		target.hp=100000;
		const chest=new THREE.Vector3(target.pos.x,target.pos.y + 1.3,target.pos.z);
		lookDir.subVectors(chest,eye).normalize();
		const st=player.loadout.states?.vulcan;
		G._shotBurst=() => {
			if (st) st.ammo=30;
			fire(G,player,lookDir);
			fire(G,player,lookDir);
			G.hud.hitmarker(false);
		};
		G._shotBurst();
		return;
	}

	if (mode === "buy") {
		player.pos.copy(nodePos("a_main"));
		player.money=1600;
		giveWeapon(player,"vulcan");
		selectWeapon(player,"vulcan");
		rig.setWeapon("vulcan");
		const vex=byName(0,"Vex");
		vex.pos.copy(nodePos("a_site"));
		const rho=byName(0,"Rho");
		rho.pos.copy(nodePos("a_hall"));
		for (const a of G.actors) a.mesh.position.copy(a.pos);
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		cam.lookAt(G.world.sites.A.plantPos.x,1.6,G.world.sites.A.plantPos.z);
		setBuy(true);
		return;
	}

	if (mode === "smoke") {
		const M=G.match;
		M.phase="live"; M.phaseT=58; M.timeLeft=58;
		giveWeapon(player,"vulcan");
		selectWeapon(player,"vulcan");
		rig.setWeapon("vulcan");
		player.pos.set(-33.5,0,-18.6);
		const target=byName(1,"Warden");
		giveWeapon(target,"vulcan");
		selectWeapon(target,"vulcan");
		target.pos.set(-25.5,0,-22.5);
		target.yaw=Math.atan2(player.pos.x - target.pos.x,player.pos.z - target.pos.z);
		target._combatT=5;
		target.hp=100000;
		const mate=byName(0,"Vex");
		mate.pos.set(-35.5,0,-24.5);
		mate.yaw=Math.atan2(target.pos.x - mate.pos.x,target.pos.z - mate.pos.z);
		mate._combatT=5;
		for (const a of G.actors) a.mesh.position.copy(a.pos);
		G.effects.smokePuff(new THREE.Vector3(-27.8,0,-19.4));
		for (let i=0; i < 8; i++) G.effects.update(0.4);
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		const chest=new THREE.Vector3(target.pos.x,target.pos.y + 1.3,target.pos.z);
		cam.lookAt(chest);
		lookDir.subVectors(chest,eye).normalize();
		const wst=target.loadout.states?.vulcan;
		const weye=new THREE.Vector3(target.pos.x,target.pos.y + 1.52,target.pos.z);
		const wdir=new THREE.Vector3(eye.x + 1.5,eye.y + 0.1,eye.z + 0.8).sub(weye).normalize();
		const st=player.loadout.states?.vulcan;
		G._shotBurst=() => {
			if (st) { st.ammo=30; st.drawT=0; st.fireT=0; }
			if (wst) { wst.ammo=30; wst.drawT=0; wst.fireT=0; }
			fire(G,player,lookDir);
			fire(G,player,lookDir);
			fire(G,target,wdir);
			G.hud.hitmarker(false);
		};
		G._shotBurst();
		return;
	}

	if (mode === "scope") {
		const M=G.match;
		M.phase="live"; M.phaseT=64; M.timeLeft=64;
		giveWeapon(player,"longshot");
		selectWeapon(player,"longshot");
		rig.setWeapon("longshot");
		player.pos.copy(nodePos("a_link"));
		player.scoped=true;
		const target=byName(1,"Warden");
		target.pos.set(-28,0,-22);
		target.yaw=Math.atan2(player.pos.x - target.pos.x,player.pos.z - target.pos.z);
		target._combatT=5;
		target.hp=100000;
		const second=byName(1,"Piston");
		second.pos.set(-30.5,0,-18.5);
		second.yaw=Math.atan2(player.pos.x - second.pos.x,player.pos.z - second.pos.z);
		second._combatT=5;
		for (const a of G.actors) a.mesh.position.copy(a.pos);
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		const chest=new THREE.Vector3(target.pos.x,target.pos.y + 1.25,target.pos.z);
		cam.lookAt(chest);
		cam.fov=74 / (WEAPONS.longshot.zoom || 2.6);
		cam.updateProjectionMatrix();
		for (const ch of cam.children) ch.visible=false;
		lookDir.subVectors(chest,eye).normalize();
		const st=player.loadout.states?.longshot;
		G._shotBurst=() => {
			if (st) { st.drawT=0; st.fireT=0; st.latched=false; }
			fire(G,player,lookDir);
			G.hud.hitmarker(false);
		};
		G._shotBurst();
		return;
	}

	if (mode === "end") {
		const M=G.match;
		M.score=[4,2];
		M.history=[0,1,0,1,0,0];
		M.phase="planted"; M.phaseT=16; M.timeLeft=16;
		const plantPos=G.world.sites.A.plantPos.clone();
		M.bomb={ state: "planted",carrier: null,site: "A",pos: plantPos,t: 16,planted: true,action: "defuse",progress: 0.55 };
		M.bombPlanted=true; M.bombPos=plantPos; M.bombSite="A";
		const guard=byName(1,"Warden");
		guard.pos.copy(plantPos); guard.pos.x += 1.1;
		guard.crouch01=1;
		guard.yaw=Math.PI / 2;
		guard.defusing=true;

		M.channel={ actor: guard,kind: "defuse",t: 2.7,dur: 5,site: "A",x: guard.pos.x,z: guard.pos.z };
		player.pos.copy(nodePos("a_site"));
		player.pos.x -= 7;
		player.pos.z -= 3.5;
		for (const a of G.actors) a.mesh.position.copy(a.pos);
		eye.copy(player.pos); eye.y += CFG.eyeStand;
		cam.position.copy(eye);
		cam.lookAt(plantPos.x,1.0,plantPos.z);
		G.hud.banner("Charge planted","Site A — Furnace",0);
	}
}

if (shotMode) setupShot(shotMode);

let last=performance.now();
let acc=0;
let framesRendered=0;

function frame(now) {
	requestAnimationFrame(frame);
	const frameDt=Math.min((now - last) / 1000,0.1);
	last=now;
	G.time += frameDt;

	acc += frameDt;
	let steps=0;
	while (acc >= STEP && steps < 5) {
		step(STEP);
		acc -= STEP;
		steps++;
	}
	if (steps === 5) acc=0;

	if (!G.shot && G.match.phase === "menu") {
		const t=G.time * 0.05;
		G.camera.position.set(Math.cos(t) * 34,13,Math.sin(t) * 34);
		G.camera.lookAt(0,2,0);
	}

	if (G._shotBurst && G.time - (G._shotBurstT || 0) > 0.05) {
		G._shotBurstT=G.time;
		G._shotBurst();
	}

	G.world.update(frameDt,G.time);
	G.weather.update(frameDt,G.camera.position);
	G.effects.update(frameDt);
	for (const a of G.actors) a.setPose(frameDt);
	G.hud.update(frameDt);

	G.camera.position.add(G.effects.shakeOffset);
	renderer.render(scene,G.camera);
	G.camera.position.sub(G.effects.shakeOffset);

	G.input.endFrame();
	framesRendered++;
	if (G.shot && framesRendered === 6) window.__shotReady=true;
}
requestAnimationFrame(frame);

addEventListener("resize",() => {
	renderer.setSize(innerWidth,innerHeight);
	G.camera.aspect=innerWidth / innerHeight;
	G.camera.updateProjectionMatrix();
});

console.log("Ashfall Foundry booted — three.js",THREE.REVISION);
