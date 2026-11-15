# ASHFALL FOUNDRY — build spec (threejs-fps-02)

A round-based tactical FPS in the Counter-Strike style, fully original: our own map,
teams, weapon names, art and sounds. Static ES modules under `game/`, three.js 0.187.0
vendored at `game/vendor/three/`. No build step, no network, single player with bots.

**Setting.** A decommissioned steel foundry at dusk, used as a smuggling depot.
Attackers **Ember Cell** (orange) plant a core charge at site A (the Furnace hall) or
site B (the Cooling Yard). Defenders **Foundry Guard** (teal) protect the sites.
Palette: gunmetal greys, molten orange emissives, teal dusk sky, warm work-lights.

## Match rules (rounds.js owns this)

- 5v5. The local player is always Ember (attacker). Bomb carrier is a random Ember
  member each round (may be the player).
- Round flow: `menu → freeze(4s, buy open) → live(105s) → bomb planted(40s) → end(4s banner) → next`.
- Win: elimination, bomb detonation (Ember), time expiry or defuse (Guard).
- Match: first to 7 round wins, max 12 rounds, then match-end screen + restart button.
- Economy: start $800. Kill +$300. Plant +$300 (team). Round win +$3250 (elimination)
  or +$3500 (objective). Loss +$1400, +$500 per consecutive loss (cap +$2000 streak part).
  Money persists; weapons/armor/grenades persist while alive, drop on death (no pickup).
- Buy (freeze phase only, key B or auto-open at first freeze): number keys + clickable grid.

## Weapons (config.js is the single source of truth)

| id | name | price | dmg | rpm | mag | reserve | spread° base/move | reload s |
|----|------|-------|-----|-----|-----|---------|-------------------|----------|
| knife | Foundry Shiv | 0 | 55 (back 100) | 120 | – | – | – | – |
| p9 | P9 Sidearm | 0 | 34 | 400 semi | 12 | 96 | 0.6 / 2.2 | 1.6 |
| mule | Mule 870 | 1100 | 14×8 pellets | 68 pump | 6 | 30 | 3.5 / 5.0 | 0.55/shell |
| raptor | Raptor-9 SMG | 1400 | 26 | 780 auto | 30 | 120 | 1.1 / 3.4 | 2.1 |
| vulcan | VK Vulcan Rifle | 2700 | 36 | 600 auto | 30 | 120 | 0.9 / 3.8 | 2.4 |
| longshot | Longshot .338 | 4750 | 105 | 42 bolt | 5 | 25 | 0.05 scoped / 6 hip | 3.2 |

Head ×4, chest/stomach ×1, arms ×0.85, legs ×0.75. Range falloff: full to 18 m, then
linear to 55% at 60 m. Armor: body/head damage ×0.5 while armor points last
(armor absorbs 50% of prevented amount). Helmet covers head.
Grenades: Frag $300 (85 dmg, 4.5 m radius, falls off), Smoke $300 (7 s cloud, blocks
bot vision + LOS), Flash $200 (2.2 s blind if facing within 25 m, scaled by angle).
Max 1 of each per player; slot 4 cycles grenades.

## Gunplay model (weapons.js, used identically by player and bots)

- Hitscan with visible tracer; pellets for shotgun. Hit = ray vs actor hitboxes
  (head sphere, chest box, leg boxes — actors.js exposes `hitTest(ray)`).
- Spread (degrees) = base + movePenalty(speed) + airPenalty + bloom; bloom grows
  +0.35°/shot, decays 6°/s, cap +3°. Crouch multiplies total spread ×0.7.
  Moving faster than 1.2 m/s adds up to the move column. First-shot accuracy matters.
- Recoil: view pitch kick per weapon (rifle 0.55°, SMG 0.38°, pistol 0.5°, sniper 2.2°),
  yaw jitter ±30% of pitch; recovery over 90 ms. Bots get the same spread rules with
  an added aim-error cone that shrinks while they track a target (bots.js).
