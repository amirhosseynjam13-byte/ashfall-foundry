import * as THREE from "three";

function paintRand(seed) {
	let a = seed >>> 0;
	return function next() {
		a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
		return a / 4294967296;
	};
}

export function makeCanvas(w, h, drawFn) {
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	drawFn(ctx, w, h);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;
}

function speckle(ctx, w, h, rand, count, color, alpha, size) {
	ctx.save();
	ctx.fillStyle = color;
	for (let i = 0; i < count; i++) {
		ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
		const s = 1 + rand() * size;
		ctx.beginPath();
		ctx.ellipse(rand() * w, rand() * h, s, s * (0.4 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

export function concreteTexture() {
	const tex = makeCanvas(256, 256, (ctx, w, h) => {
		const rand = paintRand(7101);
		ctx.fillStyle = "#4b4b4e";
		ctx.fillRect(0, 0, w, h);
		speckle(ctx, w, h, rand, 900, "#3a3a3d", 0.25, 7);
		speckle(ctx, w, h, rand, 700, "#5d5d60", 0.2, 5);
		speckle(ctx, w, h, rand, 120, "#2c2c2f", 0.3, 16);

		ctx.fillStyle = "rgba(26,26,28,0.35)";
		for (let y = 63; y < h; y += 64) ctx.fillRect(0, y, w, 2);
		ctx.fillStyle = "rgba(255,255,255,0.05)";
		for (let y = 65; y < h; y += 64) ctx.fillRect(0, y, w, 1);

		ctx.strokeStyle = "rgba(20,20,22,0.5)";
		ctx.lineWidth = 1;
		for (let i = 0; i < 5; i++) {
			ctx.beginPath();
			let x = rand() * w;
			let y = rand() * h;
			ctx.moveTo(x, y);
			for (let j = 0; j < 4; j++) {
				x += (rand() - 0.5) * 60;
				y += rand() * 40;
				ctx.lineTo(x, y);
			}
			ctx.stroke();
		}

		ctx.strokeStyle = "rgba(24,24,26,0.8)";
		ctx.lineWidth = 3;
		ctx.strokeRect(0, 0, w, h);
	});
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

export function groundTexture() {
	return makeCanvas(1024, 768, (ctx, w, h) => {
		const rand = paintRand(4202);

		const px = (mx) => ((mx + 48) / 96) * w;
		const py = (mz) => ((mz + 36) / 72) * h;
		const sx = w / 96;

		ctx.fillStyle = "#434346";
		ctx.fillRect(0, 0, w, h);
		speckle(ctx, w, h, rand, 5200, "#37373b", 0.22, 9);
		speckle(ctx, w, h, rand, 3800, "#545457", 0.18, 6);
		speckle(ctx, w, h, rand, 260, "#2b2b2e", 0.3, 26);

		for (let i = 0; i < 26; i++) {
			const cx = px(-34 + rand() * 26);
			const cy = py(-32 + rand() * 22);
			const r = (0.8 + rand() * 2.4) * sx;
			const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
			g.addColorStop(0, "rgba(16,14,12,0.5)");
			g.addColorStop(1, "rgba(16,14,12,0)");
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.strokeStyle = "rgba(22,22,24,0.55)";
		ctx.lineWidth = 2;
		for (let gx = -48; gx <= 48; gx += 12) {
			ctx.beginPath(); ctx.moveTo(px(gx), 0); ctx.lineTo(px(gx), h); ctx.stroke();
		}
		for (let gz = -36; gz <= 36; gz += 12) {
			ctx.beginPath(); ctx.moveTo(0, py(gz)); ctx.lineTo(w, py(gz)); ctx.stroke();
		}

		ctx.strokeStyle = "rgba(214,164,60,0.5)";
		ctx.lineWidth = 4;
		ctx.setLineDash([18, 14]);
		for (const lx of [-5, 5]) {
			ctx.beginPath(); ctx.moveTo(px(lx), py(-35)); ctx.lineTo(px(lx), py(35)); ctx.stroke();
		}
		ctx.beginPath(); ctx.moveTo(px(-44), py(-14)); ctx.lineTo(px(-44), py(14)); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(px(44), py(-14)); ctx.lineTo(px(44), py(14)); ctx.stroke();
		ctx.setLineDash([]);

		const zone = (x0, z0, x1, z1, color, letter) => {
			ctx.fillStyle = color;
			ctx.globalAlpha = 0.13;
			ctx.fillRect(px(x0), py(z0), px(x1) - px(x0), py(z1) - py(z0));
			ctx.globalAlpha = 0.85;
			ctx.strokeStyle = color;
			ctx.lineWidth = 5;
			ctx.strokeRect(px(x0), py(z0), px(x1) - px(x0), py(z1) - py(z0));
			ctx.globalAlpha = 0.75;
			ctx.fillStyle = color;
			ctx.font = `bold ${Math.round(7 * sx)}px Arial, sans-serif`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(letter, px((x0 + x1) / 2), py((z0 + z1) / 2));
			ctx.globalAlpha = 1;
		};
		zone(-33, -26, -23, -18, "#ff7a26", "A");
		zone(22, 18, 32, 26, "#2fd4c4", "B");

		const pad = (mx, mz, color) => {
			ctx.strokeStyle = color;
			ctx.globalAlpha = 0.8;
			ctx.lineWidth = 4;
			ctx.beginPath(); ctx.arc(px(mx), py(mz), 0.95 * sx, 0, Math.PI * 2); ctx.stroke();
			ctx.globalAlpha = 0.35;
			ctx.beginPath(); ctx.arc(px(mx), py(mz), 0.55 * sx, 0, Math.PI * 2); ctx.stroke();
			ctx.globalAlpha = 1;
		};
		for (const mz of [-8, -4, 0, 4, 8]) {
			pad(-44, mz, "#ff7a26");
			pad(44, mz, "#2fd4c4");
		}

		speckle(ctx, w, h, rand, 1600, "#434346", 0.16, 5);
	});
}

export function wallTexture() {
	const tex = makeCanvas(512, 256, (ctx, w, h) => {
		const rand = paintRand(9103);
		ctx.fillStyle = "#585d62";
		ctx.fillRect(0, 0, w, h);
		speckle(ctx, w, h, rand, 1500, "#494e53", 0.25, 8);
		speckle(ctx, w, h, rand, 900, "#676d72", 0.2, 6);

		ctx.strokeStyle = "rgba(18,19,21,0.85)";
		ctx.lineWidth = 3;
		for (let x = 0; x <= w; x += 128) {
			ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
		}
		ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

		ctx.fillStyle = "#2e3236";
		for (let x = 0; x <= w; x += 128) {
			for (let y = 12; y < h; y += 28) {
				ctx.beginPath(); ctx.arc(x + 7, y, 3, 0, Math.PI * 2); ctx.fill();
				ctx.beginPath(); ctx.arc(x + 121, y, 3, 0, Math.PI * 2); ctx.fill();
			}
		}

		for (let i = 0; i < 34; i++) {
			const x = rand() * w;
			const len = 30 + rand() * 120;
			const g = ctx.createLinearGradient(0, 0, 0, len);
			g.addColorStop(0, "rgba(122,66,30,0.5)");
			g.addColorStop(1, "rgba(122,66,30,0)");
			ctx.fillStyle = g;
			ctx.save();
			ctx.translate(x, rand() * h * 0.4);
			ctx.fillRect(-2.5, 0, 5, len);
			ctx.restore();
		}

		const g2 = ctx.createLinearGradient(0, h * 0.72, 0, h);
		g2.addColorStop(0, "rgba(12,12,12,0)");
		g2.addColorStop(1, "rgba(12,12,12,0.45)");
		ctx.fillStyle = g2;
		ctx.fillRect(0, h * 0.72, w, h * 0.28);
	});
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

export function crateTexture() {
	return makeCanvas(256, 256, (ctx, w, h) => {
		const rand = paintRand(3310);
		ctx.fillStyle = "#6d5b40";
		ctx.fillRect(0, 0, w, h);

		for (let y = 0; y < h; y += 52) {
			ctx.fillStyle = `rgba(0,0,0,${0.05 + rand() * 0.08})`;
			ctx.fillRect(0, y, w, 26);
		}
		speckle(ctx, w, h, rand, 500, "#57482f", 0.3, 6);
		speckle(ctx, w, h, rand, 300, "#84714f", 0.25, 5);

		ctx.strokeStyle = "#3d3f42";
		ctx.lineWidth = 20;
		ctx.strokeRect(10, 10, w - 20, h - 20);
		ctx.beginPath();
		ctx.moveTo(10, 10); ctx.lineTo(w - 10, h - 10);
		ctx.moveTo(w - 10, 10); ctx.lineTo(10, h - 10);
		ctx.lineWidth = 10;
		ctx.stroke();

		ctx.fillStyle = "rgba(230,225,210,0.55)";
		ctx.font = "bold 34px Arial, sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("AF-07", w / 2, h / 2 + 12);
	});
}

export function hazardTexture() {
	const tex = makeCanvas(128, 128, (ctx, w, h) => {
		const rand = paintRand(6640);
		ctx.fillStyle = "#151517";
		ctx.fillRect(0, 0, w, h);
		ctx.strokeStyle = "#d9a514";
		ctx.lineWidth = 16;
		for (let x = -h; x < w + h; x += 44) {
			ctx.beginPath();
			ctx.moveTo(x, h + 8);
			ctx.lineTo(x + h + 16, -8);
			ctx.stroke();
		}

		speckle(ctx, w, h, rand, 300, "#151517", 0.5, 4);
		speckle(ctx, w, h, rand, 170, "#454136", 0.3, 6);
	});
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

export function signTexture(text) {
	const accent = text === "A" ? "#ff7a26" : "#2fd4c4";
	return makeCanvas(256, 256, (ctx, w, h) => {
		const rand = paintRand(5511);
		ctx.fillStyle = "#14161a";
		ctx.fillRect(0, 0, w, h);
		speckle(ctx, w, h, rand, 260, "#23262c", 0.4, 6);
		ctx.strokeStyle = accent;
		ctx.lineWidth = 10;
		ctx.strokeRect(14, 14, w - 28, h - 28);
		ctx.fillStyle = accent;
		ctx.font = `bold ${Math.round(h * 0.62)}px Arial, sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(text, w / 2, h / 2 + 8);

		ctx.fillStyle = "#3a3e44";
		for (const bx of [40, w - 40]) {
			ctx.beginPath(); ctx.arc(bx, 40, 8, 0, Math.PI * 2); ctx.fill();
		}
	});
}

export function skyTexture() {
	return makeCanvas(64, 512, (ctx, w, h) => {
		const g = ctx.createLinearGradient(0, 0, 0, h);
		g.addColorStop(0.0, "#0b2830");
		g.addColorStop(0.42, "#1f4d52");
		g.addColorStop(0.60, "#6e4526");
		g.addColorStop(0.68, "#c96a2a");
		g.addColorStop(0.76, "#3a2417");
		g.addColorStop(1.0, "#14100d");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
	});
}

export function siteLetterTexture(text) {
	const accent = text === "A" ? "#ff7a26" : "#2fd4c4";
	return makeCanvas(256, 256, (ctx, w, h) => {
		const rand = paintRand(7717);
		ctx.clearRect(0, 0, w, h);
		ctx.strokeStyle = accent;
		ctx.globalAlpha = 0.92;
		ctx.lineWidth = 13;
		ctx.beginPath();
		ctx.arc(w / 2, h / 2, 104, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = accent;
		ctx.font = `bold ${Math.round(h * 0.58)}px Arial, sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(text, w / 2, h / 2 + 10);
		ctx.globalAlpha = 1;

		speckle(ctx, w, h, rand, 500, "#434346", 0.28, 5);
	});
}

export function glowTexture() {
	return makeCanvas(128, 128, (ctx, w, h) => {
		const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
		g.addColorStop(0, "rgba(255,255,255,1)");
		g.addColorStop(0.25, "rgba(255,255,255,0.55)");
		g.addColorStop(0.6, "rgba(255,255,255,0.16)");
		g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
	});
}

export function corrugatedTexture() {
	const tex = makeCanvas(512, 256, (ctx, w, h) => {
		const rand = paintRand(1207);
		ctx.fillStyle = "#787f86";
		ctx.fillRect(0, 0, w, h);

		for (let p = 0; p < 4; p++) {
			ctx.fillStyle = rand() > 0.5
				? `rgba(255,255,255,${0.03 + rand() * 0.05})`
				: `rgba(0,0,0,${0.03 + rand() * 0.05})`;
			ctx.fillRect(p * 128, 0, 128, h);
		}

		for (let x = 0; x < w; x += 32) {
			const g = ctx.createLinearGradient(x, 0, x + 32, 0);
			g.addColorStop(0, "rgba(0,0,0,0.42)");
			g.addColorStop(0.28, "rgba(255,255,255,0.16)");
			g.addColorStop(0.55, "rgba(255,255,255,0.02)");
			g.addColorStop(1, "rgba(0,0,0,0.42)");
			ctx.fillStyle = g;
			ctx.fillRect(x, 0, 32, h);
		}

		ctx.fillStyle = "rgba(15,16,18,0.8)";
		for (let x = 0; x <= w; x += 128) ctx.fillRect(x - 1, 0, 2, h);
		ctx.fillRect(0, 0, w, 3);
		ctx.fillRect(0, h - 3, w, 3);
		ctx.fillStyle = "#33373c";
		for (let x = 16; x < w; x += 32) {
			for (const y of [14, h - 14]) {
				ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
			}
		}
		speckle(ctx, w, h, rand, 1100, "#5d646b", 0.22, 6);
		speckle(ctx, w, h, rand, 700, "#8b9299", 0.18, 5);

		for (let i = 0; i < 30; i++) {
			const x = rand() * w;
			const len = 26 + rand() * 110;
			const g = ctx.createLinearGradient(0, 0, 0, len);
			g.addColorStop(0, "rgba(124,66,28,0.55)");
			g.addColorStop(1, "rgba(124,66,28,0)");
			ctx.fillStyle = g;
			ctx.save();
			ctx.translate(x, rand() * h * 0.35);
			ctx.fillRect(-2, 0, 4, len);
			ctx.restore();
		}

		const g2 = ctx.createLinearGradient(0, h * 0.7, 0, h);
		g2.addColorStop(0, "rgba(10,10,10,0)");
		g2.addColorStop(1, "rgba(10,10,10,0.62)");
		ctx.fillStyle = g2;
		ctx.fillRect(0, h * 0.7, w, h * 0.3);
		for (let i = 0; i < 9; i++) {
			const x = rand() * w;
			const g3 = ctx.createLinearGradient(0, 0, 0, h);
			g3.addColorStop(0, "rgba(70,38,16,0.4)");
			g3.addColorStop(1, "rgba(70,38,16,0)");
			ctx.fillStyle = g3;
			ctx.fillRect(x, 0, 3 + rand() * 4, h);
		}
	});
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

export function asphaltTexture() {
	const tex = makeCanvas(256, 256, (ctx, w, h) => {
		const rand = paintRand(2213);
		ctx.fillStyle = "#333336";
		ctx.fillRect(0, 0, w, h);

		speckle(ctx, w, h, rand, 2400, "#46464b", 0.25, 2.2);
		speckle(ctx, w, h, rand, 2400, "#222225", 0.3, 2.2);
		speckle(ctx, w, h, rand, 220, "#5c5c62", 0.2, 1.4);

		for (let i = 0; i < 7; i++) {
			const cx = rand() * w;
			const cy = rand() * h;
			const r = 20 + rand() * 44;
			const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
			g.addColorStop(0, "rgba(12,11,10,0.45)");
			g.addColorStop(1, "rgba(12,11,10,0)");
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.strokeStyle = "rgba(16,16,18,0.55)";
		ctx.lineWidth = 1;
		for (let i = 0; i < 4; i++) {
			ctx.beginPath();
			let x = rand() * w;
			let y = rand() * h;
			ctx.moveTo(x, y);
			for (let j = 0; j < 4; j++) {
				x += (rand() - 0.5) * 70;
				y += (rand() - 0.5) * 70;
				ctx.lineTo(x, y);
			}
			ctx.stroke();
		}

		ctx.fillStyle = "rgba(203,164,58,0.55)";
		ctx.fillRect(0, 18, w, 9);
		ctx.save();
		ctx.fillStyle = "#333336";
		for (let i = 0; i < 520; i++) {
			ctx.globalAlpha = 0.25 + rand() * 0.45;
			const s = 1 + rand() * 3;
			ctx.beginPath();
			ctx.ellipse(rand() * w, 13 + rand() * 19, s, s * 0.6, 0, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
		speckle(ctx, w, h, rand, 500, "#2b2b2e", 0.25, 8);
	});
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

export function diamondPlateTexture() {
	const tex = makeCanvas(256, 256, (ctx, w, h) => {
		const rand = paintRand(3301);
		ctx.fillStyle = "#565d66";
		ctx.fillRect(0, 0, w, h);
		speckle(ctx, w, h, rand, 800, "#484f57", 0.25, 5);
		speckle(ctx, w, h, rand, 500, "#646c75", 0.2, 4);
		const lug = (cx, cy, ang) => {
			ctx.save();
			ctx.translate(cx, cy);
			ctx.rotate(ang);
			ctx.fillStyle = "rgba(0,0,0,0.4)";
			ctx.beginPath(); ctx.ellipse(2, 2.5, 13, 3.6, 0, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = "rgba(235,240,245,0.5)";
			ctx.beginPath(); ctx.ellipse(0, 0, 13, 3.6, 0, 0, Math.PI * 2); ctx.fill();
			ctx.restore();
		};
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 4; x++) {
				const cx = x * 64 + 32;
				const cy = y * 64 + 32;
				const ang = (x + y) % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
				lug(cx - 12, cy, ang);
				lug(cx + 12, cy, ang);
			}
		}

		ctx.strokeStyle = "rgba(215,221,227,0.16)";
		ctx.lineWidth = 1;
		for (let i = 0; i < 14; i++) {
			const x = rand() * w;
			const y = rand() * h;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x + (rand() - 0.5) * 60, y + (rand() - 0.5) * 12);
			ctx.stroke();
		}
		speckle(ctx, w, h, rand, 260, "#33383e", 0.28, 9);
	});
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

export function barrelTexture() {
	const tex = makeCanvas(256, 256, (ctx, w, h) => {
		const rand = paintRand(4477);
		const g = ctx.createLinearGradient(0, 0, 0, h);
		g.addColorStop(0, "#715431");
		g.addColorStop(0.5, "#654a2c");
		g.addColorStop(1, "#513b22");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);

		for (const y of [42, 126, 210]) {
			ctx.fillStyle = "rgba(255,235,200,0.16)";
			ctx.fillRect(0, y, w, 7);
			ctx.fillStyle = "rgba(0,0,0,0.4)";
			ctx.fillRect(0, y + 7, w, 4);
		}
		ctx.fillStyle = "rgba(0,0,0,0.35)";
		ctx.fillRect(0, 0, w, 8);

		ctx.fillStyle = "rgba(214,205,188,0.26)";
		ctx.fillRect(0, 58, w, 22);
		speckle(ctx, w, h, rand, 1000, "#46300f", 0.3, 7);
		speckle(ctx, w, h, rand, 700, "#8a653a", 0.25, 6);
		speckle(ctx, w, h, rand, 260, "#2e1f0e", 0.32, 11);

		for (let i = 0; i < 12; i++) {
			const x = rand() * w;
			const y0 = [42, 126, 210][Math.floor(rand() * 3)] + 11;
			const len = 20 + rand() * 50;
			const dg = ctx.createLinearGradient(0, y0, 0, y0 + len);
			dg.addColorStop(0, "rgba(30,20,10,0.4)");
			dg.addColorStop(1, "rgba(30,20,10,0)");
			ctx.fillStyle = dg;
			ctx.fillRect(x, y0, 3, len);
		}

		ctx.fillStyle = "rgba(0,0,0,0.3)";
		ctx.fillRect(0, 0, 3, h);
	});
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

export function surfaceMaterial(tex, opts = {}) {
	const mat = new THREE.MeshStandardMaterial({
		map: tex,
		bumpMap: tex,
		bumpScale: opts.bumpScale !== undefined ? opts.bumpScale : 0.35,
		color: opts.color !== undefined ? opts.color : 0xffffff,
		roughness: opts.roughness !== undefined ? opts.roughness : 0.85,
		metalness: opts.metalness !== undefined ? opts.metalness : 0.2,
	});
	if (opts.envMapIntensity !== undefined) mat.envMapIntensity = opts.envMapIntensity;
	return mat;
}

export function smokeTexture() {
	return makeCanvas(128, 128, (ctx, w, h) => {
		const rand = paintRand(8812);
		ctx.clearRect(0, 0, w, h);
		for (let i = 0; i < 16; i++) {
			const cx = w / 2 + (rand() - 0.5) * w * 0.44;
			const cy = h / 2 + (rand() - 0.5) * h * 0.44;
			const r = w * (0.16 + rand() * 0.22);
			const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
			g.addColorStop(0, "rgba(255,255,255,0.16)");
			g.addColorStop(1, "rgba(255,255,255,0)");
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.fill();
		}
	});
}
