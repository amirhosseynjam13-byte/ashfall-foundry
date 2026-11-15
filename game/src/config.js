// config.js - every tuning number in the game: match, weapons, armor, grenades, the buy list.
export const CFG = {

	teamNames: ["Ember Cell", "Foundry Guard"],
	teamColors: [0xff7a26, 0x2fd4c4],

	roundsToWin: 7,
	maxRounds: 12,
	freezeTime: 4,
	roundTime: 105,
	bombTime: 40,
	plantTime: 4,
	defuseTimeKit: 5,
	defuseTimeNoKit: 10,
	roundEndTime: 4,

	startMoney: 800,
	maxMoney: 16000,
	killReward: 300,
	plantRewardTeam: 300,
	winRewardElim: 3250,
	winRewardObjective: 3500,
	lossBase: 1400,
	lossStreakStep: 500,
	lossStreakCap: 2000,

	actorRadius: 0.42,
	actorHeight: 1.78,
	eyeStand: 1.62,
	eyeCrouch: 1.15,
	gravity: 12.5,
	jumpVel: 4.6,
	stepHeight: 0.45,

	speedRun: 5.2,
	speedWalk: 3.2,
	speedCrouch: 1.7,
	groundAccel: 12,
	groundFriction: 6,
	airAccel: 0.6,

	falloffStart: 18,
	falloffEnd: 60,
	falloffMinFrac: 0.55,

	partMult: { head: 4.0, chest: 1.0, stomach: 1.0, arm: 0.85, leg: 0.75 },
	armorFactor: 0.5,

	simRate: 60,
	defaultSeed: 20251116,
};

export const WEAPONS = {
	knife: {
		name: "Foundry Shiv", price: 0, slot: 3, kind: "melee",
		damage: 55, backstab: 120, rpm: 120, range: 1.9,
	},
	p9: {
		name: "P9 Sidearm", price: 0, slot: 2, kind: "pistol",
		damage: 34, rpm: 400, mode: "semi", mag: 12, reserve: 96,
		spread: [0.6, 2.2], recoil: 0.5, reload: 1.6, drawTime: 0.45,
		moveSpeed: 5.2, zoom: 1.0,
	},
	mule: {
		name: "Mule 870", price: 1100, slot: 1, kind: "shotgun",
		damage: 14, pellets: 8, rpm: 68, mode: "pump", mag: 6, reserve: 30,
		spread: [3.5, 5.0], recoil: 1.9, reload: 0.55, reloadPerShell: true,
		drawTime: 0.7, moveSpeed: 4.9, zoom: 1.0,
	},
	raptor: {
		name: "Raptor-9 SMG", price: 1400, slot: 1, kind: "smg",
		damage: 26, rpm: 780, mode: "auto", mag: 30, reserve: 120,
		spread: [1.1, 3.4], recoil: 0.38, reload: 2.1, drawTime: 0.65,
		moveSpeed: 5.15, zoom: 1.0,
	},
	vulcan: {
		name: "VK Vulcan Rifle", price: 2700, slot: 1, kind: "rifle",
		damage: 36, rpm: 600, mode: "auto", mag: 30, reserve: 120,
		spread: [0.9, 3.8], recoil: 0.55, reload: 2.4, drawTime: 0.8,
		moveSpeed: 4.95, zoom: 1.08,
	},
	longshot: {
		name: "Longshot .338", price: 4750, slot: 1, kind: "sniper",
		damage: 105, rpm: 42, mode: "bolt", mag: 5, reserve: 25,
		spread: [6.0, 9.0], spreadScoped: 0.05, recoil: 2.2, reload: 3.2,
		drawTime: 0.95, moveSpeed: 4.7, zoom: 2.6,
	},
};

export const ARMOR = {
	vest: { name: "Kevlar Vest", price: 650 },
	vestHelmet: { name: "Vest + Helmet", price: 1000 },
};

export const GRENADES = {
	frag: { name: "Frag Grenade", price: 300, damage: 85, radius: 4.5 },
	smoke: { name: "Smoke Grenade", price: 300, duration: 7, radius: 3.4 },
	flash: { name: "Flashbang", price: 200, duration: 2.2, range: 25 },
};

export const BUY = [
	["weapon", "mule"], ["weapon", "raptor"], ["weapon", "vulcan"], ["weapon", "longshot"],
	["armor", "vest"], ["armor", "vestHelmet"],
	["grenade", "frag"], ["grenade", "smoke"], ["grenade", "flash"],
];