- Fire modes: auto/semi/bolt/pump honoured; reload is timed, cancellable by swap;
  empty-click sound; muzzle flash light + sprite 40 ms; casing eject (pooled).

## Movement (player.js)

Ground accel/friction in the CS style (accel 12, friction 6, max run 5.2 m/s,
walk 3.2 (Shift), crouch 1.7, air accel low 0.6 so bunny-hop gains nothing).
Eye height 1.62 standing, 1.15 crouched, smooth crouch lerp. Jump vel 4.6, gravity 12.5.
Collision: actors are vertical capsules vs the world's AABB list (axis-separated sweep),
plus a simple step-up of 0.45 m for curbs/stairs. Bots use the same mover (bots.js calls
`moveActor` from player.js? No — mover lives in util.js as `slideMove(pos, vel, dt, colliders, radius, height)` used by both).

## The map (world.js) — 96 × 72 m, walls 4.2 m high unless noted

Zones (x right/east, z toward viewer/south on plan; y up):
- **Ember spawn** west edge (x −44), five pads. **Guard spawn** east edge (x +44).
- **Site A — Furnace Hall** (north-west quadrant): a hall with the furnace prop
  (glowing core, chimney), plant zone 10×8 m around the furnace apron, entries:
  A-Main (west corridor), A-Link catwalk (raised 2.6 m, from mid), A-Door (from mid).
- **Site B — Cooling Yard** (south-east): open yard, two water towers, crate stacks,
  plant zone 10×8 m, entries: B-Tunnel (low vent run from Ember side, crouch signs),
  B-Main (east corridor), Window (from mid, drop-down).
- **Mid**: central north–south avenue with double doors, a sniper nest box, and the
  catwalk bridge over it connecting A-Link; mid-to-B window room on the east side.
- Lanes must read clearly: hazard-striped thresholds at site entries, hanging site
  signs "A"/"B" (canvas textures), molten channels (emissive strips, non-blocking)
  along the furnace side, pipes and vents as cover boxes.
- Cover: crates (1.1 m cubes, some stacked 2.2 m), barriers (1.2 m), pillars.
- Lighting: hemisphere (teal sky / dark ground) + low orange directional (dusk sun,
  casts one 2048 shadow map over the play area) + furnace point light (flickers) +
  warm work-light points at sites/mid (no shadows). Fog: teal-brown, 45→120 m.
  Sky: gradient dome (canvas) + sun glow sprite + a few silhouette chimneys outside.
- Ground: one big plane, canvas texture (dark concrete, stains, lane markings, site
  letters painted). Walls: canvas texture panels (riveted steel) tinted per zone.

**Waypoint graph** (world.js exports `graph`): ~46 named nodes with positions and
edges (bidirectional unless `oneway`). Node names: espawn1..5, a_main, a_door, a_link,
a_site, a_furnace, mid_s, mid_doors, mid_n, mid_nest, catwalk, window, b_main, b_tun,
b_site, b_yard, gspawn..., plus cover spots flagged `cover:true` near sites/mid.
Bots path with A* over this graph (bots.js), then steer between nodes with the
same collision mover; final approach is direct steering with obstacle slide.

## Bots (bots.js + actors.js)

- Body: stylised soldier from boxes/capsules (actors.js `buildSoldier(team)`):
  legs, torso (team colour + vest), head with visor, gun prop; head/chest/leg hitboxes
  tracked from the mesh each shot (`hitTest` uses live world positions). Walk/run limb
  swing, crouch pose, death fall + fade after 4 s (body stays as cover-less corpse).
- Brain (tick 10 Hz, movement every sim step): states `rollout → takePosition →
  engage/hold → rotate → plant/defuse → retake/hunt`. Each bot has a site assignment
  per round (Ember: 3 to called site, 1 mid, 1 flex; Guard: 2 A, 2 B, 1 mid) and a
  `callsite` chosen by the bomb carrier's team logic at freeze end (A or B, weighted
  random, sometimes mid-split).
