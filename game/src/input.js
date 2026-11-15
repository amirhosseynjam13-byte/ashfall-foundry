const PREVENT_DEFAULT = new Set([
	"Tab", "Space",
	"ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
	"ControlLeft", "ControlRight",
]);

const DISCRETE = { KeyB: "buy", KeyM: "mute", KeyR: "reload" };

export function createInput(canvas) {
	const keys = new Set();
	const pressed = new Set();
	const handlers = new Map();
	const lookOut = { dx: 0, dy: 0 };
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

	function onMouseMove(e) {
		if (!locked) return;
		lookDX += e.movementX || 0;
		lookDY += e.movementY || 0;
	}

	function onMouseDown(e) {
		if (!locked) {

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

	function onLockChange() {
		locked = document.pointerLockElement === canvas;

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

		consumeLook() {
			lookOut.dx = lookDX;
			lookOut.dy = lookDY;
			lookDX = 0;
			lookDY = 0;
			return lookOut;
		},

		consumeWheel() {
			const w = wheel;
			wheel = 0;
			return w;
		},

		consumePressed(code) {
			if (!pressed.has(code)) return false;
			pressed.delete(code);
			return true;
		},

		endFrame() {
			pressed.clear();
		},
	};

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
