// Ashfall Foundry - the make.fun threejs-fps-02 entry program.
// The game is plain static files under game/ (three.js ES modules, no build
// step). This program performs the hand-in: it copies game/ and screenshots/
// into the output directory and writes dossier.json there with the vendored
// make.fun library, byte for byte the way the gate rebuilds it. In the
// grader the output directory is /output; outside it, MAKEFUN_OUTPUT_DIR
// names the directory instead.

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-threejs.ts";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

mkdirSync(outDir, { recursive: true });
cpSync(join(root, "game"), join(outDir, "game"), { recursive: true });
mkdirSync(join(outDir, "screenshots"), { recursive: true });
const shots = join(root, "screenshots");
if (existsSync(shots)) {
	cpSync(shots, join(outDir, "screenshots"), { recursive: true });
}

const dossier = buildDossier(outDir, {
	text_max_bytes: 163840,
	screenshots: { max: 4, max_bytes: 262144 },
	game_max_files: 993,
	game_max_bytes: 50331648,
});
writeFileSync(join(outDir, "dossier.json"), dossier);
