// hud.js - all 2D interface: HUD, buy menu, scoreboard, banners, and the main menu with its weather picker.
import { CFG, WEAPONS, ARMOR, GRENADES, BUY } from "./config.js";

const CSS = `
#hud-root{position:fixed;inset:0;pointer-events:none;z-index:20;overflow:hidden;font-family:system-ui,"Segoe UI",Roboto,sans-serif;color:#ece7db;--ember:#ff7a26;--guard:#2fd4c4;--panel:rgba(9,14,17,.72);--line:rgba(255,255,255,.10);--dim:#98a2a8;--bad:#ff5340;-webkit-user-select:none;user-select:none}
#hud-root .num{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-variant-numeric:tabular-nums}
#hud-root[data-phase="menu"] .af-ingame,#hud-root[data-phase="over"] .af-ingame{display:none}
.af-vig{position:absolute;inset:0;opacity:0;transition:opacity .25s;background:radial-gradient(ellipse at center,transparent 52%,rgba(190,10,0,.55) 100%)}
.af-flash{position:absolute;inset:0;background:#fff;opacity:0}
.af-top{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:3px}
.af-round{font-size:11px;letter-spacing:.28em;color:var(--dim)}
.af-score{display:flex;align-items:center;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:4px 16px 5px}
.af-score .side{font-size:22px;font-weight:700}
.af-score .e{color:var(--ember)} .af-score .g{color:var(--guard)}
.af-timer{font-size:26px;font-weight:700;min-width:74px;text-align:center}
.af-timer.urgent{color:var(--bad)}
.af-pips{display:flex;gap:3px}
.af-pip{width:9px;height:9px;border-radius:2px;background:rgba(255,255,255,.13)}
.af-pip.e{background:var(--ember)} .af-pip.g{background:var(--guard)}
.af-bomb{display:none;flex-direction:column;align-items:center;gap:3px;margin-top:2px}
.af-bomb.on{display:flex}
.af-bomb .txt{color:#ffb03a;font-weight:700;letter-spacing:.14em;font-size:13px;animation:afpulse 1s infinite}
@keyframes afpulse{50%{opacity:.45}}
.af-bombbar{width:190px;height:5px;background:rgba(255,255,255,.15);border-radius:3px}
.af-bombbar i{display:block;height:100%;background:#ffb03a;border-radius:3px}
.af-kf{position:absolute;top:12px;right:14px;display:flex;flex-direction:column;gap:4px;align-items:flex-end}
.af-kfrow{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:3px 9px;font-size:13px;white-space:nowrap}
.af-kfrow .e{color:var(--ember)} .af-kfrow .g{color:var(--guard)}
.af-kfrow .wp{color:var(--dim);margin:0 6px;font-size:11px;letter-spacing:.08em}
.af-kfrow .skull{color:#ffd23a;margin-left:5px}
.af-bl{position:absolute;left:18px;bottom:16px;display:flex;flex-direction:column;gap:5px}
.af-teamtag{display:flex;align-items:center;gap:7px;font-size:12px;letter-spacing:.18em;font-weight:700;color:var(--ember)}
.af-teamtag .sq{width:10px;height:10px;background:var(--ember);border-radius:2px}
.af-teamtag .sub{color:var(--dim);font-weight:400;letter-spacing:.06em}
.af-stat{display:flex;align-items:center;gap:8px}
.af-stat .lab{width:30px;font-size:11px;color:var(--dim);letter-spacing:.1em}
.af-bar{width:190px;height:10px;background:rgba(255,255,255,.13);border-radius:3px;overflow:hidden}
.af-bar i{display:block;height:100%;background:#e8e2d2;transition:width .15s}
.af-bar.arm i{background:#7fb3c8}
.af-stat .val{font-size:17px;font-weight:700;min-width:36px}
.af-br{position:absolute;right:18px;bottom:16px;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.af-money{font-size:17px;font-weight:700;color:#9ed67e}
.af-wname{font-size:13px;letter-spacing:.12em;color:var(--dim)}
.af-ammo{display:flex;align-items:baseline;gap:7px}
.af-ammo .big{font-size:38px;font-weight:700;line-height:1}
.af-ammo .res{font-size:16px;color:var(--dim)}
.af-ammo.low .big{color:var(--bad)}
.af-nades{display:flex;gap:6px;margin-top:2px}
.af-nade{border:1px solid var(--line);background:var(--panel);border-radius:4px;padding:2px 7px;font-size:11px;letter-spacing:.08em;color:var(--dim)}
.af-nade.have{color:#ece7db;border-color:rgba(255,255,255,.35)}
.af-cross{position:absolute;left:50%;top:50%;width:0;height:0;--gap:9px}
.af-cross span{position:absolute;background:rgba(240,255,240,.92);box-shadow:0 0 3px rgba(0,0,0,.8)}
.af-cross .t{width:2px;height:9px;left:-1px;bottom:var(--gap)}
.af-cross .b{width:2px;height:9px;left:-1px;top:var(--gap)}
.af-cross .l{width:9px;height:2px;right:var(--gap);top:-1px}
.af-cross .r{width:9px;height:2px;left:var(--gap);top:-1px}
.af-cross .dot{width:2px;height:2px;left:-1px;top:-1px}
.af-hit{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0}
.af-hit span{position:absolute;width:10px;height:2px;background:#fff;box-shadow:0 0 3px rgba(0,0,0,.7)}
.af-hit .a{right:7px;bottom:7px;transform:rotate(45deg)}
.af-hit .b{left:7px;bottom:7px;transform:rotate(-45deg)}
.af-hit .c{right:7px;top:7px;transform:rotate(-45deg)}
.af-hit .d{left:7px;top:7px;transform:rotate(45deg)}
.af-hit.kill span{background:#ff4030}
.af-dmgc{position:absolute;left:50%;top:50%;width:0;height:0}
.af-arc{position:absolute;left:-80px;top:-80px;width:160px;height:160px;border-radius:50%;border:5px solid transparent;border-top-color:rgba(255,64,40,.9);opacity:0}
.af-prog{position:absolute;left:50%;top:60%;transform:translateX(-50%);display:none;flex-direction:column;align-items:center;gap:5px}
.af-prog.on{display:flex}
.af-prog .lab{font-size:13px;font-weight:700;letter-spacing:.22em}
.af-prog .bar{width:280px;height:8px;background:rgba(255,255,255,.15);border-radius:4px}
.af-prog .bar i{display:block;height:100%;background:var(--ember);border-radius:4px}
.af-buyhint{position:absolute;left:50%;bottom:110px;transform:translateX(-50%);font-size:13px;color:var(--dim);letter-spacing:.14em;display:none}
.af-buyhint.on{display:block}
.af-banner{position:absolute;left:50%;top:26%;transform:translate(-50%,-50%);text-align:center;opacity:0;transition:opacity .3s}
.af-banner.on{opacity:1}
.af-banner h1{margin:0;font-size:42px;letter-spacing:.12em;font-weight:800}
.af-banner p{margin:4px 0 0;font-size:15px;color:var(--dim);letter-spacing:.1em}
.af-panel{pointer-events:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px;backdrop-filter:blur(7px)}
.af-buy{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;padding:16px 18px}
.af-buy.on{display:block}
.af-buy h2{margin:0 0 10px;font-size:16px;letter-spacing:.18em;display:flex;justify-content:space-between;gap:30px}
.af-buy h2 .num{color:#9ed67e}
.af-buygrid{display:grid;grid-template-columns:repeat(3,168px);gap:8px}
.af-item{position:relative;border:1px solid var(--line);border-radius:6px;padding:8px 10px;cursor:pointer;background:rgba(255,255,255,.03)}
.af-item:hover{border-color:rgba(255,255,255,.4)}
.af-item .key{position:absolute;top:5px;right:7px;font-size:10px;color:var(--dim)}
.af-item .nm{font-size:13px;font-weight:700;padding-right:14px}
.af-item .pr{font-size:12px;color:#9ed67e;margin-top:2px}
.af-item.owned{border-color:#9ed67e;cursor:default}
.af-item.owned .pr{color:#9ed67e}
.af-item.poor{opacity:.42;cursor:default}
.af-buy .hint{margin-top:10px;font-size:11px;color:var(--dim);letter-spacing:.08em}
.af-board{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;padding:14px 18px;min-width:430px}
.af-board.on{display:block}
.af-board h3{margin:8px 0 6px;font-size:13px;letter-spacing:.2em}
.af-board h3.e{color:var(--ember)} .af-board h3.g{color:var(--guard)}
.af-brow{display:grid;grid-template-columns:1fr 42px 42px 74px 12px;gap:6px;font-size:13px;padding:2px 0}
.af-brow.head{color:var(--dim);font-size:11px;letter-spacing:.1em}
.af-brow.dead{opacity:.45}
.af-brow .dot{width:8px;height:8px;border-radius:50%;background:#9ed67e;align-self:center}
.af-brow.dead .dot{background:#666}
.af-overlay{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;pointer-events:auto;background:rgba(5,8,10,.5);backdrop-filter:blur(2px);text-align:center}
.af-overlay.on{display:flex}
.af-title{font-size:56px;font-weight:800;letter-spacing:.14em;margin:0;background:linear-gradient(92deg,#ffb03a,#ff7a26 45%,#2fd4c4);-webkit-background-clip:text;background-clip:text;color:transparent}
.af-sub{color:var(--dim);letter-spacing:.22em;font-size:13px}
.af-btn{pointer-events:auto;background:var(--ember);color:#14100c;border:0;border-radius:6px;font-size:18px;font-weight:800;letter-spacing:.14em;padding:12px 44px;cursor:pointer}
.af-btn:hover{filter:brightness(1.12)}
.af-controls{display:grid;grid-template-columns:auto auto;gap:5px 16px;font-size:13px;color:var(--dim);text-align:left;margin-top:6px}
.af-controls b{color:#ece7db;font-weight:600;text-align:right;font-family:ui-monospace,Consolas,monospace;font-size:12px}
.af-note{font-size:11px;color:var(--dim);letter-spacing:.06em}
.af-final{font-size:30px;font-weight:800;letter-spacing:.1em}
.af-wrow{display:flex;align-items:center;gap:8px;pointer-events:auto}
.af-wrow .lab{font-size:11px;letter-spacing:.22em;color:var(--dim)}
.af-wbtn{background:rgba(255,255,255,.05);color:var(--dim);border:1px solid var(--line);border-radius:5px;font-size:12px;font-weight:700;letter-spacing:.12em;padding:6px 14px;cursor:pointer}
.af-wbtn:hover{color:#ece7db;border-color:rgba(255,255,255,.4)}
.af-wbtn.on{color:#14100c;background:var(--ember);border-color:transparent}
`;

