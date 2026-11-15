// bots.js - the brains inside every non-player actor.
// Each bot is a small state machine over a waypoint graph: it rolls out to
// an assigned position, holds angles, engages what it perceives, rotates on
// information, plants or defuses the bomb, and falls back when hurt.
// Perception is honest - a vision cone plus line-of-sight and hearing - and
// the gunplay rules are the player's: bots fire through weapons.js with an
// aim-error cone that shrinks the longer they track a target.
//
// Thinking runs at 10 Hz (perception, decisions, path replans); steering
// and trigger control run every simulation step. All scratch vectors are
// per-mind, created once - nothing here allocates per frame.

import * as THREE from "three";
import { CFG } from "./config.js";
import { clamp, lerp, damp, randRange, angleLerp, hasLOS, slideMove } from "./util.js";
import { fire, reload } from "./weapons.js";

// --- waypoint graph access ---------------------------------------------------
// world.js exports the graph as Maps; the accessors also tolerate plain
// objects so a hand-built test graph works unchanged.
function nodeOf(graph, name) {
	if (!graph || !graph.nodes) return null;
	return graph.nodes instanceof Map ? graph.nodes.get(name) || null : graph.nodes[name] || null;
}
function neighboursOf(graph, name) {
	if (!graph || !graph.edges) return [];
	const e = graph.edges instanceof Map ? graph.edges.get(name) : graph.edges[name];
	return e || [];
}

// A* over the waypoint graph, cost = edge length, heuristic = straight-line
// distance to the goal. Returns node names from start to goal inclusive,
// or [] when either end is missing or no route exists.
export function findPath(graph, fromName, toName) {
	const start = nodeOf(graph, fromName);
	const goal = nodeOf(graph, toName);
	if (!start || !goal) return [];
	if (fromName === toName) return [fromName];

	const open = [fromName];
	const cameFrom = new Map();
	const gScore = new Map([[fromName, 0]]);
	const fScore = new Map([[fromName, start.pos.distanceTo(goal.pos)]]);
	const closed = new Set();

	while (open.length > 0) {
		let bestI = 0;
		for (let i = 1; i < open.length; i++) {
			if ((fScore.get(open[i]) ?? Infinity) < (fScore.get(open[bestI]) ?? Infinity)) bestI = i;
		}
		const cur = open.splice(bestI, 1)[0];
		if (cur === toName) {
			const path = [cur];
			let n = cur;
			while (cameFrom.has(n)) { n = cameFrom.get(n); path.unshift(n); }
			return path;
		}
		if (closed.has(cur)) continue;
		closed.add(cur);
		const curPos = nodeOf(graph, cur).pos;
		const g = gScore.get(cur);
		for (const nb of neighboursOf(graph, cur)) {
			const nbNode = nodeOf(graph, nb);
			if (!nbNode) continue;
			const tg = g + curPos.distanceTo(nbNode.pos);
			if (tg < (gScore.get(nb) ?? Infinity)) {
				cameFrom.set(nb, cur);
				gScore.set(nb, tg);
				fScore.set(nb, tg + nbNode.pos.distanceTo(goal.pos));
				if (!open.includes(nb)) open.push(nb);
			}
		}
	}
	return [];
}

// Site vocabulary shared by assignments, entries and watch angles.
const SITE_NODE = { A: "a_site", B: "b_site" };
const SITE_ENTRIES = {
	A: ["a_main", "a_door", "a_link"],
	B: ["b_main", "b_tun", "window"],
};
const GUARD_ROTATION = ["A", "B", "A", "B", "mid"]; // fallback Guard split

const VISION_COS = Math.cos((100 / 2) * (Math.PI / 180)); // 100° cone
const VISION_RANGE = 65;
const HEAR_FOOTSTEP_FALLBACK = 9; // only used when an event carries no radius

