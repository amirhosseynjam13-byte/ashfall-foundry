// player.js - the local player's body and camera rig.
// Owns movement (Counter-Strike style ground acceleration/friction fed
// through util.slideMove), the eye (crouch lerp, view bob, landing dip),
// recoil view-punch decay, FOV/scope handling and the first-person
// viewmodel mount. Other systems talk to the player through the actor
// (pos/vel/yaw/pitch are the shared state) and through setWeapon() when
// the held weapon changes.
//
// Angle convention, shared with weapons.js and actors.js: yaw/pitch are
// three.js YXZ camera angles, so the look direction is
// (-cos(pitch)*sin(yaw), sin(pitch), -cos(pitch)*cos(yaw)) and a positive
// pitch looks up. Recoil is a temporary offset on top of that: firing
// adds to actor.recoilPitch / actor.recoilYaw, weapons.js decays them
// back to zero (SPEC: ~90 ms recovery); this module applies what remains to the
// camera, so the view punches and settles without moving the true aim.

import * as THREE from "three";
import { CFG, WEAPONS } from "./config.js";
import { clamp, lerp, damp, slideMove } from "./util.js";
import { buildViewmodel } from "./weapons.js";

const SENS = 0.0023; // radians of turn per mouse pixel
const BASE_FOV = 74;
const PITCH_LIMIT = 1.55; // ~89 degrees, just short of the poles
const RECOIL_RECOVERY = 11; // damp rate: 1/11 s ~ the SPEC's 90 ms

