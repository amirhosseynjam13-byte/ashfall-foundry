// bots.js - bot brains: A* over the waypoint graph, perception, roles, plants, defuses, retakes.
import * as THREE from "three";
import { CFG } from "./config.js";
import { clamp,lerp,damp,randRange,angleLerp,hasLOS,slideMove } from "./util.js";
import { fire,reload } from "./weapons.js";

function nodeOf(graph,name) {
	if (!graph || !graph.nodes) return null;
	return graph.nodes instanceof Map ? graph.nodes.get(name) || null : graph.nodes[name] || null;
}
function neighboursOf(graph,name) {
	if (!graph || !graph.edges) return [];
	const e=graph.edges instanceof Map ? graph.edges.get(name) : graph.edges[name];
	return e || [];
}

export function findPath(graph,fromName,toName) {
	const start=nodeOf(graph,fromName);
	const goal=nodeOf(graph,toName);
	if (!start || !goal) return [];
	if (fromName === toName) return [fromName];

	const open=[fromName];
	const cameFrom=new Map();
	const gScore=new Map([[fromName,0]]);
	const fScore=new Map([[fromName,start.pos.distanceTo(goal.pos)]]);
	const closed=new Set();

	while (open.length > 0) {
		let bestI=0;
		for (let i=1; i < open.length; i++) {
			if ((fScore.get(open[i]) ?? Infinity) < (fScore.get(open[bestI]) ?? Infinity)) bestI=i;
		}
		const cur=open.splice(bestI,1)[0];
		if (cur === toName) {
			const path=[cur];
			let n=cur;
			while (cameFrom.has(n)) { n=cameFrom.get(n); path.unshift(n); }
			return path;
		}
		if (closed.has(cur)) continue;
		closed.add(cur);
		const curPos=nodeOf(graph,cur).pos;
		const g=gScore.get(cur);
		for (const nb of neighboursOf(graph,cur)) {
			const nbNode=nodeOf(graph,nb);
			if (!nbNode) continue;
			const tg=g + curPos.distanceTo(nbNode.pos);
			if (tg < (gScore.get(nb) ?? Infinity)) {
				cameFrom.set(nb,cur);
				gScore.set(nb,tg);
				fScore.set(nb,tg + nbNode.pos.distanceTo(goal.pos));
				if (!open.includes(nb)) open.push(nb);
			}
		}
	}
	return [];
}

const SITE_NODE={ A: "a_site",B: "b_site" };
const SITE_ENTRIES={
	A: ["a_main","a_door","a_link"],
	B: ["b_main","b_tun","window"],
};
const GUARD_ROTATION=["A","B","A","B","mid"];

const VISION_COS=Math.cos((100 / 2) * (Math.PI / 180));
const VISION_RANGE=65;
const HEAR_FOOTSTEP_FALLBACK=9;

