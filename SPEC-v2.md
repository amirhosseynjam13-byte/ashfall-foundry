# ASHFALL FOUNDRY — v2 Visual Overhaul SPEC

Goal: same game, same simulation, dramatically better LOOKS. The AI judge scores
screenshots + source. v1 was flat-colored boxes (rank 86/4616). v2 must read as a
real textured game: procedural canvas textures, articulated soldier models,
detailed gun viewmodels, dressed environment, stronger mood lighting.

## Hard constraints (do not break)
- NO network loads, NO new imports. Only the vendored three module already used.
- Do NOT change gameplay/sim behavior: rounds.js, bots.js logic, input.js,
  player.js, hud.js stay functionally identical. Damage/health/economy numbers
  in config.js unchanged.
- Preserve every existing exported function name and signature in the files you
  own. main.js must keep working without edits except where your SPEC section
  explicitly says otherwise.
- No per-frame allocations in hot loops; reuse geometries/materials/textures
  (create once, share). Keep total game/ size well under the 50 MB cap.
- All textures are generated at runtime on canvas (no image files).

## Agent A — textures.js + world.js (environment)
textures.js: add a texture factory using offscreen canvases, exported so world.js
(and actors/weapons via main.js if already wired — do NOT rewire other files)
can use it. Required texture sets, each returning a THREE.CanvasTexture with
correct repeat/wrap + a matching roughness-friendly material helper:
- corrugated metal (container/foundry wall): vertical ribs, rust streaks, grime
  at the bottom edge, subtle panel variation. Tintable via material color.
- concrete: noise, cracks, stains, form lines.
- asphalt ground: dark aggregate noise, oil stains, painted worn lines.
- metal plate / diamond plate for catwalks.
- hazard stripes (yellow/black, worn).
- brick or riveted steel panels for the furnace hall interior.
Generate matching bump maps from the same canvas (use the canvas as bumpMap).
world.js: apply these materials to the existing geometry (walls, ground,
catwalks, site structures, props). Add dressing that sells scale and mood,
cheaply: stacked crates and barrels (textured), hanging work lamps with warm
emissive bulbs + PointLights only where already budgeted (max +4 lights),
cable runs, puddle planes (MeshStandardMaterial metalness .9 roughness .15,
envMapIntensity high — rely on scene environment), drifting smoke sprites over
the furnace stacks, distant silhouette structures against the sky. Keep all
colliders and waypoint data EXACTLY as they are — dressing must not block paths
(place props against walls / outside lanes). Sky: gradient dusk with sun glow
sprite; fog color matched.

## Agent B — actors.js (soldiers)
Rebuild buildSoldier into an articulated, proportioned soldier (~1.8 m):
pelvis, torso with vest (box + pouches), head with helmet and visor strip,
upper/lower arms, upper/lower legs with boots, a held rifle (simple but shaped:
body, barrel, mag, stock) attached to the hands in an aim-ready pose.
Team identity: Ember = burnt-orange accents (shoulder pad, stripe, visor glow),
Guard = teal accents. Materials: use the texture helpers if exported by
textures.js (fabric-ish noise canvas is enough) — if not available, use flat
colors with roughness variation; do NOT import across agent files beyond what
main.js already wires. Add procedural animation in the existing update path:
walk cycle (legs/arms swing by speed, slight body bob), aim pose when engaging,
hit flinch (brief torso pitch), death fall (rotate to ground + sink handled by
existing logic if present — keep compatible). Keep createActor/applyDamage and
all stats EXACTLY as-is; only the mesh construction and its per-frame posing
change. Name the bones/groups clearly (soldier.userData.parts = {torso, head,
armL, armR, legL, legR, gun...}) so main.js shot staging can pose them.

## Agent C — weapons.js viewmodels + effects.js
weapons.js: rebuild each first-person viewmodel as a detailed multi-part gun:
receiver, handguard with rail ridges, barrel + muzzle brake, magazine (curved
approx. via segments), stock, grip, trigger guard, iron sights or optic (ring +
lens with slight emissive), charging handle, decals via canvas texture (serial
numbers / warning stripes — subtle). Per weapon: P9 pistol (slide, serrations),
Mule 870 (pump + tube), Raptor-9 (compact SMG + suppressor), VK Vulcan (rifle +
optic), Longshot (long barrel + big scope + bipod), knife (blade + wrapped
grip). Keep weapon stats and the loadout/state API identical; only the builder
functions' geometry changes. Materials: dark gunmetal with roughness/metalness
contrast, worn edge highlights via a small canvas texture.
effects.js: richer feedback — muzzle flash (sprite + point light flicker as
already budgeted), tracer lines with glow sprite head, impact bursts (sparks
for metal, dust puff for concrete — pick by target material name if available,
else generic), shell casing eject (small instanced boxes with gravity, fade),
hit marker puff at impact point. Keep the exported API and the `smokes` array
contract identical.

## Integration (Muse, after agents land)
- main.js: only touch what the new builders require (e.g., passing scene
  environment intensity), keep the shot director working (?shot=start|play|end).
- Rebuild the three screenshot tableaux with the new visuals; verify with the
  Puppeteer pipeline (fresh browser per shot, python http.server on 8904).
- Soak-test combat again; then makefun check + resubmit to threejs-fps-02.
