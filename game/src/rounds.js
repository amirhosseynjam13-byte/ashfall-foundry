// rounds.js - the match brain: phases, the round timer, the bomb, the
// economy and the score. It owns no rendering and no input; it mutates actor
// state (through actors.js / weapons.js helpers) and talks to the HUD and
// audio through G, so the whole match reads from one place: G.match.

import { CFG, WEAPONS, ARMOR, GRENADES } from "./config.js";
import { randPick } from "./util.js";
import { giveWeapon, createLoadout } from "./weapons.js";

export function createMatch(G) {
	const M = {
		phase: "menu", // menu | freeze | live | planted | end | matchover
		phaseT: 0, // seconds left in the current phase
		roundNum: 0,
		score: [0, 0], // [ember, guard]
		history: [], // round winners in order, for the HUD pips
		timeLeft: 0, // mirrors phaseT for HUD/bots (phaseT counts down)
		bombPlanted: false, bombPos: null, bombSite: null, // flat mirrors of bomb, for bots/HUD
		lossStreak: [0, 0],
		bomb: null, // { state: carried|dropped|planted|exploded|defused, carrier, site, pos, t }
		channel: null, // { actor, kind: 'plant'|'defuse', t, dur, site }
		lastWinner: -1,
		lastReason: "",
		callSite: "A",

		startMatch,
		startRound,
		buy,
		botBuy,
		requestPlant,
		requestDefuse,
		handleKill,
		update,
	};

	function teamActors(team) {
		return G.actors.filter((a) => a.team === team);
	}
	function aliveCount(team) {
		return teamActors(team).reduce((n, a) => n + (a.alive ? 1 : 0), 0);
	}

	// --- match / round setup ---------------------------------------------------

	function startMatch() {
		M.score = [0, 0];
		M.history = [];
		M.lossStreak = [0, 0];
		M.roundNum = 0;
		for (const a of G.actors) {
			a.money = CFG.startMoney;
			a.kills = 0;
			a.deaths = 0;
		}
		startRound();
	}

	function startRound() {
		M.roundNum++;
		M.channel = null;
		// the call: most rounds hit one site, sometimes the other
		M.callSite = G.rng() < 0.55 ? "A" : "B";

		const spawns = G.world.spawns;
		for (const team of [0, 1]) {
			const list = teamActors(team);
			list.forEach((a, i) => {
				const s = spawns[team === 0 ? "ember" : "guard"][i % 5];
				a.pos.copy(s);
				a.vel.set(0, 0, 0);
				a.yaw = team === 0 ? -Math.PI / 2 : Math.PI / 2; // face mid-field (-Z forward convention)
				a.pitch = 0;
				a.hp = 100;
				a.alive = true;
				a.crouch01 = 0;
				a.hasBomb = false;
				a.planting = false;
				a.defusing = false;
				a.mesh.position.copy(s);
				a.mesh.rotation.set(0, 0, 0);
				a.mesh.visible = !a.isPlayer; // first person: never render your own body
				if (!a.loadout) a.loadout = createLoadout();
				// survivors keep their kit; the dead re-issue with a fresh
				// loadout (createLoadout already puts knife + P9 in hand)
				if (a.roundDied) {
					a.loadout = createLoadout();
					a.armor = 0;
					a.helmet = false;
				}
				a.roundDied = false;
			});
		}

		// hand the bomb to a random living Ember member
		const ember = teamActors(0).filter((a) => a.alive);
		const carrier = ember[Math.floor(G.rng() * ember.length)];
		carrier.hasBomb = true;
		M.bomb = { state: "carried", carrier, site: null, pos: null, t: 0 };

		// bots get their orders for the round
		for (const a of G.actors) {
			if (a.mind) a.mind.reset({ callSite: M.callSite, roundNum: M.roundNum });
			if (!a.isPlayer && a.alive) botBuy(a);
		}

		setPhase("freeze", CFG.freezeTime);
		if (G.hud) G.hud.banner(`Round ${M.roundNum}`, M.callSite === "A" ? "Hit the Furnace" : "Hit the Cooling Yard", 0);
	}

	function setPhase(phase, t) {
		M.phase = phase;
		M.phaseT = t;
	}

	// --- economy -----------------------------------------------------------------

	function award(team, amount) {
		for (const a of teamActors(team)) {
			a.money = Math.min(CFG.maxMoney, a.money + amount);
		}
	}

	function buy(actor, kind, id) {
		if (M.phase !== "freeze" || !actor.alive) return false;
		let price = 0;
		if (kind === "weapon") price = WEAPONS[id]?.price ?? -1;
		else if (kind === "armor") price = ARMOR[id]?.price ?? -1;
		else if (kind === "grenade") price = GRENADES[id]?.price ?? -1;
		if (price < 0 || actor.money < price) return false;

		if (kind === "weapon") {
			if (actor.loadout.states && actor.loadout.states[id]) return false; // already own it
			giveWeapon(actor, id);
		} else if (kind === "armor") {
			if (id === "vest") {
				if (actor.armor >= 100) return false;
				actor.armor = 100;
			} else {
				if (actor.armor >= 100 && actor.helmet) return false;
				actor.armor = 100;
				actor.helmet = true;
			}
		} else {
			if (actor.loadout.grenades[id] >= 1) return false; // one of each, CS style
			actor.loadout.grenades[id]++;
		}
		actor.money -= price;
		if (G.audio) G.audio.buy();
		return true;
	}

	// Simple, believable bot shopping: rifle first, armour with the change,
	// grenades when rich. Runs in freeze, spends through the same buy() rules.
	function botBuy(actor) {
		const tryBuy = (kind, id) => buy(actor, kind, id);
		const st = actor.loadout && actor.loadout.states;
		const hasPrimary = !!(st && (st.vulcan || st.raptor || st.mule || st.longshot));
		if (!hasPrimary) {
			if (actor.money >= 2700 + 650) { tryBuy("weapon", "vulcan"); tryBuy("armor", "vest"); }
			else if (actor.money >= 2700) tryBuy("weapon", "vulcan");
			else if (actor.money >= 1400 + 650) { tryBuy("weapon", "raptor"); tryBuy("armor", "vest"); }
			else if (actor.money >= 1400) tryBuy("weapon", "raptor");
			else if (actor.money >= 1100) tryBuy("weapon", "mule");
			else if (actor.money >= 650 && G.rng() < 0.5) tryBuy("armor", "vest");
		} else {
			if (actor.money >= 1000 && !actor.helmet) tryBuy("armor", "vestHelmet");
			else if (actor.money >= 650 && actor.armor < 100) tryBuy("armor", "vest");
		}
		if (actor.money >= 900) { tryBuy("grenade", "frag"); tryBuy("grenade", "smoke"); }
		if (actor.money >= 500) tryBuy("grenade", "flash");
	}

	// --- bomb interactions ---------------------------------------------------------

	function inSite(actor, siteName) {
		const zone = G.world.sites[siteName].zone;
		return (
			actor.pos.x >= zone.min.x && actor.pos.x <= zone.max.x &&
			actor.pos.z >= zone.min.z && actor.pos.z <= zone.max.z &&
			Math.abs(actor.pos.y - zone.min.y) < 3
		);
	}

	function requestPlant(actor) {
		if (M.phase !== "live" || !actor.hasBomb || M.channel) return false;
		const site = inSite(actor, "A") ? "A" : inSite(actor, "B") ? "B" : null;
		if (!site) return false;
		M.channel = { actor, kind: "plant", t: 0, dur: CFG.plantTime, site, x: actor.pos.x, z: actor.pos.z };
		actor.planting = true;
		return true;
	}

	function requestDefuse(actor) {
		if (M.phase !== "planted" || M.channel || !M.bomb || M.bomb.state !== "planted") return false;
		const d = actor.pos.distanceTo(M.bomb.pos);
		if (d > 2.2) return false;
		const dur = actor.team === 1 ? CFG.defuseTimeKit : CFG.defuseTimeNoKit; // Guard carry kits
		M.channel = { actor, kind: "defuse", t: 0, dur, site: M.bomb.site, x: actor.pos.x, z: actor.pos.z };
		actor.defusing = true;
		return true;
	}

	function finishPlant() {
		const ch = M.channel;
		const actor = ch.actor;
		actor.planting = false;
		actor.hasBomb = false;
		M.bomb = {
			state: "planted",
			carrier: null,
			site: ch.site,
			pos: actor.pos.clone(),
			t: CFG.bombTime,
		};
		M.channel = null;
		award(0, CFG.plantRewardTeam);
		setPhase("planted", CFG.bombTime);
		if (G.audio) G.audio.plant();
		if (G.hud) G.hud.banner("Charge planted", `Site ${ch.site} — ${CFG.bombTime} seconds`, 0);
		// every bot hears the plant callout
		G.noiseEvents.push({ pos: M.bomb.pos.clone(), radius: 999, t: G.simTime, kind: "planted" });
	}

	function finishDefuse() {
		const actor = M.channel.actor;
		actor.defusing = false;
		M.bomb.state = "defused";
		M.channel = null;
		if (G.audio) G.audio.defuse();
		endRound(1, "defuse");
	}

	// --- kills and round end ---------------------------------------------------------

	function handleKill(attacker, victim) {
		victim.roundDied = true;
		if (attacker && attacker.team !== victim.team) {
			attacker.money = Math.min(CFG.maxMoney, attacker.money + CFG.killReward);
		}
		// a dead carrier drops the bomb where he fell
		if (M.bomb && M.bomb.state === "carried" && M.bomb.carrier === victim) {
			M.bomb = { state: "dropped", carrier: null, site: null, pos: victim.pos.clone(), t: 0 };
			victim.hasBomb = false;
		}
		if (M.channel && M.channel.actor === victim) {
			victim.planting = false;
			victim.defusing = false;
			M.channel = null;
		}
		if (M.phase === "live") {
			if (aliveCount(1) === 0) endRound(0, "elimination");
			else if (aliveCount(0) === 0) endRound(1, "elimination");
		} else if (M.phase === "planted") {
			// CS rule: wiping the Guard after the plant ends it; wiping Ember
			// does not — the charge still has to be defused.
			if (aliveCount(1) === 0) endRound(0, "elimination");
		}
	}

	function endRound(winner, reason) {
		if (M.phase === "end" || M.phase === "matchover") return;
		M.lastWinner = winner;
		M.lastReason = reason;
		M.score[winner]++;
		M.history.push(winner);
		M.lossStreak[winner] = 0;
		const loser = 1 - winner;
		M.lossStreak[loser] = Math.min(4, M.lossStreak[loser] + 1);

		const objective = reason === "detonation" || reason === "defuse";
		award(winner, objective ? CFG.winRewardObjective : CFG.winRewardElim);
		const lossPay = Math.min(
			CFG.lossBase + (M.lossStreak[loser] - 1) * CFG.lossStreakStep,
			CFG.lossBase + CFG.lossStreakCap,
		);
		award(loser, lossPay);

		const reasonText = {
			elimination: "Team eliminated",
			detonation: "Charge detonated",
			defuse: "Charge defused",
			time: "Time expired — site held",
		}[reason] || reason;
		if (G.hud) G.hud.banner(`${CFG.teamNames[winner]} win the round`, reasonText, winner);
		if (G.audio) G.audio.sting(G.player && G.player.team === winner);

		const matchWon = M.score[winner] >= CFG.roundsToWin || M.roundNum >= CFG.maxRounds;
		setPhase(matchWon ? "matchover" : "end", matchWon ? 999 : CFG.roundEndTime);
		if (matchWon && G.hud) {
			G.hud.matchEnd(M.score[0] > M.score[1] ? 0 : M.score[1] > M.score[0] ? 1 : -1, M.score);
		}
	}

	// --- per-step update ---------------------------------------------------------------

	function update(dt) {
		// prune the noise board bots listen to
		if (G.noiseEvents) {
			while (G.noiseEvents.length && G.simTime - G.noiseEvents[0].t > 1.5) G.noiseEvents.shift();
		}
		// flat mirrors the HUD and bot brains read
		M.timeLeft = M.phaseT;
		M.bombPlanted = !!(M.bomb && M.bomb.state === "planted");
		M.bombPos = M.bomb ? M.bomb.pos : null;
		M.bombSite = M.bomb ? M.bomb.site : null;
		if (M.bomb) M.bomb.planted = M.bomb.state === "planted";
		if (M.phase === "menu" || M.phase === "matchover") return;

		M.phaseT -= dt;

		// channel progress (plant / defuse): moving or dying cancels
		if (M.channel) {
			const ch = M.channel;
			const moved = Math.hypot(ch.actor.pos.x - ch.x, ch.actor.pos.z - ch.z);
			if (!ch.actor.alive || moved > 0.6) {
				ch.actor.planting = false;
				ch.actor.defusing = false;
				M.channel = null;
			} else {
				ch.t += dt;
				if (ch.kind === "plant" && G.audio && Math.floor(ch.t * 2) !== Math.floor((ch.t - dt) * 2)) G.audio.beep(false);
				if (ch.t >= ch.dur) {
					if (ch.kind === "plant") finishPlant();
					else finishDefuse();
				}
			}
		}

		// dropped-bomb pickup: an Ember walking over it takes it
		if (M.bomb && M.bomb.state === "dropped" && (M.phase === "live")) {
			for (const a of teamActors(0)) {
				if (a.alive && a.pos.distanceTo(M.bomb.pos) < 1.1) {
					M.bomb = { state: "carried", carrier: a, site: null, pos: null, t: 0 };
					a.hasBomb = true;
					break;
				}
			}
		}

		if (M.phase === "freeze") {
			if (M.phaseT <= 0) setPhase("live", CFG.roundTime);
		} else if (M.phase === "live") {
			if (M.phaseT <= 0) endRound(1, "time");
		} else if (M.phase === "planted") {
			if (M.bomb && M.bomb.state === "planted") {
				M.bomb.t -= dt;
				// beep rate: 1 Hz early, 5 Hz in the last ten seconds
				const remain = M.bomb.t;
				const interval = remain > 10 ? 1 : remain > 5 ? 0.5 : 0.2;
				if (Math.floor(remain / interval) !== Math.floor((remain + dt) / interval)) {
					if (G.audio) G.audio.beep(remain <= 5);
				}
				if (remain <= 0) {
					M.bomb.state = "exploded";
					if (G.effects) G.effects.explosion(M.bomb.pos);
					if (G.audio) G.audio.explosion();
					endRound(0, "detonation");
				}
			}
		} else if (M.phase === "end") {
			if (M.phaseT <= 0) startRound();
		}
	}

	return M;
}