function make(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	return e;
}

const fmtMoney = (n) => "$" + Math.round(n).toLocaleString("en-US");
const fmtClock = (s) => {
	s = Math.max(0, Math.ceil(s));
	return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

function timerSeconds(m) {
	if (!m) return null;
	if (typeof m.timeLeft === "number") return m.timeLeft;
	const pt = m.phaseT ?? 0;
	switch (m.phase) {
		case "freeze": return CFG.freezeTime - pt;
		case "live": return CFG.roundTime - pt;
		case "planted": return m.bomb?.t ?? CFG.bombTime - pt;
		case "end": return CFG.roundEndTime - pt;
		default: return null;
	}
}

function ammoOf(p) {
	if (!p) return { id: null, ammo: null, reserve: null };
	const lo = p.loadout;
	const id = lo?.current ?? p.currentWeapon ?? lo?.currentId ?? null;
	let st = null;
	if (lo && id) st = lo.states?.[id] ?? lo.weapons?.[id] ?? null;
	if (!st && p.weapon && typeof p.weapon === "object") st = p.weapon;
	return {
		id,
		ammo: st?.ammo ?? st?.mag ?? p.ammo ?? null,
		reserve: st?.reserve ?? p.reserve ?? null,
	};
}

function grenadeCount(p, id) {
	return p?.loadout?.grenades?.[id] ?? p?.grenades?.[id] ?? 0;
}

function itemInfo(kind, id) {
	if (kind === "weapon") return WEAPONS[id];
	if (kind === "armor") return ARMOR[id];
	return GRENADES[id];
}

function ownedOf(p, kind, id) {
	if (!p) return false;
	if (kind === "weapon") {
		return !!(
			p.loadout?.states?.[id] ||
			p.loadout?.weapons?.[id] ||
			p.loadout?.owned?.has?.(id) ||
			(Array.isArray(p.weapons) && p.weapons.includes(id))
		);
	}
	if (kind === "armor") {
		return id === "vest" ? (p.armor ?? 0) > 0 : !!p.helmet;
	}
	return grenadeCount(p, id) > 0;
}

export function createHUD(G) {
	const style = document.createElement("style");
	style.textContent = CSS;
	document.head.appendChild(style);
	const root = make("div");
	root.id = "hud-root";
	root.dataset.phase = "menu";
	document.body.appendChild(root);

	const el = {};
	el.vig = make("div", "af-vig");
	el.flash = make("div", "af-flash");
	root.append(el.vig, el.flash);

	el.top = make("div", "af-top af-ingame");
	el.round = make("div", "af-round num", "ROUND 1");
	const score = make("div", "af-score");
	el.scoreE = make("span", "side e num", "0");
	el.timer = make("span", "af-timer num", "1:45");
	el.scoreG = make("span", "side g num", "0");
	score.append(el.scoreE, el.timer, el.scoreG);
	el.pips = make("div", "af-pips");
	el.bomb = make("div", "af-bomb");
	el.bombTxt = make("div", "txt", "BOMB PLANTED");
	const bombBar = make("div", "af-bombbar");
	el.bombFill = make("i");
	bombBar.append(el.bombFill);
	el.bomb.append(el.bombTxt, bombBar);
	el.top.append(el.round, score, el.pips, el.bomb);
	root.append(el.top);

	el.kf = make("div", "af-kf af-ingame");
	root.append(el.kf);
	const kfPool = [];
	for (let i = 0; i < 5; i++) {
		const row = make("div", "af-kfrow");
		row.style.display = "none";
		el.kf.append(row);
		kfPool.push({ el: row, t: 0 });
	}

	el.bl = make("div", "af-bl af-ingame");
	const tag = make("div", "af-teamtag");
	tag.append(make("span", "sq"), make("span", null, "EMBER CELL"),
		make("span", "sub", "ATTACK — PLANT THE CHARGE"));
	const hpRow = make("div", "af-stat");
	const hpBar = make("div", "af-bar");
	el.hpFill = make("i");
	hpBar.append(el.hpFill);
	el.hpVal = make("span", "val num", "100");
	hpRow.append(make("span", "lab", "HP"), hpBar, el.hpVal);
	const armRow = make("div", "af-stat");
	const armBar = make("div", "af-bar arm");
	el.armFill = make("i");
	armBar.append(el.armFill);
	el.armVal = make("span", "val num", "0");
	armRow.append(make("span", "lab", "ARM"), armBar, el.armVal);
	el.bl.append(tag, hpRow, armRow);
	root.append(el.bl);

	el.br = make("div", "af-br af-ingame");
	el.money = make("div", "af-money num", "$800");
	el.wname = make("div", "af-wname", "");
	const ammoRow = make("div", "af-ammo");
	el.ammoBig = make("span", "big num", "");
	el.ammoRes = make("span", "res num", "");
	ammoRow.append(el.ammoBig, el.ammoRes);
	el.ammoRow = ammoRow;
	el.nades = make("div", "af-nades");
	el.nadeChips = {};
	for (const id of ["frag", "smoke", "flash"]) {
		const chip = make("div", "af-nade num", id.toUpperCase() + " ×0");
		el.nades.append(chip);
		el.nadeChips[id] = chip;
	}
	el.br.append(el.money, el.wname, ammoRow, el.nades);
	root.append(el.br);

	el.cross = make("div", "af-cross af-ingame");
	for (const c of ["t", "b", "l", "r", "dot"]) el.cross.append(make("span", c));
	root.append(el.cross);
	el.hit = make("div", "af-hit af-ingame");
	for (const c of ["a", "b", "c", "d"]) el.hit.append(make("span", c));
	root.append(el.hit);

	el.dmgc = make("div", "af-dmgc af-ingame");
	root.append(el.dmgc);
	const arcs = [];
	for (let i = 0; i < 4; i++) {
		const a = make("div", "af-arc");
		el.dmgc.append(a);
		arcs.push({ el: a, t: 0 });
	}
	let arcNext = 0;

	el.prog = make("div", "af-prog af-ingame");
	el.progLab = make("div", "lab", "");
	const progBar = make("div", "bar");
	el.progFill = make("i");
	progBar.append(el.progFill);
	el.prog.append(el.progLab, progBar);
	root.append(el.prog);

	el.buyHint = make("div", "af-buyhint", "PRESS B — BUY MENU");
	root.append(el.buyHint);

	el.banner = make("div", "af-banner");
	el.bannerH = make("h1");
	el.bannerP = make("p");
	el.banner.append(el.bannerH, el.bannerP);
	root.append(el.banner);

	el.buy = make("div", "af-buy af-panel");
	const buyHead = make("h2");
	buyHead.append(make("span", null, "BUY MENU"));
	el.buyMoney = make("span", "num", "$0");
	buyHead.append(el.buyMoney);
	el.buyGrid = make("div", "af-buygrid");
	el.buy.append(buyHead, el.buyGrid,
		make("div", "hint", "Click or press 1–9 · B closes · freeze time only"));
	root.append(el.buy);
	const buyItems = BUY.map(([kind, id], i) => {
		const info = itemInfo(kind, id);
		const cell = make("div", "af-item");
		cell.append(
			make("span", "key num", String(i + 1)),
			make("div", "nm", info?.name ?? id),
			make("div", "pr num", fmtMoney(info?.price ?? 0)),
		);
		cell.addEventListener("click", () => buy(id));
		el.buyGrid.append(cell);
		return { kind, id, el: cell, price: info?.price ?? 0 };
	});

	el.board = make("div", "af-board af-panel");
	root.append(el.board);
	const boardRows = { 0: [], 1: [] };
	for (const team of [0, 1]) {
		el.board.append(make("h3", team === 0 ? "e" : "g",
			team === 0 ? "EMBER CELL" : "FOUNDRY GUARD"));
		const head = make("div", "af-brow head");
		for (const t of ["PLAYER", "K", "D", "MONEY", ""]) head.append(make("span", null, t));
		el.board.append(head);
		for (let i = 0; i < 5; i++) {
			const row = make("div", "af-brow");
			const cells = [];
			for (let j = 0; j < 5; j++) {
				const c = j === 4 ? make("span", "dot") : make("span", j > 0 ? "num" : null, "");
				row.append(c);
				cells.push(c);
			}
			el.board.append(row);
			boardRows[team].push({ el: row, cells });
		}
	}

	el.over = make("div", "af-overlay");
	el.overTitle = make("div", "af-final", "");
	el.overScore = make("div", "af-sub num", "");
	el.overStats = make("div", "af-note num", "");
	const againBtn = make("button", "af-btn", "PLAY AGAIN");
	againBtn.addEventListener("click", () => G.onRestart?.());
	el.over.append(el.overTitle, el.overScore, el.overStats, againBtn);
	root.append(el.over);

	el.pause = make("div", "af-overlay");
	el.pause.append(make("div", "af-final", "PAUSED"),
		make("div", "af-sub", "CLICK TO RESUME"));
	el.pause.addEventListener("click", () => G.onResume?.());
	root.append(el.pause);

	el.menu = make("div", "af-overlay on");
	el.menu.append(make("h1", "af-title", "ASHFALL FOUNDRY"),
		make("div", "af-sub", "5V5 TACTICAL FPS — EMBER CELL vs FOUNDRY GUARD"));
	const playBtn = make("button", "af-btn", "PLAY");
	playBtn.addEventListener("click", () => G.onPlay?.());
	el.menu.append(playBtn);

	const wrow = make("div", "af-wrow");
	wrow.append(make("span", "lab", "WEATHER"));
	const wbtns = {};
	function markWeather(id) {
		for (const k of Object.keys(wbtns)) wbtns[k].classList.toggle("on", k === id);
	}
	for (const [id, label] of [["dusk", "☀ DUSK"], ["rain", "🌧 RAIN"], ["snow", "❄ SNOW"]]) {
		const b = make("button", "af-wbtn", label);
		b.addEventListener("click", () => {
			try { localStorage.setItem("ashfall-weather", id); } catch {  }
			G.onWeather?.(id);
			markWeather(id);
		});
		wbtns[id] = b;
		wrow.append(b);
	}
	markWeather(G.weatherMode ?? "dusk");
	el.menu.append(wrow);
	const controls = make("div", "af-controls");
	const CONTROL_ROWS = [
		["W A S D", "move"], ["MOUSE", "look"], ["LMB", "fire"], ["RMB", "aim / scope"],
		["R", "reload"], ["1 2 3 4", "weapon slots"], ["B", "buy menu"],
		["E (hold)", "plant / defuse"], ["SHIFT", "walk"], ["CTRL", "crouch"],
		["SPACE", "jump"], ["TAB", "scoreboard"], ["M", "mute"],
	];
	for (const [k, v] of CONTROL_ROWS) {
		controls.append(make("b", null, k), make("span", null, v));
	}
	el.menu.append(controls,
		make("div", "af-note",
			"Plant the charge at A — Furnace or B — Cooling Yard. First to 7 rounds. " +
			"Buy economy, team-tactics bots, dynamic weather. " +
			"Runs in desktop Chrome, WebGL, no downloads."));
	root.append(el.menu);

	let phase = "";
	let bannerT = 0;
	let hitT = 0;
	let flashLevel = 0;
	let buyOpen = false;
	let boardOpen = false;
	let overShown = false;
	let boardT = 0;
	let buySig = "";
	let progOverride = null;
	const last = {};
	function setText(node, key, txt) {
		if (last[key] !== txt) {
			last[key] = txt;
			node.textContent = txt;
		}
	}
	function setWidth(node, key, frac) {
		const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
		if (last[key] !== pct) {
			last[key] = pct;
			node.style.width = pct + "%";
		}
	}

	function buy(id) {

		G.match?.buy?.(id);
		buySig = "";
	}

	function refreshBuy() {
		const p = G.player;
		const money = p?.money ?? 0;
		const sig =
			money + "|" + buyItems.map((b) => (ownedOf(p, b.kind, b.id) ? 1 : 0)).join("");
		if (sig === buySig) return;
		buySig = sig;
		setText(el.buyMoney, "buyMoney", fmtMoney(money));
		for (const b of buyItems) {
			const owned = ownedOf(p, b.kind, b.id);
			b.el.classList.toggle("owned", owned);
			b.el.classList.toggle("poor", !owned && money < b.price);
			b.el.children[2].textContent = owned ? "OWNED" : fmtMoney(b.price);
		}
	}

	function refreshBoard() {
		const actors = G.actors ?? [];
		for (const team of [0, 1]) {
			const mates = actors.filter((a) => a && a.team === team);
			boardRows[team].forEach((row, i) => {
				const a = mates[i];
				row.el.style.display = a ? "" : "none";
				if (!a) return;
				row.el.classList.toggle("dead", a.alive === false);
				row.cells[0].textContent = a.name + (a.isPlayer ? " (YOU)" : "");
				row.cells[1].textContent = String(a.kills ?? 0);
				row.cells[2].textContent = String(a.deaths ?? 0);
				row.cells[3].textContent = fmtMoney(a.money ?? 0);
			});
		}
	}

	window.addEventListener("keydown", (e) => {
		if (!buyOpen) return;
		let n = 0;
		if (e.code.startsWith("Digit")) n = Number(e.code.slice(5));
		else if (e.code.startsWith("Numpad")) n = Number(e.code.slice(6));
		if (n >= 1 && n <= BUY.length) buy(BUY[n - 1][1]);
	});

	const api = {
		banner(text, sub = "", color) {
			el.bannerH.textContent = text;
			el.bannerH.style.color = color ?? "";
			el.bannerP.textContent = sub;
			el.banner.classList.add("on");
			bannerT = 3.6;
		},

		killfeed(killer, victim, opts = {}) {
			if (killer && typeof killer === "object" && "killer" in killer) {
				opts = killer;
				victim = killer.victim;
				killer = killer.killer;
			}
			const kName = typeof killer === "string" ? killer : killer?.name ?? "?";
			const vName = typeof victim === "string" ? victim : victim?.name ?? "?";
			const kTeam = typeof killer === "object" ? killer?.team : undefined;
			const vTeam = typeof victim === "object" ? victim?.team : undefined;
			let slot = kfPool.find((r) => r.t <= 0);
			if (!slot) slot = kfPool.reduce((a, b) => (a.t < b.t ? a : b));
			slot.t = 4.5;
			const row = slot.el;
			row.textContent = "";
			const k = make("span", kTeam === 0 ? "e" : kTeam === 1 ? "g" : null, kName);
			const w = make("span", "wp", opts.weapon ?? "");
			const v = make("span", vTeam === 0 ? "e" : vTeam === 1 ? "g" : null, vName);
			row.append(k, w, v);
			if (opts.headshot) row.append(make("span", "skull", "☠"));
			row.style.display = "";
			row.style.opacity = "1";
			el.kf.prepend(row);
		},

		hitmarker(kill = false) {
			el.hit.classList.toggle("kill", !!kill);
			hitT = kill ? 0.28 : 0.14;
			el.hit.style.opacity = "1";
		},

		damageFrom(relRad) {
			const a = arcs[arcNext++ % arcs.length];
			a.t = 0.9;
			a.el.style.transform = `rotate(${((relRad * 180) / Math.PI).toFixed(1)}deg)`;
			a.el.style.opacity = "1";
		},

		flash(strength) {
			flashLevel = Math.max(flashLevel, Math.max(0, Math.min(1, strength)));
		},

		progress(label, frac) {
			progOverride = label == null ? null : { label, frac: frac ?? 0 };
		},

		showBuy(open) {
			buyOpen = !!open;
			el.buy.classList.toggle("on", buyOpen);
			if (buyOpen) {
				buySig = "";
				refreshBuy();
			}
		},

		scoreboard(show) {
			boardOpen = !!show;
			el.board.classList.toggle("on", boardOpen);
			if (boardOpen) refreshBoard();
		},

		update(dt) {
			const m = G.match;
			const p = G.player;
			phase = m?.phase ?? "menu";
			if (root.dataset.phase !== phase) root.dataset.phase = phase;

			const menuWanted = phase === "menu" && (!G.shot || G.shotMenu);
			if (el.menu.classList.contains("on") !== menuWanted) {
				el.menu.classList.toggle("on", menuWanted);
			}
			const pauseWanted =
				!!G.paused && phase !== "menu" && phase !== "over";
			if (el.pause.classList.contains("on") !== pauseWanted) {
				el.pause.classList.toggle("on", pauseWanted);
			}
			if (phase === "over" && !overShown) {
				overShown = true;
				const s = m?.score ?? [0, 0];
				const won = s[0] > s[1];
				el.overTitle.textContent = won ? "EMBER CELL WINS" : "FOUNDRY GUARD WINS";
				el.overTitle.style.color = won ? "var(--ember)" : "var(--guard)";
				el.overScore.textContent = `FINAL  ${s[0]} — ${s[1]}`;
				el.overStats.textContent =
					`YOU  ${p?.kills ?? 0} K / ${p?.deaths ?? 0} D`;
				el.over.classList.add("on");
			} else if (phase !== "over" && overShown) {
				overShown = false;
				el.over.classList.remove("on");
			}

			const score = m?.score ?? [0, 0];
			setText(el.scoreE, "sE", String(score[0]));
			setText(el.scoreG, "sG", String(score[1]));
			setText(el.round, "round",
				"ROUND " + (m?.roundNum ?? score[0] + score[1] + 1) + " / " + CFG.maxRounds);
			const t = timerSeconds(m);
			setText(el.timer, "timer", t == null ? "—" : fmtClock(t));
			el.timer.classList.toggle("urgent",
				(phase === "live" && t != null && t <= 10) || phase === "planted");
			const hist = Array.isArray(m?.history)
				? m.history
				: [...Array(score[0]).fill(0), ...Array(score[1]).fill(1)];
			const histSig = hist.join("");
			if (last.pips !== histSig) {
				last.pips = histSig;
				el.pips.textContent = "";
				for (const h of hist) el.pips.append(make("span", "af-pip " + (h === 0 ? "e" : "g")));
			}

			const bomb = m?.bomb;
			const planted = !!bomb?.planted;
			el.bomb.classList.toggle("on", planted);
			if (planted) {
				setText(el.bombTxt, "bombTxt",
					"BOMB PLANTED — SITE " + (bomb.site ?? "A"));
				setWidth(el.bombFill, "bombFill", (bomb.t ?? CFG.bombTime) / CFG.bombTime);
			}
			const prog = progOverride ??
				(bomb?.action && typeof bomb.progress === "number"
					? { label: bomb.action === "defuse" ? "DEFUSING" : "PLANTING", frac: bomb.progress }
					: null);
			el.prog.classList.toggle("on", !!prog);
			if (prog) {
				setText(el.progLab, "progLab", prog.label);
				setWidth(el.progFill, "progFill", prog.frac);
			}
			el.buyHint.classList.toggle("on", phase === "freeze" && !buyOpen);

			const hp = Math.max(0, p?.hp ?? 100);
			setText(el.hpVal, "hp", String(Math.ceil(hp)));
			setWidth(el.hpFill, "hpFill", hp / 100);
			const armor = Math.max(0, p?.armor ?? 0);
			setText(el.armVal, "arm", String(Math.ceil(armor)));
			setWidth(el.armFill, "armFill", armor / 100);
			const vig = hp <= 40 && p?.alive !== false
				? 0.3 + 0.4 * (1 - hp / 40) + 0.08 * Math.sin((G.time ?? 0) * 5)
				: 0;
			if (Math.abs(vig - (last.vig ?? 0)) > 0.01) {
				last.vig = vig;
				el.vig.style.opacity = vig.toFixed(2);
			}

			setText(el.money, "money", fmtMoney(p?.money ?? 0));
			const am = ammoOf(p);
			const wdef = am.id ? WEAPONS[am.id] : null;
			setText(el.wname, "wname", wdef?.name ?? "");
			if (wdef?.kind === "melee") {
				setText(el.ammoBig, "ammo", "—");
				setText(el.ammoRes, "ammoRes", "MELEE");
			} else {
				setText(el.ammoBig, "ammo", am.ammo == null ? "" : String(am.ammo));
				setText(el.ammoRes, "ammoRes",
					am.reserve == null ? "" : "/ " + am.reserve);
			}
			el.ammoRow.classList.toggle("low",
				am.ammo != null && wdef?.mag != null && am.ammo <= Math.ceil(wdef.mag * 0.25));
			for (const id of ["frag", "smoke", "flash"]) {
				const n = grenadeCount(p, id);
				const chip = el.nadeChips[id];
				setText(chip, "nade" + id, id.toUpperCase() + " ×" + n);
				chip.classList.toggle("have", n > 0);
			}

			const spread01 = typeof G.getSpread01 === "function"
				? G.getSpread01()
				: (p?.spread01 ?? 0.18);
			const gap = Math.round(5 + Math.max(0, Math.min(1, spread01)) * 30);
			if (last.gap !== gap) {
				last.gap = gap;
				el.cross.style.setProperty("--gap", gap + "px");
			}
			const crossOff =
				p?.scoped || p?.alive === false || phase === "menu" || phase === "over";
			el.cross.style.opacity = crossOff ? "0" : "1";

			if (hitT > 0) {
				hitT -= dt;
				if (hitT <= 0) el.hit.style.opacity = "0";
			}
			if (bannerT > 0) {
				bannerT -= dt;
				if (bannerT <= 0) el.banner.classList.remove("on");
			}
			flashLevel = Math.max(0, flashLevel - dt / 0.9);
			const flashNow = Math.max(flashLevel, p?.flash01 ?? 0);
			if (Math.abs(flashNow - (last.flash ?? 0)) > 0.01) {
				last.flash = flashNow;
				el.flash.style.opacity = flashNow.toFixed(2);
			}
			for (const a of arcs) {
				if (a.t > 0) {
					a.t -= dt;
					a.el.style.opacity = Math.max(0, a.t / 0.9).toFixed(2);
				}
			}
			for (const r of kfPool) {
				if (r.t > 0) {
					r.t -= dt;
					if (r.t <= 0) r.el.style.display = "none";
					else if (r.t < 0.6) r.el.style.opacity = (r.t / 0.6).toFixed(2);
				}
			}
			if (buyOpen) refreshBuy();
			if (boardOpen) {
				boardT -= dt;
				if (boardT <= 0) {
					boardT = 0.25;
					refreshBoard();
				}
			}
		},
	};

	return api;
}