export function createBotMind(actor,team) {

	const eye=new THREE.Vector3();
	const aimPoint=new THREE.Vector3();
	const aimDir=new THREE.Vector3();
	const sideDir=new THREE.Vector3();
	const lastKnownPos=new THREE.Vector3();
	const finalPos=new THREE.Vector3();
	const watchPos=new THREE.Vector3();
	const pathPts=[];

	let graph=null;
	let colliders=[];
	let callSite="A";
	let mySite="A";
	let isCarrier=false;
	let flex=false;
	let bought=false;
	let plantRefined=false;

	let state="rollout";
	let task="assignment";
	let pathI=0;
	let atDest=true;
	let hasDest=false;

	let visibleEnemy=null;
	let target=null;
	let targetSince=0;
	let reactionAt=0;
	let lastSeenT=-Infinity;
	let lastKnownT=-Infinity;
	let alertT=-Infinity;

	let bursting=false;
	let burstT=0;
	let pauseT=0;
	let dryT=0;
	let strafeSeed=Math.abs(Math.sin(actor.name.length * 12.9898) * 43758.5453) % (Math.PI * 2);

	let thinkAcc=0;
	let clock=0;
	let stuckT=0;
	let crouchTarget=0;

	function now(G) {
		if (G && typeof G.simTime === "number") return G.simTime;
		if (G && typeof G.time === "number") return G.time;
		return clock;
	}
	function rand(G) {
		return G && typeof G.rng === "function" ? G.rng : Math.random;
	}
	function eyeHeight() {
		return lerp(CFG.eyeStand,CFG.eyeCrouch,actor.crouch01);
	}

	function nearestNodeName(pos) {
		if (!graph || !graph.nodes) return null;
		let best=null;
		let bestD=Infinity;
		const it=graph.nodes instanceof Map ? graph.nodes.entries() : Object.entries(graph.nodes);
		for (const [name,node] of it) {
			if (!node || !node.pos) continue;
			const d=node.pos.distanceToSquared(pos);
			if (d < bestD) { bestD=d; best=name; }
		}
		return best;
	}
	function nodePos(name) {
		const n=nodeOf(graph,name);
		return n ? n.pos : null;
	}

	function pickCoverNear(centre,radius,refPos) {
		if (!graph || !graph.nodes) return null;
		let best=null;
		let bestD=Infinity;
		const it=graph.nodes instanceof Map ? graph.nodes.values() : Object.values(graph.nodes);
		for (const node of it) {
			if (!node || !node.cover || !node.pos) continue;
			if (node.pos.distanceTo(centre) > radius) continue;
			const d=node.pos.distanceToSquared(refPos);
			if (d < bestD) { bestD=d; best=node.pos; }
		}
		return best;
	}

	function pickCoverAway(centre,radius,threatPos) {
		if (!graph || !graph.nodes) return null;
		let best=null;
		let bestScore=-Infinity;
		const it=graph.nodes instanceof Map ? graph.nodes.values() : Object.values(graph.nodes);
		for (const node of it) {
			if (!node || !node.cover || !node.pos) continue;
			const dMe=node.pos.distanceTo(centre);
			if (dMe > radius) continue;
			const score=node.pos.distanceTo(threatPos) - dMe * 0.5;
			if (score > bestScore) { bestScore=score; best=node.pos; }
		}
		return best;
	}
	function siteCentre(G,site) {
		const w=G && G.world;
		if (w && w.sites && w.sites[site]) {
			if (w.sites[site].plantPos) return w.sites[site].plantPos;
			if (w.sites[site].zone) return w.sites[site].zone.getCenter(new THREE.Vector3());
		}
		return nodePos(SITE_NODE[site]);
	}

	function setDest(pos) {
		finalPos.copy(pos);
		pathPts.length=0;
		const from=nearestNodeName(actor.pos);
		const to=nearestNodeName(pos);
		if (from && to && graph) {
			const names=findPath(graph,from,to);
			for (const n of names) {
				const p=nodePos(n);
				if (p) pathPts.push(p);
			}
		}

		while (pathPts.length > 1 && pathPts[0].distanceToSquared(actor.pos) < 1.2) pathPts.shift();
		pathPts.push(finalPos);
		pathI=0;
		atDest=false;
		hasDest=true;
	}

	function pickWatch(site) {
		const entries=SITE_ENTRIES[site] || SITE_ENTRIES.A;
		let best=null;
		let bestD=Infinity;
		for (const name of entries) {
			const p=nodePos(name);
			if (!p) continue;
			const d=p.distanceToSquared(actor.pos);
			if (d < bestD) { bestD=d; best=p; }
		}
		if (best) watchPos.copy(best);
		else watchPos.set(actor.pos.x - Math.sin(actor.yaw) * 10,actor.pos.y,actor.pos.z - Math.cos(actor.yaw) * 10);
	}

	function planAssignment(G) {
		const centre=siteCentre(G,mySite === "mid" ? callSite : mySite);
		task="assignment";
		if (team === 0 && isCarrier) {

			const plant=siteCentre(G,callSite);
			if (plant) setDest(plant);
			state="rollout";
			pickWatch(callSite);
			return;
		}
		if (mySite === "mid") {
			const mid=nodePos("mid_nest") || nodePos("mid_doors") || centre;
			if (mid) setDest(mid);
			state="rollout";
			watchPos.copy(nodePos("mid_doors") || finalPos);
			return;
		}
		if (!centre) { state="hold"; return; }
		if (flex) {

			const entries=SITE_ENTRIES[mySite] || [];
			let best=null;
			let bestD=Infinity;
			for (const name of entries) {
				const p=nodePos(name);
				if (!p) continue;
				const d=p.distanceToSquared(actor.pos);
				if (d < bestD) { bestD=d; best=p; }
			}
			setDest(best || centre);
		} else {

			aimPoint.copy(centre).add(actor.pos).multiplyScalar(0.5);
			const cover=pickCoverNear(centre,15,aimPoint);
			setDest(cover || centre);
		}
		state="rollout";
		pickWatch(mySite);
	}

	function planBombPlay(G,bombPos) {
		if (team === 0) {

			const cover=pickCoverNear(bombPos,14,actor.pos);
			setDest(cover || bombPos);
			task="postplant";
			state="rotate";
			watchPos.copy(bombPos);
		} else {

			let iAmClosest=true;
			for (const a of G.actors || []) {
				if (a === actor || a.team !== 1 || !a.alive) continue;
				if (a.pos.distanceToSquared(bombPos) < actor.pos.distanceToSquared(bombPos)) { iAmClosest=false; break; }
			}
			if (iAmClosest) setDest(bombPos);
			else setDest(pickCoverNear(bombPos,13,actor.pos) || bombPos);
			task="retake";
			state="retake";
			watchPos.copy(bombPos);
		}
	}

	function smokeBlocks(G,a,b) {
		const fx=G && G.effects;
		if (!fx) return false;
		const clouds=fx.smokes || fx.smokeClouds || fx.smokeSpheres;
		if (!Array.isArray(clouds)) return false;
		const t=now(G);
		for (const s of clouds) {
			if (!s || !s.pos) continue;
			if (typeof s.until === "number" && t > s.until) continue;
			const r=typeof s.radius === "number" ? s.radius : (typeof s.r === "number" ? s.r : 3.4);

			aimDir.subVectors(b,a);
			const len2=aimDir.lengthSq();
			const u=len2 > 0 ? clamp(sideDir.subVectors(s.pos,a).dot(aimDir) / len2,0,1) : 0;
			aimPoint.copy(a).addScaledVector(aimDir,u);
			if (aimPoint.distanceToSquared(s.pos) < r * r) return true;
		}
		return false;
	}

	function canSee(G,enemy) {
		eye.copy(actor.pos); eye.y += eyeHeight();
		aimPoint.copy(enemy.pos);
		aimPoint.y += lerp(1.25,0.9,enemy.crouch01);
		sideDir.subVectors(aimPoint,eye);
		const dist=sideDir.length();
		if (dist > VISION_RANGE || dist < 0.01) return false;

		const fx=-Math.sin(actor.yaw),fz=-Math.cos(actor.yaw);
		const dot=(sideDir.x * fx + sideDir.z * fz) / dist;
		if (dot < VISION_COS) return false;
		if (!hasLOS(eye,aimPoint,colliders)) return false;
		if (smokeBlocks(G,eye,aimPoint)) return false;
		return true;
	}

	function scanPerception(G,t) {
		visibleEnemy=null;
		let bestD=Infinity;
		for (const a of G.actors || []) {
			if (a === actor || a.team === team || !a.alive) continue;
			if (!canSee(G,a)) continue;
			const d=a.pos.distanceToSquared(actor.pos);
			if (d < bestD) { bestD=d; visibleEnemy=a; }
		}
		if (visibleEnemy) {
			if (target !== visibleEnemy) {
				target=visibleEnemy;
				targetSince=t;
				reactionAt=t + randRange(rand(G),0.28,0.45);
			}
			lastSeenT=t;
			lastKnownT=t;
			lastKnownPos.copy(visibleEnemy.pos);
			return;
		}

		if (actor.lastAttacker && actor.lastAttacker.alive
			&& t - actor.lastDamageAt < 1.5) {
			lastKnownPos.copy(actor.lastAttacker.pos);
			lastKnownT=Math.max(lastKnownT,actor.lastDamageAt);
		}

		const events=G.noiseEvents;
		if (Array.isArray(events)) {
			for (const ev of events) {
				if (!ev || !ev.pos) continue;
				if (typeof ev.t === "number" && t - ev.t > 0.6) continue;
				const radius=typeof ev.radius === "number" ? ev.radius : HEAR_FOOTSTEP_FALLBACK;
				if (ev.pos.distanceTo(actor.pos) > radius) continue;

				let fromTeammate=false;
				for (const a of G.actors || []) {
					if (a.team === team && a.alive && a !== actor && a.pos.distanceToSquared(ev.pos) < 16) { fromTeammate=true; break; }
				}
				if (fromTeammate) continue;
				if (t - lastKnownT > 0.5 || ev.pos.distanceToSquared(lastKnownPos) > 4) {
					lastKnownPos.copy(ev.pos);
					lastKnownT=t;
					alertT=t;
				}
			}
		}
	}

	function think(G) {
		const t=now(G);
		const match=G.match || null;
		const phase=match ? match.phase : undefined;
		const bombPlanted=!!(match && match.bombPlanted);

		if (!graph && G.world && G.world.graph) graph=G.world.graph;
		if ((!colliders || colliders.length === 0) && G.world && G.world.colliders) colliders=G.world.colliders;
		if (!isCarrier && match && match.bombCarrier === actor) isCarrier=true;
		if (!hasDest && graph) planAssignment(G);

		scanPerception(G,t);

		if (bombPlanted && task !== "postplant" && task !== "retake" && state !== "defuse") {
			const bp=match.bombPos || siteCentre(G,match.bombSite || callSite);
			if (bp) planBombPlay(G,bp);
		}

		if (visibleEnemy && state !== "engage") {
			state="engage";
			return;
		}

		switch (state) {
			case "engage": {
				if (!visibleEnemy && t - lastSeenT > 2.5) {

					setDest(lastKnownPos);
					task="investigate";
					state="rotate";
				}
				break;
			}
			case "rollout": {
				if (atDest) {
					if (team === 0 && isCarrier) {
						state="takePosition";
						const plant=siteCentre(G,callSite);
						if (plant) setDest(plant);
					} else {
						state="hold";
					}
				}
				break;
			}
			case "takePosition": {
				if (atDest) {
					if (team === 0 && isCarrier && !bombPlanted) state="plant";
					else state="hold";
				}
				break;
			}
			case "plant": {

				const bp=siteCentre(G,callSite);
				const inZone=bp ? actor.pos.distanceTo(bp) < 4.2 : false;
				if (!inZone) { state="takePosition"; if (bp) setDest(bp); break; }
				if (t - lastSeenT < 1) break;
				if (match && typeof match.requestPlant === "function") match.requestPlant(actor);
				if (bombPlanted) { task="assignment"; state="hold"; }
				break;
			}
			case "defuse": {
				const bp=match && match.bombPos ? match.bombPos : siteCentre(G,match && match.bombSite ? match.bombSite : "A");
				if (!bp) { state="hold"; break; }
				if (actor.pos.distanceTo(bp) > 2.4) { setDest(bp); state="retake"; task="retake"; break; }
				if (match && typeof match.requestDefuse === "function") match.requestDefuse(actor);
				break;
			}
			case "retake": {
				if (atDest) {
					const bp=match && match.bombPos ? match.bombPos : null;
					const mine=bp && actor.pos.distanceTo(bp) < 2.4;
					state=mine ? "defuse" : "hold";
				}
				break;
			}
			case "rotate": {
				if (atDest) {
					if (task === "postplant" || task === "retake") state="hold";
					else if (task === "fallback") state="cover";
					else planAssignment(G);
				}
				break;
			}
			case "cover": {

				if (t - lastSeenT > 4 && t - actor.lastDamageAt > 4) planAssignment(G);
				break;
			}
			case "hold": {

				if (actor.hp < 35 && (t - lastSeenT < 3 || t - actor.lastDamageAt < 3)) {
					const threat=visibleEnemy ? visibleEnemy.pos : lastKnownPos;
					const cover=pickCoverAway(actor.pos,18,threat);
					if (cover) { setDest(cover); task="fallback"; state="rotate"; }
					break;
				}

				if (team === 1 && !bombPlanted && match && typeof match.timeLeft === "number"
					&& match.timeLeft < 25 && t - lastKnownT > 6) {
					const other=mySite === "A" ? "B" : "A";
					const c=siteCentre(G,other);
					if (c) { setDest(c); task="hunt"; state="hunt"; }
				}
				break;
			}
			case "hunt": {
				if (atDest) { pickWatch(mySite === "A" ? "B" : "A"); state="hold"; }
				break;
			}
			default: break;
		}

		if (state === "hold" || state === "cover") {
			if (t - alertT < 3) watchPos.copy(lastKnownPos);
			else if (task === "postplant" || task === "retake") watchPos.copy(finalPos);
		}

		if (team === 0 && isCarrier && !plantRefined && G.world) {
			const plant=siteCentre(G,callSite);
			if (plant && (state === "rollout")) { setDest(plant); plantRefined=true; }
		}
	}

	function update(dt,G) {
		if (!actor.alive) return;
		clock += dt;
		const t=now(G);
		const match=G ? G.match : null;
		const phase=match ? match.phase : undefined;

		if (phase === "freeze") {
			if (!bought && match && typeof match.botBuy === "function") {
				match.botBuy(actor);
				bought=true;
			}
			actor.vel.x=0; actor.vel.z=0;
			actor.vel.y -= CFG.gravity * dt;
			slideMove(actor.pos,actor.vel,dt,colliders || []);
			return;
		}

		thinkAcc += dt;
		if (thinkAcc >= 0.1) { thinkAcc=0; think(G || {}); }

		const fighting=!phase || phase === "live" || phase === "planted";
		const frozen=phase === "end" || phase === "menu";

		const inFight=state === "engage";
		const canShoot=inFight && fighting && (visibleEnemy !== null || t - lastSeenT < 0.35);
		const aimPos=visibleEnemy ? visibleEnemy.pos : lastKnownPos;
		const aimCrouch=visibleEnemy ? visibleEnemy.crouch01 : 0;

		let wantX=0,wantZ=0,wantSpeed=0;
		if (!frozen && !inFight && hasDest && !atDest && pathPts.length > 0) {
			const targetPt=pathPts[Math.min(pathI,pathPts.length - 1)];
			sideDir.subVectors(targetPt,actor.pos); sideDir.y=0;
			const dist=sideDir.length();
			const reach=pathI >= pathPts.length - 1 ? 0.7 : 1.15;
			if (dist < reach) {
				pathI++;
				if (pathI >= pathPts.length) atDest=true;
			} else {
				sideDir.multiplyScalar(1 / dist);
				wantX=sideDir.x; wantZ=sideDir.z;
				wantSpeed=state === "takePosition" ? 3.6 : CFG.speedRun;
				if (actor.crouch01 > 0.5) wantSpeed=Math.min(wantSpeed,CFG.speedCrouch);
			}
		}

		if (canShoot) {
			const d=Math.hypot(aimPos.x - actor.pos.x,aimPos.z - actor.pos.z);
			if (d <= 12 && visibleEnemy) {
				const s=Math.sin(t * 1.9 + strafeSeed) >= 0 ? 1 : -1;
				wantX=Math.cos(actor.yaw) * s;
				wantZ=-Math.sin(actor.yaw) * s;
				wantSpeed=CFG.speedWalk * 0.7;
			} else {
				wantSpeed=0; wantX=0; wantZ=0;
			}
		}
		if (state === "plant" || state === "defuse" || state === "hold" || state === "cover") {
			wantSpeed=0; wantX=0; wantZ=0;
		}

		actor.vel.x=wantX * wantSpeed;
		actor.vel.z=wantZ * wantSpeed;
		actor.vel.y -= CFG.gravity * dt;
		const beforeX=actor.pos.x,beforeZ=actor.pos.z;
		slideMove(actor.pos,actor.vel,dt,colliders || []);

		if (wantSpeed > 0.5) {
			const moved=Math.hypot(actor.pos.x - beforeX,actor.pos.z - beforeZ);
			if (moved < 0.25 * wantSpeed * dt) stuckT += dt; else stuckT=0;
			if (stuckT > 0.7) {
				stuckT=0;
				if (!atDest && pathI < pathPts.length - 1) pathI++;
				else if (hasDest) setDest(finalPos);
			}
		} else stuckT=0;

		let yawGoal=actor.yaw;
		if (inFight) {
			yawGoal=Math.atan2(-(aimPos.x - actor.pos.x),-(aimPos.z - actor.pos.z));
		} else if (wantSpeed > 0.5) {
			yawGoal=Math.atan2(-wantX,-wantZ);
		} else if (state === "hold" || state === "cover" || state === "plant" || state === "defuse") {
			yawGoal=Math.atan2(-(watchPos.x - actor.pos.x),-(watchPos.z - actor.pos.z));
		}
		actor.yaw=angleLerp(actor.yaw,yawGoal,1 - Math.exp(-9 * dt));
		if (inFight) {
			const dy=(aimPos.y + lerp(1.25,0.9,aimCrouch)) - (actor.pos.y + eyeHeight());
			const dxz=Math.hypot(aimPos.x - actor.pos.x,aimPos.z - actor.pos.z);
			actor.pitch=damp(actor.pitch,Math.atan2(dy,Math.max(dxz,0.01)),14,dt);
		} else {
			actor.pitch=damp(actor.pitch,0,8,dt);
		}
		crouchTarget=(state === "hold" || state === "cover") && !visibleEnemy ? 1 : 0;
		actor.crouch01=damp(actor.crouch01,crouchTarget,9,dt);

		if (canShoot && t >= reactionAt) {
			if (!bursting) {
				pauseT -= dt;
				if (pauseT <= 0) { bursting=true; burstT=randRange(rand(G),0.3,0.55); }
			}
			if (bursting) {
				burstT -= dt;

				eye.copy(actor.pos); eye.y += eyeHeight();
				aimPoint.copy(aimPos); aimPoint.y += lerp(1.25,0.9,aimCrouch);
				aimDir.subVectors(aimPoint,eye).normalize();
				const trackT=clamp((t - targetSince) / 1.2,0,1);
				const err=Math.tan(lerp(2.2,0.5,visibleEnemy ? trackT : 0) * Math.PI / 180);
				const r=rand(G);
				sideDir.set(-aimDir.z,0,aimDir.x).normalize();
				aimDir.addScaledVector(sideDir,(r() * 2 - 1) * err);
				aimDir.y += (r() * 2 - 1) * err;
				aimDir.normalize();
				const shot=fire(G,actor,aimDir);
				if (shot === false) {
					dryT += dt;
					if (dryT > 0.6) { reload(actor); dryT=-2.5; bursting=false; pauseT=0.3; }
				} else dryT=Math.max(0,dryT - dt);
				if (burstT <= 0) { bursting=false; pauseT=0.25; }
			}
		} else {
			bursting=false;
			pauseT=0;
			dryT=0;
		}
	}

	function reset(roundInfo) {
		const info=roundInfo || {};
		graph=info.graph || graph;
		colliders=info.colliders || colliders;
		callSite=info.callSite === "B" ? "B" : "A";
		isCarrier=!!(info.isCarrier || actor.hasBomb);
		flex=info.role === "flex";
		if (info.role === "carrier") isCarrier=true;

		if (info.site === "A" || info.site === "B" || info.site === "mid") mySite=info.site;
		else if (info.role === "mid") mySite="mid";
		else if (info.role === "A" || info.role === "B") mySite=info.role;
		else if (team === 0) mySite=callSite;
		else {
			let h=0;
			for (let i=0; i < actor.name.length; i++) h=(h * 31 + actor.name.charCodeAt(i)) | 0;
			mySite=GUARD_ROTATION[Math.abs(h) % GUARD_ROTATION.length];
		}
		if (team === 0 && isCarrier) mySite=callSite;

		visibleEnemy=null;
		target=null;
		lastSeenT=-Infinity;
		lastKnownT=-Infinity;
		alertT=-Infinity;
		bursting=false;
		dryT=0;
		stuckT=0;
		bought=false;
		plantRefined=false;
		task="assignment";
		planAssignment(null);
	}

	return { update,reset };
}
