// input.js - keyboard and mouse state for the local player.
// One job: turn DOM events into game-readable state. Nothing here knows
// about rounds or weapons; main.js wires the discrete events emitted here
// (buy, slot, scoreboard, use, mute, reload, lockchange) to the systems
// that own them.
//
// Held state lives in `keys` (e.code strings; mouse buttons appear as
// "Mouse0/1/2"). `pressed` collects the codes that went down since the
// last endFrame() call, which is how semi-auto fire and jumping read an
// edge instead of a level - consumePressed() reads and clears one code.
// Mouse look accumulates only while pointer-locked and is handed out
// through consumeLook(); the wheel accumulates signed notches for weapon
// swap and is read through consumeWheel().

const PREVENT_DEFAULT = new Set([
	"Tab", "Space",
	"ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
	"ControlLeft", "ControlRight",
]);

// Single-fire key events: code -> emitted event name.
const DISCRETE = { KeyB: "buy", KeyM: "mute", KeyR: "reload" };

export function createInput(canvas) {
	const keys = new Set();
	const pressed = new Set();
	const handlers = new Map(); // event name -> Set<fn>
	const lookOut = { dx: 0, dy: 0 }; // reused by consumeLook, copy out fast
	let lookDX = 0;
	let lookDY = 0;
	let wheel = 0;
	let locked = false;

	function on(name, fn) {
		let set = handlers.get(name);
		if (!set) {
			set = new Set();
			handlers.set(name, set);
		}
		set.add(fn);
		return () => set.delete(fn);
	}

	function emit(name, arg) {
		const set = handlers.get(name);
		if (!set) return;
		for (const fn of [...set]) fn(arg);
	}

	function clearTransient() {
		keys.clear();
		pressed.clear();
		lookDX = 0;
		lookDY = 0;
		wheel = 0;
	}

	// --- keyboard -------------------------------------------------------------
	function onKeyDown(e) {
		if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
		const fresh = !keys.has(e.code) && !e.repeat;
		keys.add(e.code);
		if (!fresh) return;
		pressed.add(e.code);
		emit("key", e.code);
		if (e.code === "Tab") emit("scoreboard", true);
		else if (e.code === "KeyE") emit("use", true);
		else if (e.code.startsWith("Digit")) {
			const n = Number(e.code.slice(5));
			if (n >= 1 && n <= 4) emit("slot", n);
		} else if (DISCRETE[e.code]) emit(DISCRETE[e.code]);
	}

	function onKeyUp(e) {
		keys.delete(e.code);
		if (e.code === "Tab") emit("scoreboard", false);
		else if (e.code === "KeyE") emit("use", false);
	}

	// --- mouse ------------------------------------------------------------------
	function onMouseMove(e) {
		if (!locked) return;
		lookDX += e.movementX || 0;
		lookDY += e.movementY || 0;
	}

	function onMouseDown(e) {
		if (!locked) {
			// A click on the canvas is the standard way back into the game
			// after pointer lock was lost (pause overlay, buy menu, ...).
			lock();
			return;
		}
		const code = "Mouse" + e.button;
		if (!keys.has(code)) pressed.add(code);
		keys.add(code);
		if (e.button === 0 || e.button === 2) e.preventDefault();
	}

	function onMouseUp(e) {
		keys.delete("Mouse" + e.button);
	}

	function onWheel(e) {
		if (!locked) return;
		wheel += Math.sign(e.deltaY);
		e.preventDefault();
	}

	function onContextMenu(e) {
		e.preventDefault();
	}

	// --- pointer lock -------------------------------------------------------------
	function onLockChange() {
		locked = document.pointerLockElement === canvas;
		// Losing the lock mid-action must not leave a stuck trigger or a
		// half-held strafe, so all transient state goes with it.
		if (!locked) clearTransient();
		emit("lockchange", locked);
		if (api.onLockChange) api.onLockChange(locked);
	}

	function lock() {
		if (locked || document.pointerLockElement === canvas) return;
		try {
			const p = canvas.requestPointerLock();
			if (p && typeof p.catch === "function") p.catch(() => {});
		} catch {
			// Pointer lock needs a user gesture; the next click retries.
		}
	}

	function unlock() {
		if (document.pointerLockElement) document.exitPointerLock();
	}

	const api = {
		keys,
		pressed,
		on,
		lock,
		unlock,
		// Set by main.js: called with false when pointer lock is lost so
		// the match can pause. (The "lockchange" event carries the same.)
		onLockChange: null,
		get locked() {
			return locked;
		},
		get firing() {
			return keys.has("Mouse0");
		},
		get aiming() {
			return keys.has("Mouse2");
		},
		// Accumulated mouse movement since the last call, in pixels.
		// Returns a shared object - read the values immediately.
		consumeLook() {
			lookOut.dx = lookDX;
			lookOut.dy = lookDY;
			lookDX = 0;
			lookDY = 0;
			return lookOut;
		},
		// Signed wheel notches since the last call (+ = scrolled down).
		consumeWheel() {
			const w = wheel;
			wheel = 0;
			return w;
		},
		// True once if `code` went down since the last endFrame().
		consumePressed(code) {
			if (!pressed.has(code)) return false;
			pressed.delete(code);
			return true;
		},
		// Called by main.js once per rendered frame, after the fixed-step
		// simulation has had its chance to consume edges.
		endFrame() {
			pressed.clear();
		},
	};

	// Listeners are registered last: onLockChange reads `api`, so the
	// object must exist before any event can fire.
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);
	window.addEventListener("blur", clearTransient);
	canvas.addEventListener("mousemove", onMouseMove);
	canvas.addEventListener("mousedown", onMouseDown);
	window.addEventListener("mouseup", onMouseUp);
	canvas.addEventListener("wheel", onWheel, { passive: false });
	canvas.addEventListener("contextmenu", onContextMenu);
	document.addEventListener("pointerlockchange", onLockChange);

	return api;
}