export function createPlayer(actor) {
	actor.recoilPitch ??= 0;
	actor.recoilYaw ??= 0;
	actor.crouch01 ??= 0;
	actor.scoped = false;

	const camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 400);
	camera.rotation.order = "YXZ";

	let viewmodel = null; // Group from weapons.buildViewmodel, on the camera
	let weaponId = null;
	let drawDur = 0.4; // seconds the current viewmodel takes to raise
	let drawT = 0;
	let eye = CFG.eyeStand; // smoothed eye height above the feet
	let grounded = true;
	let bobPhase = 0;
	let bobAmp = 0;
	let landDip = 0;
	let stepAcc = 0; // metres travelled since the last footstep sound
	let fov = BASE_FOV;
	let scoped = false;
	let swayX = 0; // viewmodel lag behind fast mouse movement
	let swayY = 0;

	// Called by main/rounds whenever the held weapon changes: rebuilds the
	// viewmodel and restarts the raise animation.
	function setWeapon(id) {
		if (viewmodel) {
			viewmodel.parent?.remove(viewmodel);
			viewmodel = null;
		}
		weaponId = id;
		drawDur = WEAPONS[id]?.drawTime ?? 0.4;
		drawT = drawDur;
		if (id) {
			viewmodel = buildViewmodel(id);
			if (viewmodel) {
				viewmodel.position.set(0.25, -0.235, -0.5);
				camera.add(viewmodel);
			}
		}
	}

	function update(dt, input, G) {
		if (G.paused) return; // main owns the pause; the rig simply freezes
		const phase = G.match?.phase;
		const alive = actor.alive !== false;
		const canMove =
			alive && (!phase || phase === "live" || phase === "planted");
		const vel = actor.vel;
		const keys = input?.keys;

		// --- look ------------------------------------------------------------
		let swayTX = 0;
		let swayTY = 0;
		if (input) {
			const look = input.consumeLook();
			const sens = G.sensitivity ?? SENS;
			actor.yaw -= look.dx * sens;
			actor.pitch = clamp(
				actor.pitch - look.dy * sens,
				-PITCH_LIMIT,
				PITCH_LIMIT,
			);
			swayTX = clamp(-look.dx * 0.00045, -0.028, 0.028);
			swayTY = clamp(look.dy * 0.00045, -0.02, 0.02);
		}

		// --- recoil view punch ------------------------------------------------
		// weapons.js owns the decay of actor.recoilPitch / recoilYaw; the
		// camera rig below only reads what remains as a temporary offset.

		// --- stance ------------------------------------------------------------
		const wantCrouch =
			!!keys &&
			(keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("KeyC"));
		actor.crouch01 = damp(actor.crouch01, wantCrouch ? 1 : 0, 12, dt);

		// --- wish direction and speed -------------------------------------------
		let ix = 0;
		let iz = 0;
		if (canMove && keys) {
			if (keys.has("KeyW") || keys.has("ArrowUp")) iz += 1;
			if (keys.has("KeyS") || keys.has("ArrowDown")) iz -= 1;
			if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
			if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
		}
		const il = Math.hypot(ix, iz);
		if (il > 1) {
			ix /= il;
			iz /= il;
		}
		const sinY = Math.sin(actor.yaw);
		const cosY = Math.cos(actor.yaw);
		// Ground-plane forward is (-sinY, -cosY), right is (cosY, -sinY).
		const wishX = -sinY * iz + cosY * ix;
		const wishZ = -cosY * iz - sinY * ix;

		const def = WEAPONS[weaponId] ?? WEAPONS[actor.currentWeapon] ?? null;
		scoped = !!(input?.aiming && def?.kind === "sniper" && alive);
		actor.scoped = scoped;
		let wishSpeed = CFG.speedRun;
		if (keys && (keys.has("ShiftLeft") || keys.has("ShiftRight"))) {
			wishSpeed = CFG.speedWalk;
		}
		wishSpeed = lerp(wishSpeed, CFG.speedCrouch, actor.crouch01);
		if (def?.moveSpeed) wishSpeed = Math.min(wishSpeed, def.moveSpeed);
		if (scoped) wishSpeed = Math.min(wishSpeed, CFG.speedWalk);
		if (!canMove) wishSpeed = 0;

		// --- CS-style friction, then accelerate toward the wish direction -------
		// Friction bleeds speed first; acceleration is capped by the
		// velocity projected on the wish direction. Counter-strafing works
		// because a reversed wish direction first cancels, then rebuilds,
		// speed - which is exactly why stopping to shoot pays.
		if (grounded) {
			const sp = Math.hypot(vel.x, vel.z);
			if (sp > 0.0001) {
				const scale = Math.max(0, sp - sp * CFG.groundFriction * dt) / sp;
				vel.x *= scale;
				vel.z *= scale;
			}
		}
		const accel = grounded ? CFG.groundAccel : CFG.airAccel;
		const projected = vel.x * wishX + vel.z * wishZ;
		const add = wishSpeed - projected;
		if (add > 0 && (wishX !== 0 || wishZ !== 0)) {
			const step = Math.min(accel * wishSpeed * dt, add);
			vel.x += wishX * step;
			vel.z += wishZ * step;
		}

		// --- gravity, jump, collision --------------------------------------------
		vel.y -= CFG.gravity * dt;
		if (canMove && grounded && input?.consumePressed("Space")) {
			vel.y = CFG.jumpVel;
			grounded = false;
			G.audio?.jump?.();
		}
		const fallBefore = vel.y;
		const hit = slideMove(actor.pos, vel, dt, G.world?.colliders ?? []);
		if (hit.grounded && !grounded && fallBefore < -2) {
			landDip = -Math.min(0.14, -fallBefore * 0.016);
			G.audio?.land?.();
		}
		grounded = hit.grounded;
		actor.grounded = grounded;
		actor.hitWall = hit.hitWall;

		// --- eye height, bob, footsteps -------------------------------------------
		const eyeTarget = alive
			? lerp(CFG.eyeStand, CFG.eyeCrouch, actor.crouch01)
			: 0.35; // a dead player's camera settles near the floor
		eye = damp(eye, eyeTarget, 14, dt);
		actor.eyeHeight = eye;
		const hSpeed = Math.hypot(vel.x, vel.z);
		if (grounded && alive && hSpeed > 0.5) {
			bobPhase += dt * hSpeed * 1.55;
			bobAmp = damp(bobAmp, Math.min(1, hSpeed / CFG.speedRun), 8, dt);
			stepAcc += hSpeed * dt;
			if (stepAcc > (actor.crouch01 > 0.5 ? 1.9 : 2.4)) {
				stepAcc = 0;
				G.audio?.step?.(hSpeed > 4);
			}
		} else {
			bobAmp = damp(bobAmp, 0, 8, dt);
		}
		landDip = damp(landDip, 0, 10, dt);
		const bobY = Math.sin(bobPhase * 2) * 0.02 * bobAmp;
		const bobX = Math.cos(bobPhase) * 0.013 * bobAmp;

		// --- camera ------------------------------------------------------------------
		const cam = G.camera ?? camera;
		if (cam.parent == null && G.scene) G.scene.add(cam);
		cam.position.set(
			actor.pos.x + cosY * bobX,
			actor.pos.y + eye + bobY + landDip,
			actor.pos.z - sinY * bobX,
		);
		cam.rotation.set(
			actor.pitch + actor.recoilPitch,
			actor.yaw + actor.recoilYaw,
			-ix * 0.005 + Math.sin(bobPhase) * 0.0016 * bobAmp,
		);
		const zoom = input?.aiming && alive ? (def?.zoom ?? 1) : 1;
		const targetFov = BASE_FOV / zoom;
		if (Math.abs(targetFov - fov) > 0.01) {
			fov = damp(fov, targetFov, 14, dt);
			cam.fov = fov;
			cam.updateProjectionMatrix();
		}
		if (G.renderer) {
			const c = G.renderer.domElement;
			const aspect = c.width / Math.max(1, c.height);
			if (Math.abs(aspect - cam.aspect) > 0.001) {
				cam.aspect = aspect;
				cam.updateProjectionMatrix();
			}
		}

		// --- viewmodel ------------------------------------------------------------------
		if (viewmodel) {
			if (viewmodel.parent !== cam) cam.add(viewmodel);
			drawT = Math.max(0, drawT - dt);
			const raise = drawDur > 0 ? 1 - drawT / drawDur : 1;
			const dip = (1 - raise) * (1 - raise);
			swayX = damp(swayX, swayTX, 10, dt);
			swayY = damp(swayY, swayTY, 10, dt);
			const kick = actor.recoilPitch; // view punch drives the gun kick too
			viewmodel.position.set(
				0.25 + swayX + bobX * 0.35,
				-0.235 + swayY + bobY * 0.4 - dip * 0.18,
				-0.5 + kick * 0.35,
			);
			viewmodel.rotation.set(kick * 0.6 + dip * 0.45, swayX * 2.2, 0);
			viewmodel.visible = alive && !scoped;
		}
	}

	return {
		actor,
		camera,
		setWeapon,
		update,
		get scoped() {
			return scoped;
		},
		get eyeHeight() {
			return eye;
		},
	};
}