export function createBotMind(actor, team) {
	// --- per-mind scratch (allocated once) ---
	const eye = new THREE.Vector3();
	const aimPoint = new THREE.Vector3();
	const aimDir = new THREE.Vector3();
	const sideDir = new THREE.Vector3();
	const lastKnownPos = new THREE.Vector3();
	const finalPos = new THREE.Vector3();
	const watchPos = new THREE.Vector3();
	const pathPts = []; // Vector3 refs: graph node positions, then finalPos

	// --- round assignment (set by reset) ---
	let graph = null;
	let colliders = [];
	let callSite = "A";
	let mySite = "A"; // 'A' | 'B' | 'mid'
	let isCarrier = false;
	let flex = false;
	let bought = false;
	let plantRefined = false;

	// --- state machine ---
	let state = "rollout"; // rollout|takePosition|hold|engage|rotate|plant|defuse|retake|cover|hunt
	let task = "assignment"; // why we travel: assignment|investigate|postplant|retake|fallback|hunt
	let pathI = 0;
	let atDest = true;
	let hasDest = false;

	// --- perception memory ---
	let visibleEnemy = null;
	let target = null;
	let targetSince = 0;
	let reactionAt = 0;
	let lastSeenT = -Infinity;
	let lastKnownT = -Infinity;
	let alertT = -Infinity;

	// --- combat ---
	let bursting = false;
	let burstT = 0;
	let pauseT = 0;
	let dryT = 0; // how long fire() has been reporting "no shot"
	let strafeSeed = Math.abs(Math.sin(actor.name.length * 12.9898) * 43758.5453) % (Math.PI * 2);

	// --- timers ---
	let thinkAcc = 0;
	let clock = 0; // fallback timebase when G carries no clock
	let stuckT = 0;
	let crouchTarget = 0;

	function now(G) {
		if (G && typeof G.simTime === "number") return G.simTime;
		if (G && typeof G.time === "number") return G.time;
		return clock;
	}
	function rand(G) {
		return G && typeof G.rng === "function" ? G.rng : Math.random;
	}
	function eyeHeight() {
		return lerp(CFG.eyeStand, CFG.eyeCrouch, actor.crouch01);
	}

	// --- graph helpers ---
	function nearestNodeName(pos) {
		if (!graph || !graph.nodes) return null;
		let best = null;
		let bestD = Infinity;
		const it = graph.nodes instanceof Map ? graph.nodes.entries() : Object.entries(graph.nodes);
		for (const [name, node] of it) {
			if (!node || !node.pos) continue;
			const d = node.pos.distanceToSquared(pos);
			if (d < bestD) { bestD = d; best = name; }
		}
		return best;
	}
	function nodePos(name) {
		const n = nodeOf(graph, name);
		return n ? n.pos : null;
	}
	// Nearest cover-flagged node within `radius` of centre, preferring the
	// one closest to refPos (keeps bots spread over different cover).
	function pickCoverNear(centre, radius, refPos) {
		if (!graph || !graph.nodes) return null;
		let best = null;
		let bestD = Infinity;
		const it = graph.nodes instanceof Map ? graph.nodes.values() : Object.values(graph.nodes);
		for (const node of it) {
			if (!node || !node.cover || !node.pos) continue;
			if (node.pos.distanceTo(centre) > radius) continue;
			const d = node.pos.distanceToSquared(refPos);
			if (d < bestD) { bestD = d; best = node.pos; }
		}
		return best;
	}
	// Cover choice for falling back: near me, but as far from the threat
	// as the nearby cover allows.
	function pickCoverAway(centre, radius, threatPos) {
		if (!graph || !graph.nodes) return null;
		let best = null;
		let bestScore = -Infinity;
		const it = graph.nodes instanceof Map ? graph.nodes.values() : Object.values(graph.nodes);
		for (const node of it) {
			if (!node || !node.cover || !node.pos) continue;
			const dMe = node.pos.distanceTo(centre);
			if (dMe > radius) continue;
			const score = node.pos.distanceTo(threatPos) - dMe * 0.5;
			if (score > bestScore) { bestScore = score; best = node.pos; }
		}
		return best;
	}
	function siteCentre(G, site) {
		const w = G && G.world;
		if (w && w.sites && w.sites[site]) {
			if (w.sites[site].plantPos) return w.sites[site].plantPos;
			if (w.sites[site].zone) return w.sites[site].zone.getCenter(new THREE.Vector3());
		}
		return nodePos(SITE_NODE[site]);
	}

	// Routes the bot to an exact position: A* between the nearest nodes,
	// then a final leg of direct steering to the point itself.
	function setDest(pos) {
		finalPos.copy(pos);
		pathPts.length = 0;
		const from = nearestNodeName(actor.pos);
		const to = nearestNodeName(pos);
		if (from && to && graph) {
			const names = findPath(graph, from, to);
			for (const n of names) {
				const p = nodePos(n);
				if (p) pathPts.push(p);
			}
		}
		// Drop a first leg that is already behind us.
		while (pathPts.length > 1 && pathPts[0].distanceToSquared(actor.pos) < 1.2) pathPts.shift();
		pathPts.push(finalPos);
		pathI = 0;
		atDest = false;
		hasDest = true;
	}

	// Points the bot's idle gaze at the lane it is guarding.
	function pickWatch(site) {
		const entries = SITE_ENTRIES[site] || SITE_ENTRIES.A;
		let best = null;
		let bestD = Infinity;
		for (const name of entries) {
			const p = nodePos(name);
			if (!p) continue;
			const d = p.distanceToSquared(actor.pos);
			if (d < bestD) { bestD = d; best = p; }
		}
		if (best) watchPos.copy(best);
		else watchPos.set(actor.pos.x - Math.sin(actor.yaw) * 10, actor.pos.y, actor.pos.z - Math.cos(actor.yaw) * 10);
	}

	// Works out where this bot belongs this round and starts the rollout.
	function planAssignment(G) {
		const centre = siteCentre(G, mySite === "mid" ? callSite : mySite);
		task = "assignment";
		if (team === 0 && isCarrier) {
			// The carrier goes to the plant spot of the called site.
			const plant = siteCentre(G, callSite);
			if (plant) setDest(plant);
			state = "rollout";
			pickWatch(callSite);
			return;
		}
		if (mySite === "mid") {
			const mid = nodePos("mid_nest") || nodePos("mid_doors") || centre;
			if (mid) setDest(mid);
			state = "rollout";
			watchPos.copy(nodePos("mid_doors") || finalPos);
			return;
		}
		if (!centre) { state = "hold"; return; }
		if (flex) {
			// Flex attackers stage at a connector instead of the site itself.
			const entries = SITE_ENTRIES[mySite] || [];
			let best = null;
			let bestD = Infinity;
			for (const name of entries) {
				const p = nodePos(name);
				if (!p) continue;
				const d = p.distanceToSquared(actor.pos);
				if (d < bestD) { bestD = d; best = p; }
			}
			setDest(best || centre);
		} else {
			// Take cover near the site; the reference point halfway from
			// spawn spreads teammates over different pieces of cover.
			aimPoint.copy(centre).add(actor.pos).multiplyScalar(0.5);
			const cover = pickCoverNear(centre, 15, aimPoint);
			setDest(cover || centre);
		}
		state = "rollout";
		pickWatch(mySite);
	}

	// Post-plant and retake planning once the bomb is down.
	function planBombPlay(G, bombPos) {
		if (team === 0) {
			// Ember holds an angle on its own bomb.
			const cover = pickCoverNear(bombPos, 14, actor.pos);
			setDest(cover || bombPos);
			task = "postplant";
			state = "rotate";
			watchPos.copy(bombPos);
		} else {
			// The closest Guard defuses; the rest cover the approach.
			let iAmClosest = true;
			for (const a of G.actors || []) {
				if (a === actor || a.team !== 1 || !a.alive) continue;
				if (a.pos.distanceToSquared(bombPos) < actor.pos.distanceToSquared(bombPos)) { iAmClosest = false; break; }
			}
			if (iAmClosest) setDest(bombPos);
			else setDest(pickCoverNear(bombPos, 13, actor.pos) || bombPos);
			task = "retake";
			state = "retake";
			watchPos.copy(bombPos);
		}
	}

	// --- perception ------------------------------------------------------------
	function smokeBlocks(G, a, b) {
		const fx = G && G.effects;
		if (!fx) return false;
		const clouds = fx.smokes || fx.smokeClouds || fx.smokeSpheres;
		if (!Array.isArray(clouds)) return false;
		const t = now(G);
		for (const s of clouds) {
			if (!s || !s.pos) continue;
			if (typeof s.until === "number" && t > s.until) continue;
			const r = typeof s.radius === "number" ? s.radius : (typeof s.r === "number" ? s.r : 3.4);
			// Distance from the cloud centre to the sight segment a→b.
			aimDir.subVectors(b, a);
			const len2 = aimDir.lengthSq();
			const u = len2 > 0 ? clamp(sideDir.subVectors(s.pos, a).dot(aimDir) / len2, 0, 1) : 0;
			aimPoint.copy(a).addScaledVector(aimDir, u);
			if (aimPoint.distanceToSquared(s.pos) < r * r) return true;
		}
		return false;
	}

	function canSee(G, enemy) {
		eye.copy(actor.pos); eye.y += eyeHeight();
		aimPoint.copy(enemy.pos);
		aimPoint.y += lerp(1.25, 0.9, enemy.crouch01); // aim height at the chest
		sideDir.subVectors(aimPoint, eye);
		const dist = sideDir.length();
		if (dist > VISION_RANGE || dist < 0.01) return false;
		// Vision cone around the facing direction (flat - bots scan level).
		const fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw); // -Z forward convention
		const dot = (sideDir.x * fx + sideDir.z * fz) / dist;
		if (dot < VISION_COS) return false;
		if (!hasLOS(eye, aimPoint, colliders)) return false;
		if (smokeBlocks(G, eye, aimPoint)) return false;
		return true;
	}

	function scanPerception(G, t) {
		visibleEnemy = null;
		let bestD = Infinity;
		for (const a of G.actors || []) {
			if (a === actor || a.team === team || !a.alive) continue;
			if (!canSee(G, a)) continue;
			const d = a.pos.distanceToSquared(actor.pos);
			if (d < bestD) { bestD = d; visibleEnemy = a; }
		}
		if (visibleEnemy) {
			if (target !== visibleEnemy) {
				target = visibleEnemy;
				targetSince = t;
				reactionAt = t + randRange(rand(G), 0.28, 0.45);
			}
			lastSeenT = t;
			lastKnownT = t;
			lastKnownPos.copy(visibleEnemy.pos);
			return;
		}
		// Fresh damage is information too: face the shooter.
		if (actor.lastAttacker && actor.lastAttacker.alive
			&& t - actor.lastDamageAt < 1.5) {
			lastKnownPos.copy(actor.lastAttacker.pos);
			lastKnownT = Math.max(lastKnownT, actor.lastDamageAt);
		}
		// Hearing: rounds/weapons publish noise events {pos, radius, t}.
		const events = G.noiseEvents;
		if (Array.isArray(events)) {
			for (const ev of events) {
				if (!ev || !ev.pos) continue;
				if (typeof ev.t === "number" && t - ev.t > 0.6) continue;
				const radius = typeof ev.radius === "number" ? ev.radius : HEAR_FOOTSTEP_FALLBACK;
				if (ev.pos.distanceTo(actor.pos) > radius) continue;
				// Ignore shots that clearly came from a teammate beside us.
				let fromTeammate = false;
				for (const a of G.actors || []) {
					if (a.team === team && a.alive && a !== actor && a.pos.distanceToSquared(ev.pos) < 16) { fromTeammate = true; break; }
				}
				if (fromTeammate) continue;
				if (t - lastKnownT > 0.5 || ev.pos.distanceToSquared(lastKnownPos) > 4) {
					lastKnownPos.copy(ev.pos);
					lastKnownT = t;
					alertT = t;
				}
			}
		}
	}

	// --- the 10 Hz brain ---------------------------------------------------------
	function think(G) {
		const t = now(G);
		const match = G.match || null;
		const phase = match ? match.phase : undefined;
		const bombPlanted = !!(match && match.bombPlanted);

		// Adopt the world late if reset() ran before it existed.
		if (!graph && G.world && G.world.graph) graph = G.world.graph;
		if ((!colliders || colliders.length === 0) && G.world && G.world.colliders) colliders = G.world.colliders;
		if (!isCarrier && match && match.bombCarrier === actor) isCarrier = true;
		if (!hasDest && graph) planAssignment(G);

		scanPerception(G, t);

		// The bomb changes everyone's job the moment it is down.
		if (bombPlanted && task !== "postplant" && task !== "retake" && state !== "defuse") {
			const bp = match.bombPos || siteCentre(G, match.bombSite || callSite);
			if (bp) planBombPlay(G, bp);
		}

		// A visible enemy interrupts everything except defusing focus -
		// and even that breaks off, a defuse under fire is a dead defuser.
		if (visibleEnemy && state !== "engage") {
			state = "engage";
			return;
		}

		switch (state) {
			case "engage": {
				if (!visibleEnemy && t - lastSeenT > 2.5) {
					// Lost them: clear the last known position, then resume.
					setDest(lastKnownPos);
					task = "investigate";
					state = "rotate";
				}
				break;
			}
			case "rollout": {
				if (atDest) {
					if (team === 0 && isCarrier) {
						state = "takePosition"; // final steps to the plant spot
						const plant = siteCentre(G, callSite);
						if (plant) setDest(plant);
					} else {
						state = "hold";
					}
				}
				break;
			}
			case "takePosition": {
				if (atDest) {
					if (team === 0 && isCarrier && !bombPlanted) state = "plant";
					else state = "hold";
				}
				break;
			}
			case "plant": {
				// Plant only with a second of quiet and inside the zone.
				const bp = siteCentre(G, callSite);
				const inZone = bp ? actor.pos.distanceTo(bp) < 4.2 : false;
				if (!inZone) { state = "takePosition"; if (bp) setDest(bp); break; }
				if (t - lastSeenT < 1) break; // wait for quiet
				if (match && typeof match.requestPlant === "function") match.requestPlant(actor);
				if (bombPlanted) { task = "assignment"; state = "hold"; }
				break;
			}
			case "defuse": {
				const bp = match && match.bombPos ? match.bombPos : siteCentre(G, match && match.bombSite ? match.bombSite : "A");
				if (!bp) { state = "hold"; break; }
				if (actor.pos.distanceTo(bp) > 2.4) { setDest(bp); state = "retake"; task = "retake"; break; }
				if (match && typeof match.requestDefuse === "function") match.requestDefuse(actor);
				break;
			}
			case "retake": {
				if (atDest) {
					const bp = match && match.bombPos ? match.bombPos : null;
					const mine = bp && actor.pos.distanceTo(bp) < 2.4;
					state = mine ? "defuse" : "hold";
				}
				break;
			}
			case "rotate": {
				if (atDest) {
					if (task === "postplant" || task === "retake") state = "hold";
					else if (task === "fallback") state = "cover";
					else planAssignment(G); // investigated - back to the plan
				}
				break;
			}
			case "cover": {
				// Stay down until the threat picture is a few seconds old.
				if (t - lastSeenT > 4 && t - actor.lastDamageAt > 4) planAssignment(G);
				break;
			}
			case "hold": {
				// Hurt and recently threatened: break to cover.
				if (actor.hp < 35 && (t - lastSeenT < 3 || t - actor.lastDamageAt < 3)) {
					const threat = visibleEnemy ? visibleEnemy.pos : lastKnownPos;
					const cover = pickCoverAway(actor.pos, 18, threat);
					if (cover) { setDest(cover); task = "fallback"; state = "rotate"; }
					break;
				}
				// Late round with no information: a Guard goes hunting.
				if (team === 1 && !bombPlanted && match && typeof match.timeLeft === "number"
					&& match.timeLeft < 25 && t - lastKnownT > 6) {
					const other = mySite === "A" ? "B" : "A";
					const c = siteCentre(G, other);
					if (c) { setDest(c); task = "hunt"; state = "hunt"; }
				}
				break;
			}
			case "hunt": {
				if (atDest) { pickWatch(mySite === "A" ? "B" : "A"); state = "hold"; }
				break;
			}
			default: break;
		}

		// Keep the gaze honest while holding: watch the lane, or the last
		// place trouble was heard from.
		if (state === "hold" || state === "cover") {
			if (t - alertT < 3) watchPos.copy(lastKnownPos);
			else if (task === "postplant" || task === "retake") watchPos.copy(finalPos);
		}
		// The carrier's plant spot only exists once the world does.
		if (team === 0 && isCarrier && !plantRefined && G.world) {
			const plant = siteCentre(G, callSite);
			if (plant && (state === "rollout")) { setDest(plant); plantRefined = true; }
		}
	}

	// --- per-step update -----------------------------------------------------------
	function update(dt, G) {
		if (!actor.alive) return;
		clock += dt;
		const t = now(G);
		const match = G ? G.match : null;
		const phase = match ? match.phase : undefined;

		// Freeze time is for shopping, not moving.
		if (phase === "freeze") {
			if (!bought && match && typeof match.botBuy === "function") {
				match.botBuy(actor);
				bought = true;
			}
			actor.vel.x = 0; actor.vel.z = 0;
			actor.vel.y -= CFG.gravity * dt;
			slideMove(actor.pos, actor.vel, dt, colliders || []);
			return;
		}

		thinkAcc += dt;
		if (thinkAcc >= 0.1) { thinkAcc = 0; think(G || {}); }

		const fighting = !phase || phase === "live" || phase === "planted";
		const frozen = phase === "end" || phase === "menu";

		// ---- steering ----
		// In a fight the bot never path-walks: it plants its feet or strafes.
		// Aiming always uses the visible enemy, or the last known position
		// for a fraction of a second after losing sight - never live data
		// about a target it cannot currently see.
		const inFight = state === "engage";
		const canShoot = inFight && fighting && (visibleEnemy !== null || t - lastSeenT < 0.35);
		const aimPos = visibleEnemy ? visibleEnemy.pos : lastKnownPos;
		const aimCrouch = visibleEnemy ? visibleEnemy.crouch01 : 0;

		let wantX = 0, wantZ = 0, wantSpeed = 0;
		if (!frozen && !inFight && hasDest && !atDest && pathPts.length > 0) {
			const targetPt = pathPts[Math.min(pathI, pathPts.length - 1)];
			sideDir.subVectors(targetPt, actor.pos); sideDir.y = 0;
			const dist = sideDir.length();
			const reach = pathI >= pathPts.length - 1 ? 0.7 : 1.15;
			if (dist < reach) {
				pathI++;
				if (pathI >= pathPts.length) atDest = true;
			} else {
				sideDir.multiplyScalar(1 / dist);
				wantX = sideDir.x; wantZ = sideDir.z;
				wantSpeed = state === "takePosition" ? 3.6 : CFG.speedRun;
				if (actor.crouch01 > 0.5) wantSpeed = Math.min(wantSpeed, CFG.speedCrouch);
			}
		}

		// ---- combat movement: plant feet beyond 12 m, strafe up close ----
		if (canShoot) {
			const d = Math.hypot(aimPos.x - actor.pos.x, aimPos.z - actor.pos.z);
			if (d <= 12 && visibleEnemy) {
				const s = Math.sin(t * 1.9 + strafeSeed) >= 0 ? 1 : -1;
				wantX = Math.cos(actor.yaw) * s;
				wantZ = -Math.sin(actor.yaw) * s;
				wantSpeed = CFG.speedWalk * 0.7;
			} else {
				wantSpeed = 0; wantX = 0; wantZ = 0;
			}
		}
		if (state === "plant" || state === "defuse" || state === "hold" || state === "cover") {
			wantSpeed = 0; wantX = 0; wantZ = 0;
		}

		// ---- integrate ----
		actor.vel.x = wantX * wantSpeed;
		actor.vel.z = wantZ * wantSpeed;
		actor.vel.y -= CFG.gravity * dt;
		const beforeX = actor.pos.x, beforeZ = actor.pos.z;
		slideMove(actor.pos, actor.vel, dt, colliders || []);

		// Stuck detection: wanting to move but barely moving - skip a leg.
		if (wantSpeed > 0.5) {
			const moved = Math.hypot(actor.pos.x - beforeX, actor.pos.z - beforeZ);
			if (moved < 0.25 * wantSpeed * dt) stuckT += dt; else stuckT = 0;
			if (stuckT > 0.7) {
				stuckT = 0;
				if (!atDest && pathI < pathPts.length - 1) pathI++;
				else if (hasDest) setDest(finalPos);
			}
		} else stuckT = 0;

		// ---- facing & crouch ----
		let yawGoal = actor.yaw;
		if (inFight) {
			yawGoal = Math.atan2(-(aimPos.x - actor.pos.x), -(aimPos.z - actor.pos.z));
		} else if (wantSpeed > 0.5) {
			yawGoal = Math.atan2(-wantX, -wantZ);
		} else if (state === "hold" || state === "cover" || state === "plant" || state === "defuse") {
			yawGoal = Math.atan2(-(watchPos.x - actor.pos.x), -(watchPos.z - actor.pos.z));
		}
		actor.yaw = angleLerp(actor.yaw, yawGoal, 1 - Math.exp(-9 * dt));
		if (inFight) {
			const dy = (aimPos.y + lerp(1.25, 0.9, aimCrouch)) - (actor.pos.y + eyeHeight());
			const dxz = Math.hypot(aimPos.x - actor.pos.x, aimPos.z - actor.pos.z);
			actor.pitch = damp(actor.pitch, Math.atan2(dy, Math.max(dxz, 0.01)), 14, dt);
		} else {
			actor.pitch = damp(actor.pitch, 0, 8, dt);
		}
		crouchTarget = (state === "hold" || state === "cover") && !visibleEnemy ? 1 : 0;
		actor.crouch01 = damp(actor.crouch01, crouchTarget, 9, dt);

		// ---- trigger discipline: bursts of 3-5, short pauses ----
		if (canShoot && t >= reactionAt) {
			if (!bursting) {
				pauseT -= dt;
				if (pauseT <= 0) { bursting = true; burstT = randRange(rand(G), 0.3, 0.55); }
			}
			if (bursting) {
				burstT -= dt;
				// Aim at the chest, perturbed by the tracking error cone:
				// 2.2° on first sight, tightening to 0.5° over 1.2 s.
				eye.copy(actor.pos); eye.y += eyeHeight();
				aimPoint.copy(aimPos); aimPoint.y += lerp(1.25, 0.9, aimCrouch);
				aimDir.subVectors(aimPoint, eye).normalize();
				const trackT = clamp((t - targetSince) / 1.2, 0, 1);
				const err = Math.tan(lerp(2.2, 0.5, visibleEnemy ? trackT : 0) * Math.PI / 180);
				const r = rand(G);
				sideDir.set(-aimDir.z, 0, aimDir.x).normalize();
				aimDir.addScaledVector(sideDir, (r() * 2 - 1) * err);
				aimDir.y += (r() * 2 - 1) * err;
				aimDir.normalize();
				const shot = fire(G, actor, aimDir);
				if (shot === false) {
					dryT += dt;
					if (dryT > 0.6) { reload(actor); dryT = -2.5; bursting = false; pauseT = 0.3; }
				} else dryT = Math.max(0, dryT - dt);
				if (burstT <= 0) { bursting = false; pauseT = 0.25; }
			}
		} else {
			bursting = false;
			pauseT = 0;
			dryT = 0;
		}
	}

	// --- round setup ---------------------------------------------------------------
	function reset(roundInfo) {
		const info = roundInfo || {};
		graph = info.graph || graph;
		colliders = info.colliders || colliders;
		callSite = info.callSite === "B" ? "B" : "A";
		isCarrier = !!(info.isCarrier || actor.hasBomb);
		flex = info.role === "flex";
		if (info.role === "carrier") isCarrier = true;

		if (info.site === "A" || info.site === "B" || info.site === "mid") mySite = info.site;
		else if (info.role === "mid") mySite = "mid";
		else if (info.role === "A" || info.role === "B") mySite = info.role;
		else if (team === 0) mySite = callSite;
		else {
			let h = 0;
			for (let i = 0; i < actor.name.length; i++) h = (h * 31 + actor.name.charCodeAt(i)) | 0;
			mySite = GUARD_ROTATION[Math.abs(h) % GUARD_ROTATION.length];
		}
		if (team === 0 && isCarrier) mySite = callSite;

		visibleEnemy = null;
		target = null;
		lastSeenT = -Infinity;
		lastKnownT = -Infinity;
		alertT = -Infinity;
		bursting = false;
		dryT = 0;
		stuckT = 0;
		bought = false;
		plantRefined = false;
		task = "assignment";
		planAssignment(null);
	}

	return { update, reset };
}
