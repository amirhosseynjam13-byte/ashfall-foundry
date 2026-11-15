# ASHFALL FOUNDRY v3 — "STORM SEASON" visual overhaul

Mission: threejs-fps-02 is judged by an AI pairwise on **screenshots + dossier
source text only**. Nobody plays it. v3 is a pure visual/atmosphere overhaul
of the v2 game (commit 6cef3bc) so the 4 screenshots win more pairings.
Gameplay, economy, bots, sites, weapons: **unchanged** from SPEC.md/SPEC-v2.md.

Deadline: 2026-11-16T21:30Z. Target: build + screenshots done by ~03:30Z,
parent submits in the morning.

## 1. Weather system (headline feature)

Menu setting **Weather: Dusk / Rain / Snow** — selectable on the main menu
(and persisted in localStorage). The shot director must accept
`&weather=dusk|rain|snow`.

- **Dusk** (default): the v2 look, graded warmer (see §2).
- **Rain**: 
  - Points-based rain streak field (~1,500 drops) following the camera,
    additive, slight wind slant; cheap splash rings optional — skip if risky.
  - Sky/fog shift to grey-blue; sun intensity down, hemisphere cooler.
  - Wet look: ground material roughness 0.85 → 0.45 and envMapIntensity up;
    existing puddle planes get lower roughness / higher metalness sheen;
    container materials slightly darker albedo (multiply 0.85).
- **Snow**:
  - Points-based snowfall (~1,200 flakes), slow fall + sideways drift,
    flakes as soft round sprites from the canvas texture factory.
  - Pale fog, brighter ambient, sun cooler/whiter.
  - Snow caps: thin white boxes on top of containers, crates and barrels
    (one merged geometry or a handful of planes — keep it cheap); ground
    albedo lightened (material color multiplier toward pale blue-grey).

Implementation: `game/src/weather.js` (or fold into world.js if cleaner):
`createWeather(scene, renderer)` → `{ setMode(mode), update(dt, cameraPos) }`.
Particle systems are single Points objects, toggled by mode. No new deps.

## 2. Lighting & atmosphere grade (all modes)

- Warmer, lower sun at dusk; richer fog colour per mode (dusk 0x4a3428,
  rain 0x3a4550, snow 0x8fa3b5 — tune by eye from captures).
- Sky: gradient dome (big sphere, shader or vertex colours) per mode
  instead of a flat clear colour — dusk orange→purple horizon glow,
  rain flat grey-blue, snow pale.
- More emissive accents: window strips on the background silhouettes,
  blinking aviation light on the crane, molten-core glow pulse at A site.
- Fake light shafts: additive translucent cones/planes under the yard lamps
  (visible in rain/snow especially).
- Renderer: keep ACES tone mapping; exposure per mode (dusk 1.1, rain 0.95,
  snow 1.05).

## 3. Detail & dressing pass

- Painted site letters: big "A" / "B" canvas-texture decals on the ground at
  both sites and on a container face near each site — must read in screenshots.
- Grime pass: a multiply-blended detail canvas texture (streaks, rust runs)
  on container walls; hazard stripes at site thresholds.
- Extra primitive props with the existing texture factory: pallet stacks,
  cable spools (cylinders + torus), tire stacks, traffic cones, a forklift
  silhouette (boxes) parked by the warehouse. Keep colliders honest where a
  prop sits in a lane; decorative props go against walls/corners.
- Soldiers: emissive team-colour strip on the shoulder/back of each bot so
  fighters pop at distance in screenshots; muzzle-flash PointLight flicker
  (one pooled light) on shots.

## 4. Screenshots (the actual deliverable)

Use the existing shot director + puppeteer pipeline (tools-fps). Produce
candidates, then choose the best 4 into `screenshots/` (JPEG ≤ 256 KiB each,
long side ≤ 1280, first by name = cover):

1. `1-cover.jpg` — main menu over the yard in **Rain** at dusk: title,
   weather selector visible, wet yard + shafts behind.
2. `2-rain-duel.jpg` — staged duel near A site in rain: muzzle flash light,
   tracer, rain streaks, site "A" decal in frame.
3. `3-snow.jpg` — **Snow** at B site: falling flakes, snow caps, a bot
   holding an angle, "B" decal in frame.
4. `4-dusk-end.jpg` — dusk defuse/plant scene with the round-end scoreboard.

Every capture must be a real render of the current build, no page errors.

## 5. Hard constraints

- Static files under `game/`, ES modules, **no build step**, vendored
  three 0.187.0 only, **no network loads** (RULES.txt).
- Dossier caps: text ≤ 163,840 bytes total (keep new code tight — v2 was
  close; measure before finishing), game ≤ 50 MB, screenshots ≤ 4.
- Do not touch: weapon stats, economy, round flow, bot waypoints/routes,
  site positions, map layout/colliders (except adding dressing props that
  don't block lanes).
- The game must still boot clean in headless Chrome (SwiftShader) — verify
  with the shot pipeline; zero page errors.

## 6. Deliverables from the build

- All changes committed in `~/workspace/makefun/fps` on top of 6cef3bc.
- `screenshots/` replaced with the 4 chosen shots + keep the rejected
  candidates in `~/workspace/makefun/fps-v3-candidates/` (outside the repo).
- `V3-NOTES.md` in the repo root: what changed per file, the weather design,
  which screenshots were chosen and why, dossier text-byte count, and the
  exact shot-director URLs used for each chosen screenshot.
- Do **NOT** submit — the parent builds the transcript bundle and submits.
