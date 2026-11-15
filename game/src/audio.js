// audio.js - every sound in Ashfall Foundry is synthesised with WebAudio.
// There are no audio assets: gunshots are shaped noise bursts over a pitched
// body thump, foley is timed clicks, the foundry ambience is a low hum with
// random distant clangs. The context is created lazily by unlock(), which the
// page calls on the first user gesture; every method is a no-op before that.
//
// Distance model for shots: shot(kind, dist) takes the distance in metres
// from the listener (the local player). Far shots lose volume and top end,
// so a firefight across the map sounds muffled instead of identical.

export function createAudio() {
	let ctx = null;
	let master = null;
	let noiseBuf = null;
	let muted = false;
	let stepAlternate = false;
	let ambientNodes = null;

	// Per-class gunshot recipes: noise length, lowpass body, thump pitch.
	const SHOT_RECIPES = {
		pistol: { noise: 0.14, cutoff: 5200, thump: 165, thumpGain: 0.5, vol: 0.55 },
		smg: { noise: 0.11, cutoff: 5600, thump: 150, thumpGain: 0.42, vol: 0.48 },
		rifle: { noise: 0.2, cutoff: 4800, thump: 120, thumpGain: 0.65, vol: 0.7 },
		shotgun: { noise: 0.34, cutoff: 2600, thump: 82, thumpGain: 0.9, vol: 0.85 },
		sniper: { noise: 0.5, cutoff: 6200, thump: 68, thumpGain: 1.0, vol: 0.95 },
	};

	function unlock() {
		if (ctx) {
			if (ctx.state === "suspended") ctx.resume();
			return;
		}
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return;
		ctx = new AC();
		master = ctx.createGain();
		master.gain.value = muted ? 0 : 0.9;
		master.connect(ctx.destination);
		// One shared second of white noise feeds every noise-based sound.
		noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
		const data = noiseBuf.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	}

	function noiseSource() {
		const src = ctx.createBufferSource();
		src.buffer = noiseBuf;
		return src;
	}

	// Short filtered noise burst with an exponential decay envelope.
	function burst({ dur, type = "lowpass", freq, q = 0.8, vol, when = 0, sweepTo = null }) {
		const t0 = ctx.currentTime + when;
		const src = noiseSource();
		const filter = ctx.createBiquadFilter();
		filter.type = type;
		filter.frequency.setValueAtTime(freq, t0);
		if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
		filter.Q.value = q;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(vol, t0);
		gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
		src.connect(filter).connect(gain).connect(master);
		src.start(t0, Math.random() * 0.4);
		src.stop(t0 + dur + 0.05);
	}

	// Pitched blip with a pitch drop and decay - thumps, dings, beeps, stings.
	function tone({ freq, endFreq = null, type = "sine", dur, vol, when = 0 }) {
		const t0 = ctx.currentTime + when;
		const osc = ctx.createOscillator();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, t0);
		if (endFreq !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(vol, t0);
		gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
		osc.connect(gain).connect(master);
		osc.start(t0);
		osc.stop(t0 + dur + 0.05);
	}

	function shot(kind, dist = 0) {
		if (!ctx) return;
		const recipe = SHOT_RECIPES[kind];
		if (!recipe) return;
		const d = Math.max(0, dist);
		const volScale = 1 / (1 + d * 0.085);
		const cutoff = Math.max(420, recipe.cutoff - d * 150);
		burst({ dur: recipe.noise, freq: cutoff, vol: recipe.vol * volScale });
		tone({
			freq: recipe.thump, endFreq: recipe.thump * 0.45, type: "triangle",
			dur: 0.13, vol: recipe.thumpGain * volScale,
		});
		if (kind === "sniper") {
			// A long crack tail rolling off, like a shot across a yard.
			burst({ dur: 0.55, freq: 900, vol: 0.16 * volScale, when: 0.05, sweepTo: 220 });
		}
	}

	// Reload foley: three mechanical clicks spread over the reload. The mule
	// loads per shell, so weapons.js calls this once per shell there.
	function reload(kind) {
		if (!ctx) return;
		if (kind === "shotgun") {
			burst({ dur: 0.05, type: "bandpass", freq: 900, q: 2, vol: 0.3 });
			burst({ dur: 0.04, type: "bandpass", freq: 1500, q: 2, vol: 0.22, when: 0.16 });
			return;
		}
		burst({ dur: 0.04, type: "bandpass", freq: 1200, q: 2.5, vol: 0.28 });
		burst({ dur: 0.05, type: "bandpass", freq: 700, q: 2, vol: 0.3, when: 0.45 });
		burst({ dur: 0.04, type: "bandpass", freq: 1800, q: 2.5, vol: 0.24, when: 0.85 });
	}

	function dry() {
		if (!ctx) return;
		burst({ dur: 0.035, type: "bandpass", freq: 2000, q: 3, vol: 0.25 });
	}

	function hit(head) {
		if (!ctx) return;
		burst({ dur: 0.03, type: "highpass", freq: 2500, vol: 0.22 });
		if (head) tone({ freq: 2150, endFreq: 1900, dur: 0.13, vol: 0.2 });
	}

	function kill() {
		if (!ctx) return;
		tone({ freq: 660, type: "square", dur: 0.07, vol: 0.12 });
		tone({ freq: 990, type: "square", dur: 0.1, vol: 0.12, when: 0.07 });
	}

	function step(run) {
		if (!ctx) return;
		stepAlternate = !stepAlternate;
		burst({
			dur: run ? 0.09 : 0.06, freq: stepAlternate ? 340 : 290, vol: run ? 0.16 : 0.08,
		});
	}

	function jump() {
		if (!ctx) return;
		burst({ dur: 0.09, type: "bandpass", freq: 500, sweepTo: 1100, q: 1.2, vol: 0.07 });
	}

	function land() {
		if (!ctx) return;
		burst({ dur: 0.12, freq: 240, vol: 0.22 });
		tone({ freq: 72, endFreq: 45, dur: 0.12, vol: 0.18 });
	}

	// kind: "throw" (pin + whoosh) or "bounce" (dull knock on metal/concrete).
	function nade(kind) {
		if (!ctx) return;
		if (kind === "bounce") {
			burst({ dur: 0.05, freq: 480, vol: 0.2 });
			tone({ freq: 210, endFreq: 140, dur: 0.06, vol: 0.1 });
		} else {
			burst({ dur: 0.03, type: "bandpass", freq: 2400, q: 3, vol: 0.2 });
			burst({ dur: 0.16, type: "bandpass", freq: 700, sweepTo: 1600, q: 1.4, vol: 0.08, when: 0.03 });
		}
	}

	function explosion() {
		if (!ctx) return;
		tone({ freq: 58, endFreq: 27, dur: 0.8, vol: 0.95 });
		burst({ dur: 0.9, freq: 3000, sweepTo: 120, vol: 0.7 });
		burst({ dur: 0.25, freq: 5000, vol: 0.4 });
	}

	// Bomb beep. rounds.js drives the rate (1 Hz, 5 Hz in the last 10 s);
	// `final` marks the sharper last-second beeps.
	function beep(final) {
		if (!ctx) return;
		tone({
			freq: final ? 1760 : 1240, type: "square",
			dur: final ? 0.16 : 0.07, vol: 0.1,
		});
	}

	function plant() {
		if (!ctx) return;
		tone({ freq: 880, type: "square", dur: 0.06, vol: 0.1 });
		tone({ freq: 1108, type: "square", dur: 0.06, vol: 0.1, when: 0.3 });
		tone({ freq: 1318, type: "square", dur: 0.09, vol: 0.12, when: 0.6 });
	}

	function defuse() {
		if (!ctx) return;
		tone({ freq: 1318, type: "square", dur: 0.06, vol: 0.1 });
		tone({ freq: 880, type: "square", dur: 0.1, vol: 0.12, when: 0.28 });
	}

	function buy() {
		if (!ctx) return;
		burst({ dur: 0.03, type: "bandpass", freq: 2600, q: 3, vol: 0.18 });
		tone({ freq: 1560, dur: 0.06, vol: 0.1, when: 0.04 });
	}

	// Two-note round sting; match wins reuse it (bigger second note).
	function sting(win) {
		if (!ctx) return;
		if (win) {
			tone({ freq: 659, type: "triangle", dur: 0.22, vol: 0.22 });
			tone({ freq: 880, type: "triangle", dur: 0.4, vol: 0.24, when: 0.16 });
		} else {
			tone({ freq: 330, type: "triangle", dur: 0.24, vol: 0.2 });
			tone({ freq: 262, type: "triangle", dur: 0.42, vol: 0.2, when: 0.18 });
		}
	}

	function startAmbient() {
		if (!ctx || ambientNodes) return;
		const humGain = ctx.createGain();
		humGain.gain.value = 0.05;
		humGain.connect(master);
		const hum1 = ctx.createOscillator();
		hum1.type = "sine";
		hum1.frequency.value = 48;
		const hum2 = ctx.createOscillator();
		hum2.type = "sine";
		hum2.frequency.value = 96.5;
		hum1.connect(humGain);
		hum2.connect(humGain);
		hum1.start();
		hum2.start();
		// Distant metal clangs at random intervals, like work in another hall.
		const clang = () => {
			if (!ambientNodes) return;
			burst({ dur: 0.3, type: "bandpass", freq: 1500 + Math.random() * 900, q: 6, vol: 0.05 });
			tone({ freq: 700 + Math.random() * 700, dur: 1.1, vol: 0.028 });
			ambientNodes.timer = setTimeout(clang, 3500 + Math.random() * 7500);
		};
		ambientNodes = { humGain, hum1, hum2, timer: setTimeout(clang, 2500) };
	}

	function stopAmbient() {
		if (!ambientNodes) return;
		clearTimeout(ambientNodes.timer);
		ambientNodes.hum1.stop();
		ambientNodes.hum2.stop();
		ambientNodes.humGain.disconnect();
		ambientNodes = null;
	}

	function toggleMute() {
		muted = !muted;
		if (master) master.gain.value = muted ? 0 : 0.9;
		return muted;
	}

	return {
		unlock, shot, reload, dry, hit, kill, step, jump, land, nade,
		explosion, beep, plant, defuse, buy, sting,
		startAmbient, stopAmbient, toggleMute,
	};
}