- Perception: vision 100° cone, 65 m, LOS ray vs colliders (smoke blocks); hearing:
  gunfire within 30 m (unsuppressed) or footsteps 9 m sets `lastKnownPos` + alert.
  Reaction: on first sight, 0.28–0.45 s delay before firing; aim error starts 2.2°
  and shrinks to 0.5° over 1.2 s of tracking; they stop moving to shoot beyond 12 m,
  burst 3–5 rounds then 0.25 s pause. They take damage → may fall back to a cover node.
- Bomb: carrier goes to called site, plants when in zone and no enemy seen for 1 s
  (4 s plant, progress shown if player nearby). Guard defuses (5 s with kit — all Guard
  have kits, 10 s shown honestly as 5 s kit defuse) when site clear. Post-plant:
  Ember holds angles on the bomb; Guard retakes.
- Difficulty is fixed "hard but fair": bots obey the same spread/damage/economy rules.

## Presentation (effects.js, audio.js, hud.js)

- Effects (all pooled, zero allocation in loops): tracers (additive lines fading
  60 ms), impact sparks/dust by surface, muzzle sprites, hit flash on actors,
  explosion (fireball sprites + point light + camera shake + smoke column), smoke
  grenade cloud (12 sprites growing/fading), flash white overlay, shell casings
  (instanced small boxes with gravity, 1.2 s life), damage numbers (DOM pool),
  kill skull in killfeed.
- Audio (WebAudio, all synthesised, `audio.js`): per-class gunshot (noise burst +
  body thump), distant variant by distance, reload foley (clicks timed to reload),
  dry fire, hit tick, headshot ding, kill confirm, footsteps (soft filtered noise,
  alternating), jump/land, grenade pin + bounce, explosion (sub sine + noise),
  bomb beeps (1 Hz → 5 Hz in last 10 s), plant/defuse beeps, buy click, round
  win/lose sting (two-note), match win sting, ambient foundry loop (low hum +
  random distant clangs, gain 0.05). Master mute on M. Audio starts on first click.
- HUD (DOM in index.html, hud.js drives it): top-centre timer + round score pips +
  team round counts; top-right killfeed (5 rows, fade); bottom-left HP bar + armor
  bar + team icon; bottom-right money, ammo big, reserve, weapon name, grenade icons;
  centre dynamic crosshair (gap = current spread) + hitmarker (X, red on kill);
  damage direction arc; bomb banner + plant/defuse radial bar; buy menu panel
  (grid, prices, owned state, money check); scoreboard on Tab (names, K/D, money);
  round-end banner (winner + reason); match-end panel + Play Again; main menu
  (title ASHFALL FOUNDRY, Play, controls list, quality note); pause overlay when
  pointer unlocks mid-round. Bot names: Ember — Vex, Rho, Sable, Kite (+You);
  Guard — Warden, Piston, Gauge, Holt, Brigg.

## Code rules (the judge reads the code — criterion 5)

- One job per module; the module list is fixed: config, util, audio, textures,
  world, input, player, weapons, actors, bots, rounds, hud, effects, main.
- Fixed-step simulation at 60 Hz with an accumulator in main.js; rendering decoupled;
  interpolation is NOT required (60 Hz steps render directly).
- Single state object `G` created in main.js and passed by reference; no globals
  besides module exports. No `new` allocations inside per-frame hot loops: reuse
  temp vectors (util.js `tmpV1..4`), pools in effects.js.
- Deterministic with a seeded RNG (util.js `rng(seed)`): same seed → same bot calls.
  `?seed=N` honoured; default seed 20251116.
- Screenshot scenes: `?shot=start|play|end&seed=N` — main.js builds a deterministic
  tableau and sets `window.__shotReady = true` when the frame is composed:
  - start: freeze phase, buy menu open, player at Ember spawn facing the furnace glow.
  - play: live round at A-Link, player mid-burst at a visible enemy, tracer + hitmarker.
  - end: bomb planted at A, 6 s to detonation, Ember up 4–2, round-end imminent;
    HUD shows plant banner. (Detonation fireball frozen is fine too.)
- index.html: importmap → `./vendor/three/three.module.min.js`; all HUD DOM + CSS in
  index.html; one module script `src/main.js`. No external requests of any kind.
- Every file parses as an ES module (`node --check` clean). No TODOs, no dead code,
  no console spam (one boot log line is fine).

## Interfaces (do not invent others; ask via SPEC change if blocked)

- config.js: `export const CFG = {...}` (all numbers above), `export const WEAPONS = {...}`,
  `export const BUY = [...]` (menu layout), `export const NAMES = {ember:[...], guard:[...]}`.
- util.js: `rng(seed)`, `clamp, lerp, rand range helpers`, `tmpV1..tmpV4` (THREE.Vector3),
  `slideMove(pos, vel, dt, colliders, radius)` → mutates pos, returns hit flags,
  `rayVsAABB(origin, dir, box)` → t or Infinity, `angleLerp`.
- world.js: `buildWorld(scene)` → `{ colliders: THREE.Box3[], coverBoxes, sites:
  {A:{zone:Box3, plantPos}, B:{...}}, spawns:{ember:[v3×5], guard:[v3×5]}, graph:
  {nodes: Map<name,{pos,cover}>, edges: Map<name,name[]>}, update(dt,t) }`.
- textures.js: `makeCanvas(w,h,drawFn)` → CanvasTexture; named exports for ground,
  wall, crate, hazard, sign(text), sky, glow sprite, smoke sprite.
- actors.js: `createActor(team, name, isPlayer)` → actor `{team,name,isPlayer,hp,armor,
  helmet,alive,pos:V3,vel:V3,yaw,pitch,crouch01,mesh,head:Object3D,hitTest(origin,dir)
  → {part,dist,point}|null, setPose(dt), dispose()}`; actor radius 0.42, height 1.78.
- weapons.js: `createLoadout()` → per-actor weapon state; `giveWeapon(actor,id)`,
  `fire(actor, target info via G)`, `reload(actor)`, `updateWeapons(dt)` (tracers,
  reload timers), `viewmodel` builder for the player (`buildViewmodel(id)` → Group),
  damage application goes through `applyDamage(target, dmg, part, attacker)` in actors.js.
- bots.js: `createBotMind(actor, team)` → `{ update(dt, G), reset(roundInfo) }`;
  pathfinding `findPath(graph, from, to)` exported for reuse.
- player.js: `createPlayer(actor)` → `{ update(dt, input, G), camera rig refs }`.
- input.js: `createInput()` → `{ keys:Set, lookDX/DY accumulators, consumeLook(),
  firing:boolean, onKey callbacks for buy/scoreboard }` + pointer lock helpers.
- effects.js: `createEffects(scene)` → `{ tracer(a,b,color), impact(point,normal,kind),
  muzzle(pos,dir), explosion(pos), smokePuff(pos), casing(pos,dir), update(dt),
  shake(amount) → camera offset, bloodless hitSpark(point) }`.
- audio.js: `createAudio()` → `{ unlock(), shot(kind,dist), reload(kind), dry(),
  hit(head), kill(), step(run), jump(), land(), nade(kind), explosion(), beep(final),
  plant(), defuse(), buy(), sting(win), ambient start/stop, toggleMute() }`.
- rounds.js: `createMatch(G)` → `{ update(dt), buy(id) → bool, state getters }`;
  owns phases, timer, economy, bomb, score; calls hud/audio through G.
- hud.js: `createHUD(G)` → `{ update(dt), banner(text,sub,color), killfeed(...),
  showBuy(open), scoreboard(show), menu hooks }`. All DOM built in index.html.
- main.js: builds everything, owns `G`, the loop, the shot director.
- G shape: `{ scene, camera, renderer, world, effects, audio, hud, input, actors:[],
  player, match, time, simTime, rng, paused, shot mode }`.

Names/branding: title **ASHFALL FOUNDRY**; teams **Ember Cell** vs **Foundry Guard**;
sites **A — Furnace**, **B — Cooling Yard**. Nothing copied from any commercial game.
