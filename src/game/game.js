const FALLBACKS = {
  PLAYER_CAR: "/generated-assets/player_car-transparent.webp",
  RIVAL_CARS: "/generated-assets/rival_cars-transparent.webp",
  RIVAL_CARS_FRAMES: "/generated-assets/rival_cars-transparent.frames.json",
  ASPHALT_TEXTURE: "/generated-assets/asphalt_texture.webp",
  GRANDSTAND_BACKDROP: "/generated-assets/grandstand_backdrop.webp",
  RACING_EFFECTS: "/generated-assets/racing_effects-transparent.webp",
  RACING_EFFECTS_FRAMES: "/generated-assets/racing_effects-transparent.frames.json",
};

const DEFAULT_TWEAKS = {
  baseSpeed: 380,
  speedRamp: 0.017,
  trafficIntensity: 1,
  steeringGrip: 9.5,
  trafficSpeed: 0.52,
  powerupFrequency: 1,
  effectsIntensity: 1,
};

const LANES = [-0.72, 0, 0.72];
const RIVAL_VARIANTS = ["red_car", "yellow_car", "green_car", "white_car"];
const POWERUP_TYPES = ["invincible", "doubleScore", "speedBoost"];
const POWERUP_META = {
  invincible: { label: "Shield", short: "SHD", color: "#6ef7ff", duration: 10 },
  doubleScore: { label: "2x Score", short: "2X", color: "#ffe66d", duration: 10 },
  speedBoost: { label: "Boost", short: "BST", color: "#ff5f7d", duration: 8 },
};
const DEFAULT_KEY_BINDINGS = {
  left: "ArrowLeft",
  right: "ArrowRight",
  pause: "Escape",
};
const KEY_BINDING_STORAGE = "apexSlipstream.keyBindings.v1";
const CONTROL_ACTIONS = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "pause", label: "Pause" },
];

export function createGame({ mount, sdk, tweaks, assets }) {
  let cleanup = () => {};

  return {
    start() {
      const shell = document.createElement("section");
      shell.className = "apex-shell";

      const canvas = document.createElement("canvas");
      canvas.className = "game-surface apex-canvas";
      shell.append(canvas);

      const hud = createHud(shell);
      mount.replaceChildren(shell);

      const context = canvas.getContext("2d", { alpha: false });
      const viewport = { width: 1, height: 1, dpr: 1 };
      const state = createRaceState();
      const tuning = createTuning(tweaks);
      const audio = createAudioController(sdk);
      const keyBindings = createKeyBindings();
      const controls = createControls(canvas, () => canvas.getBoundingClientRect(), keyBindings.values, () => {
        if (state.mode === "running") {
          state.mode = "paused";
          hud.showPause(state);
        } else if (state.mode === "paused") {
          state.mode = "running";
          hud.hideOverlay();
        }
      });

      let disposed = false;
      let frameId = 0;
      let lastTime = performance.now();
      let loadedAssets = null;
      let loadingError = "";
      let assetsReady = false;
      let resultSubmitted = false;

      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(shell);
      resize();

      Promise.all([loadGameAssets(assets), loadBestScore(sdk)])
        .then(([gameAssets, best]) => {
          loadedAssets = gameAssets;
          state.best = best;
          assetsReady = true;
          resetRace(state, viewport);
          hud.setReady(state.best);
        })
        .catch(() => {
          loadingError = "Pit crew missed a part. Retry the preview.";
          hud.setError(loadingError);
        });

      hud.onStart(async () => {
        if (!assetsReady || loadingError) return;
        resultSubmitted = false;
        resetRace(state, viewport);
        state.mode = "running";
        controls.reset(state.player.x);
        hud.hideOverlay();
        audio.unlock().then(() => audio.startEngine()).catch(() => {});
      });
      hud.onResume(() => {
        if (state.mode !== "paused") return;
        state.mode = "running";
        hud.hideOverlay();
      });
      hud.onPause(() => {
        if (state.mode !== "running") return;
        state.mode = "paused";
        hud.showPause(state);
      });
      hud.onBindingsChange((nextBindings) => {
        keyBindings.set(nextBindings);
        controls.setBindings(keyBindings.values);
        hud.setKeyBindings(keyBindings.values);
      });
      hud.setKeyBindings(keyBindings.values);

      function resize() {
        const rect = shell.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        viewport.width = Math.max(1, rect.width);
        viewport.height = Math.max(1, rect.height);
        viewport.dpr = dpr;
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (state.mode !== "running") resetRace(state, viewport, { keepBest: true });
      }

      function loop(now) {
        if (disposed) return;
        const dt = Math.min(0.033, Math.max(0, (now - lastTime) / 1000));
        lastTime = now;

        if (assetsReady) {
          const input = controls.sample();
          const finished = updateRace(state, dt, input, tuning.values, viewport, {
            hit: () => {
              audio.crash();
              vibrate(sdk, 80);
            },
            draft: () => audio.draftPing(),
          });

          audio.updateEngine(state.speed, state.mode === "running");
          hud.update(state);

          if (finished && !resultSubmitted) {
            resultSubmitted = true;
            finishRun(state, sdk).catch(() => {});
            hud.showResult(state);
          }
        }

        if (loadedAssets) {
          renderRace(context, state, loadedAssets, viewport, now / 1000, tuning.values);
        } else {
          drawLoadingFrame(context, viewport);
        }

        frameId = requestAnimationFrame(loop);
      }

      frameId = requestAnimationFrame(loop);

      cleanup = () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
        controls.dispose();
        tuning.dispose();
        audio.dispose();
        hud.dispose();
        mount.replaceChildren();
      };
    },
    destroy() {
      cleanup();
      cleanup = () => {};
    },
  };
}

async function loadGameAssets(assets) {
  const urlFor = (key) => assets?.get?.(key) || FALLBACKS[key];
  const [playerCar, rivalCars, asphalt, backdrop, effects, rivalFrames, effectFrames] = await Promise.all([
    loadImage(urlFor("PLAYER_CAR")),
    loadImage(urlFor("RIVAL_CARS")),
    loadImage(urlFor("ASPHALT_TEXTURE")),
    loadImage(urlFor("GRANDSTAND_BACKDROP")),
    loadImage(urlFor("RACING_EFFECTS")),
    loadJson(urlFor("RIVAL_CARS_FRAMES")),
    loadJson(urlFor("RACING_EFFECTS_FRAMES")),
  ]);

  return {
    images: { playerCar, rivalCars, asphalt, backdrop, effects },
    rivalFrames: mapFrames(rivalFrames.frames),
    effectFrames: mapFrames(effectFrames.frames),
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image ${url}`));
    image.src = url;
  });
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load data ${url}`);
  return response.json();
}

function mapFrames(frames) {
  return Object.fromEntries(frames.map((frame) => [frame.name, frame]));
}

async function loadBestScore(sdk) {
  try {
    const save = await sdk.gameState.load();
    if (save && save.version === 1 && Number.isFinite(save.bestScore)) {
      return Math.max(0, Math.floor(save.bestScore));
    }
  } catch {
    // Local previews can run without durable host save data.
  }
  return 0;
}

async function vibrate(sdk, duration) {
  try {
    if (sdk.device?.haptics?.isSupported()) {
      await sdk.device.haptics.vibrate(duration);
    }
  } catch {
    // Haptics are a bonus; gameplay must not depend on them.
  }
}

function createTuning(tweaks) {
  const values = { ...DEFAULT_TWEAKS };
  const unsubscribers = [];

  for (const [key, fallback] of Object.entries(DEFAULT_TWEAKS)) {
    values[key] = readNumber(tweaks, key, fallback);
    if (typeof tweaks?.subscribe === "function") {
      const unsubscribe = tweaks.subscribe(key, (nextValue) => {
        values[key] = coerceNumber(nextValue, fallback);
      });
      if (typeof unsubscribe === "function") unsubscribers.push(unsubscribe);
    }
  }

  return {
    values,
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  };
}

function readNumber(tweaks, key, fallback) {
  if (typeof tweaks?.get !== "function") return fallback;
  return coerceNumber(tweaks.get(key), fallback);
}

function coerceNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createKeyBindings() {
  let values = readKeyBindings();

  return {
    get values() {
      return { ...values };
    },
    set(nextBindings) {
      values = normalizeKeyBindings(nextBindings);
      try {
        window.localStorage.setItem(KEY_BINDING_STORAGE, JSON.stringify(values));
      } catch {
        // Keybinds are still usable for this session if storage is blocked.
      }
    },
  };
}

function readKeyBindings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY_BINDING_STORAGE) || "{}");
    return normalizeKeyBindings(saved);
  } catch {
    return { ...DEFAULT_KEY_BINDINGS };
  }
}

function normalizeKeyBindings(bindings) {
  const normalized = { ...DEFAULT_KEY_BINDINGS };
  for (const action of CONTROL_ACTIONS) {
    if (typeof bindings?.[action.id] === "string" && bindings[action.id]) {
      normalized[action.id] = bindings[action.id];
    }
  }

  const used = new Set();
  for (const action of CONTROL_ACTIONS) {
    if (used.has(normalized[action.id])) normalized[action.id] = DEFAULT_KEY_BINDINGS[action.id];
    used.add(normalized[action.id]);
  }
  return normalized;
}

function createControls(surface, getBounds, initialBindings, onPause) {
  const state = {
    active: false,
    pointerId: null,
    pointerX: 0,
    steer: 0,
  };
  const keys = new Set();
  let bindings = normalizeKeyBindings(initialBindings);

  function setPointer(event) {
    const rect = getBounds();
    state.pointerX = event.clientX - rect.left;
  }

  function onPointerDown(event) {
    state.active = true;
    state.pointerId = event.pointerId;
    setPointer(event);
    surface.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!state.active || event.pointerId !== state.pointerId) return;
    setPointer(event);
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (event.pointerId !== state.pointerId) return;
    state.active = false;
    state.pointerId = null;
    surface.releasePointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onKeyDown(event) {
    if (!event.repeat && event.code === bindings.pause) {
      onPause?.();
      event.preventDefault();
      return;
    }

    if ([bindings.left, bindings.right].includes(event.code)) {
      keys.add(event.code);
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return {
    sample() {
      const left = keys.has(bindings.left);
      const right = keys.has(bindings.right);
      state.steer = (right ? 1 : 0) - (left ? 1 : 0);
      return { active: state.active, pointerX: state.pointerX, steer: state.steer };
    },
    setBindings(nextBindings) {
      bindings = normalizeKeyBindings(nextBindings);
      keys.clear();
    },
    reset(x) {
      state.pointerX = x;
      state.active = false;
      state.pointerId = null;
      state.steer = 0;
      keys.clear();
    },
    dispose() {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    },
  };
}

function createRaceState() {
  return {
    mode: "idle",
    distance: 0,
    score: 0,
    scoreFloat: 0,
    best: 0,
    speed: 0,
    boost: 0,
    draftPulse: 0,
    shake: 0,
    crashReason: "",
    showHintFor: 4,
    nextSpawn: 520,
    nextPowerup: 900,
    nextGate: 720,
    milestone: 0,
    closeMissStreak: 0,
    bonusFlash: 0,
    bonusText: "",
    activePowerups: {
      invincible: 0,
      doubleScore: 0,
      speedBoost: 0,
    },
    player: {
      x: 0,
      y: 0,
      targetX: 0,
      angle: 0,
      scrape: 0,
    },
    rivals: [],
    powerups: [],
    particles: [],
    gates: [],
  };
}

function resetRace(state, viewport, options = {}) {
  state.mode = "idle";
  state.distance = 0;
  state.score = 0;
  state.scoreFloat = 0;
  state.speed = 0;
  state.boost = 0;
  state.draftPulse = 0;
  state.shake = 0;
  state.crashReason = "";
  state.showHintFor = 4;
  state.nextSpawn = 520;
  state.nextPowerup = 900;
  state.nextGate = 720;
  state.milestone = 0;
  state.closeMissStreak = 0;
  state.bonusFlash = 0;
  state.bonusText = "";
  state.activePowerups.invincible = 0;
  state.activePowerups.doubleScore = 0;
  state.activePowerups.speedBoost = 0;
  state.player.y = viewport.height * 0.78;
  state.player.x = getTrackCenter(0, viewport);
  state.player.targetX = state.player.x;
  state.player.angle = 0;
  state.player.scrape = 0;
  state.rivals = [];
  state.powerups = [];
  state.particles = [];
  state.gates = [];
  if (!options.keepBest) state.best = Math.max(0, state.best);
}

function updateRace(state, dt, input, tuning, viewport, feedback) {
  if (state.mode === "paused") return false;

  if (state.mode !== "running") {
    updateParticles(state, dt);
    return false;
  }

  state.showHintFor = Math.max(0, state.showHintFor - dt);
  const baseSpeed = tuning.baseSpeed;
  const ramp = Math.min(235, state.distance * tuning.speedRamp);
  const powerBoost = state.activePowerups.speedBoost > 0 ? 155 : 0;
  state.speed = baseSpeed + ramp + state.boost * 135 + powerBoost;
  state.distance += state.speed * dt;
  const scoreMultiplier = state.activePowerups.doubleScore > 0 ? 2 : 1;
  state.scoreFloat += (state.speed * dt / 8) * scoreMultiplier;
  state.score = Math.max(state.score, Math.floor(state.scoreFloat + state.boost * 40 * scoreMultiplier));

  updatePlayer(state, input, tuning, viewport, dt);
  updatePowerupTimers(state, dt);
  spawnTraffic(state, viewport, tuning);
  spawnPowerups(state, viewport, tuning);
  updateRivals(state, viewport, dt, tuning);
  updatePowerups(state, viewport);
  updateGates(state);
  updateCloseMisses(state, viewport);
  updateDraft(state, viewport, dt, feedback);
  updateParticles(state, dt);
  updateRoadPressure(state, viewport, dt);

  if (checkWallCrash(state, viewport)) {
    if (state.activePowerups.invincible > 0) {
      const road = roadEdgesAt(state.distance, viewport);
      state.player.x = clamp(state.player.x, road.left + 28, road.right - 28);
      state.player.targetX = state.player.x;
      state.shake = Math.max(state.shake, 6);
      addBurst(state, state.player.x, state.player.y + 20, "cyan", 8);
      return false;
    }
    crash(state, "Wall", feedback);
    return true;
  }
  const hitRival = checkRivalCrash(state, viewport);
  if (hitRival) {
    if (state.activePowerups.invincible > 0) {
      hitRival.destroyed = true;
      state.shake = Math.max(state.shake, 7);
      awardBonus(state, 120, "Shield smash");
      addBurst(state, state.player.x, state.player.y - 26, "cyan", 18);
      state.rivals = state.rivals.filter((rival) => !rival.destroyed);
      return false;
    }
    crash(state, "Traffic", feedback);
    return true;
  }

  return false;
}

async function finishRun(state, sdk) {
  const score = Math.max(0, Math.floor(state.score));
  state.best = Math.max(state.best, score);
  try {
    await sdk.gameState.save({ version: 1, bestScore: state.best });
  } catch {
    // Saving should never block the one-more-try loop.
  }
  if (Number.isFinite(score)) {
    try {
      await sdk.leaderboard.submit(score);
    } catch {
      // Leaderboards appear after posting; preview can safely ignore failures.
    }
  }
}

function updatePlayer(state, input, tuning, viewport, dt) {
  const player = state.player;
  const road = roadEdgesAt(state.distance, viewport);
  if (input.active) {
    player.targetX = clamp(input.pointerX, road.left + 18, road.right - 18);
  } else if (input.steer !== 0) {
    player.targetX = clamp(player.targetX + input.steer * viewport.width * 0.82 * dt, road.left + 18, road.right - 18);
  }

  const previousX = player.x;
  const follow = 1 - Math.exp(-tuning.steeringGrip * dt);
  player.x += (player.targetX - player.x) * follow;
  player.angle = clamp((player.x - previousX) * 0.018, -0.28, 0.28);
}

function spawnTraffic(state, viewport, tuning) {
  while (state.nextSpawn < state.distance + viewport.height * 1.35) {
    const progress = Math.min(1, state.distance / 9000);
    const doubleChance = (0.16 + progress * 0.32) * tuning.trafficIntensity;
    const count = Math.random() < doubleChance ? 2 : 1;
    const lanes = shuffledLanes().slice(0, count);
    for (const lane of lanes) {
      state.rivals.push({
        station: state.nextSpawn + Math.random() * 65,
        lane,
        pace: 0.35 + Math.random() * 0.24,
        speed: 0,
        sway: (Math.random() - 0.5) * 0.08,
        drift: (Math.random() - 0.5) * 0.55,
        phase: Math.random() * Math.PI * 2,
        variant: RIVAL_VARIANTS[Math.floor(Math.random() * RIVAL_VARIANTS.length)],
        tilt: 0,
        drafted: false,
        closeMissed: false,
      });
    }
    const gap = clamp(650 - state.distance * 0.026, 270, 650) / clamp(tuning.trafficIntensity, 0.55, 1.8);
    state.nextSpawn += gap + Math.random() * 120;
  }
}

function spawnPowerups(state, viewport, tuning) {
  const frequency = clamp(tuning.powerupFrequency, 0.3, 2);
  while (state.nextPowerup < state.distance + viewport.height * 1.45) {
    state.powerups.push({
      station: state.nextPowerup + Math.random() * 120,
      lane: LANES[Math.floor(Math.random() * LANES.length)],
      type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)],
      phase: Math.random() * Math.PI * 2,
    });
    state.nextPowerup += (1150 + Math.random() * 680) / frequency;
  }
}

function updateRivals(state, viewport, dt, tuning) {
  for (const rival of state.rivals) {
    const speedTarget = state.speed * clamp(rival.pace * tuning.trafficSpeed * 1.8, 0.24, 0.72);
    rival.speed += (speedTarget - rival.speed) * (1 - Math.exp(-2.6 * dt));
    rival.station += rival.speed * dt;

    const previousLane = rival.lane;
    const drift = Math.sin(state.distance * 0.0014 + rival.phase) * rival.sway * 0.004;
    const patientLaneChange = Math.sin((state.distance + rival.phase * 220) * 0.00036) * rival.drift * 0.00075;
    rival.lane = clamp(rival.lane + drift + patientLaneChange, -0.78, 0.78);
    rival.tilt = clamp((rival.lane - previousLane) * 24, -0.13, 0.13);
  }
  state.rivals = state.rivals.filter((rival) => screenYForStation(state, rival.station) < viewport.height + 180);
}

function updatePowerupTimers(state, dt) {
  for (const key of Object.keys(state.activePowerups)) {
    state.activePowerups[key] = Math.max(0, state.activePowerups[key] - dt);
  }
  state.bonusFlash = Math.max(0, state.bonusFlash - dt);
}

function updatePowerups(state, viewport) {
  const carH = getPlayerHeight(viewport);
  const pickupRadius = Math.max(34, carH * 0.34);
  for (const powerup of state.powerups) {
    const y = screenYForStation(state, powerup.station);
    const x = laneX(powerup.station, powerup.lane, viewport);
    const touching = Math.abs(y - state.player.y) < pickupRadius && Math.abs(x - state.player.x) < pickupRadius;
    if (!touching) continue;
    const meta = POWERUP_META[powerup.type];
    state.activePowerups[powerup.type] = meta.duration;
    powerup.collected = true;
    awardBonus(state, 90, meta.label);
    addBurst(state, x, y, powerup.type === "doubleScore" ? "gold" : "cyan", 16);
  }
  state.powerups = state.powerups.filter((powerup) => {
    if (powerup.collected) return false;
    return screenYForStation(state, powerup.station) < viewport.height + 140;
  });
}

function updateCloseMisses(state, viewport) {
  const playerH = getPlayerHeight(viewport);
  const playerW = playerH * 0.42;
  const rivalH = playerH * 0.78;
  const rivalW = rivalH * 0.5;
  const collisionGap = (playerW + rivalW) * 0.44;
  const nearGap = collisionGap + Math.min(62, getRoadHalfWidth(viewport) * 0.28);

  for (const rival of state.rivals) {
    if (rival.closeMissed) continue;
    const y = screenYForStation(state, rival.station);
    if (y < state.player.y + rivalH * 0.22) continue;
    if (y > state.player.y + rivalH * 0.62) {
      rival.closeMissed = true;
      continue;
    }
    const x = laneX(rival.station, rival.lane, viewport);
    const gap = Math.abs(x - state.player.x);
    if (gap <= collisionGap || gap > nearGap) continue;
    rival.closeMissed = true;
    state.closeMissStreak += 1;
    const precision = 1 - (gap - collisionGap) / Math.max(1, nearGap - collisionGap);
    const bonus = Math.round((70 + precision * 90 + Math.min(5, state.closeMissStreak) * 18) / 10) * 10;
    awardBonus(state, bonus, "Close miss");
    addBurst(state, state.player.x + Math.sign(state.player.x - x) * 28, state.player.y - 18, "gold", 10);
  }
}

function awardBonus(state, amount, label) {
  const multiplier = state.activePowerups.doubleScore > 0 ? 2 : 1;
  const total = Math.round(amount * multiplier);
  state.scoreFloat += total;
  state.score = Math.max(state.score, Math.floor(state.scoreFloat));
  state.bonusFlash = 1.25;
  state.bonusText = `+${total} ${label}`;
}

function updateGates(state) {
  while (state.nextGate < state.distance + 1200) {
    state.gates.push({ station: state.nextGate, hue: state.gates.length % 2 });
    state.nextGate += 780;
  }
  state.gates = state.gates.filter((gate) => gate.station > state.distance - 160);
  const milestone = Math.floor(state.score / 500);
  if (milestone > state.milestone) {
    state.milestone = milestone;
    addBurst(state, state.player.x, state.player.y - 58, "cyan", 12);
  }
}

function updateDraft(state, viewport, dt, feedback) {
  let drafting = false;
  for (const rival of state.rivals) {
    const y = screenYForStation(state, rival.station);
    const x = laneX(rival.station, rival.lane, viewport);
    const ahead = y < state.player.y - 34 && y > state.player.y - 265;
    const linedUp = Math.abs(x - state.player.x) < Math.min(70, getRoadHalfWidth(viewport) * 0.34);
    rival.drafted = ahead && linedUp;
    drafting ||= rival.drafted;
  }

  if (drafting) {
    const wasLow = state.draftPulse <= 0;
    state.boost = clamp(state.boost + dt * 0.62, 0, 1);
    state.draftPulse = Math.max(state.draftPulse, 0.24);
    if (wasLow) feedback.draft?.();
  } else {
    state.boost = Math.max(0, state.boost - dt * 0.31);
  }
  state.draftPulse = Math.max(0, state.draftPulse - dt);
}

function updateRoadPressure(state, viewport, dt) {
  const road = roadEdgesAt(state.distance, viewport);
  const edgeDistance = Math.min(state.player.x - road.left, road.right - state.player.x);
  state.player.scrape = edgeDistance < 34 ? 1 - edgeDistance / 34 : 0;
  if (state.player.scrape > 0) {
    state.shake = Math.max(state.shake, state.player.scrape * 3);
    if (Math.random() < dt * 12 * state.player.scrape) {
      addBurst(state, state.player.x + (state.player.x < road.center ? -26 : 26), state.player.y + 20, "orange", 2);
    }
  }
  state.shake = Math.max(0, state.shake - dt * 8);
}

function checkWallCrash(state, viewport) {
  const road = roadEdgesAt(state.distance, viewport);
  return state.player.x < road.left + 18 || state.player.x > road.right - 18;
}

function checkRivalCrash(state, viewport) {
  const playerH = getPlayerHeight(viewport);
  const playerW = playerH * 0.42;
  const rivalH = playerH * 0.78;
  const rivalW = rivalH * 0.5;
  for (const rival of state.rivals) {
    const y = screenYForStation(state, rival.station);
    if (Math.abs(y - state.player.y) > (playerH + rivalH) * 0.28) continue;
    const x = laneX(rival.station, rival.lane, viewport);
    if (Math.abs(x - state.player.x) < (playerW + rivalW) * 0.44) return rival;
  }
  return null;
}

function crash(state, reason, feedback) {
  state.mode = "crashed";
  state.crashReason = reason;
  state.shake = 12;
  addBurst(state, state.player.x, state.player.y - 12, "orange", 24);
  feedback.hit?.();
}

function updateParticles(state, dt) {
  for (const particle of state.particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 45 * dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);
}

function addBurst(state, x, y, color, count) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 210;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.28 + Math.random() * 0.38,
      maxLife: 0.66,
      color,
      size: 2 + Math.random() * 4,
    });
  }
}

function shuffledLanes() {
  return [...LANES].sort(() => Math.random() - 0.5);
}

function getRoadHalfWidth(viewport) {
  return clamp(viewport.width * 0.36, 108, Math.min(292, viewport.width * 0.43));
}

function getTrackCenter(station, viewport) {
  const primary = Math.sin(station * 0.00135 + 0.4);
  const secondary = Math.sin(station * 0.00051 + 1.8) * 0.62;
  return viewport.width * 0.5 + (primary + secondary) * viewport.width * 0.105;
}

function roadEdgesAt(station, viewport) {
  const center = getTrackCenter(station, viewport);
  const half = getRoadHalfWidth(viewport);
  return { center, half, left: center - half, right: center + half };
}

function stationForScreenY(state, viewport, y) {
  return state.distance + (state.player.y - y);
}

function screenYForStation(state, station) {
  return state.player.y - (station - state.distance);
}

function laneX(station, lane, viewport) {
  const road = roadEdgesAt(station, viewport);
  return road.center + lane * road.half * 0.66;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function renderRace(ctx, state, gameAssets, viewport, time, tuning) {
  ctx.save();
  const shake = state.shake * tuning.effectsIntensity;
  if (shake > 0.05) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }

  drawBackdrop(ctx, gameAssets.images.backdrop, viewport, state.distance);
  drawRoad(ctx, state, gameAssets, viewport);
  drawAtmosphere(ctx, state, viewport, time, tuning);
  drawSpeedStreaks(ctx, state, viewport, time, tuning);
  drawGates(ctx, state, viewport, time);
  drawPowerups(ctx, state, viewport, time);
  drawRivalWake(ctx, state, viewport, tuning);
  drawSlipstreams(ctx, state, viewport);
  drawRivals(ctx, state, gameAssets, viewport);
  drawPlayer(ctx, state, gameAssets, viewport, time);
  drawParticles(ctx, state, tuning);
  drawVignette(ctx, viewport, state);
  ctx.restore();
}

function drawBackdrop(ctx, image, viewport, distance) {
  const scale = Math.max(viewport.width / image.width, viewport.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const x = (viewport.width - width) * 0.5;
  const y = (viewport.height - height) * 0.5 + Math.sin(distance * 0.0004) * 12;
  ctx.drawImage(image, x, y, width, height);
  ctx.fillStyle = "rgba(2, 8, 16, 0.18)";
  ctx.fillRect(0, 0, viewport.width, viewport.height);
}

function drawSpeedStreaks(ctx, state, viewport, time, tuning) {
  const boostLift = state.activePowerups.speedBoost > 0 ? 0.08 : 0;
  const alpha = (Math.min(0.28, (state.speed / 740) * 0.22) + boostLift) * tuning.effectsIntensity;
  ctx.lineCap = "round";
  for (let index = 0; index < 24; index += 1) {
    const seed = index * 97;
    const y = (time * state.speed * (0.25 + (index % 3) * 0.05) + seed * 11) % (viewport.height + 120) - 60;
    const side = index % 2 === 0 ? 0.12 : 0.88;
    const x = viewport.width * side + Math.sin(time * 1.4 + seed) * 26;
    ctx.strokeStyle = `rgba(${index % 3 === 0 ? "255, 92, 116" : "80, 242, 255"}, ${alpha * (0.45 + (index % 4) * 0.16)})`;
    ctx.lineWidth = index % 3 === 0 ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (side < 0.5 ? 34 : -34), y - (70 + (index % 5) * 18));
    ctx.stroke();
  }
}

function drawRoad(ctx, state, gameAssets, viewport) {
  const path = buildRoadPath(state, viewport);
  ctx.save();
  ctx.fillStyle = "#1b2027";
  ctx.fill(path);
  const pattern = ctx.createPattern(gameAssets.images.asphalt, "repeat");
  if (pattern) {
    pattern.setTransform?.(new window.DOMMatrix().translate(0, state.distance % gameAssets.images.asphalt.height));
    ctx.fillStyle = pattern;
    ctx.fill(path);
  }
  drawRoadSurfaceDetails(ctx, state, viewport, path);
  ctx.restore();

  drawCurbs(ctx, state, viewport);
  drawTracksideBarriers(ctx, state, viewport);
  drawLaneLines(ctx, state, viewport);
  drawRoadGlow(ctx, path);
}

function buildRoadPath(state, viewport) {
  const left = [];
  const right = [];
  for (let y = -40; y <= viewport.height + 60; y += 24) {
    const station = stationForScreenY(state, viewport, y);
    const road = roadEdgesAt(station, viewport);
    left.push([road.left, y]);
    right.push([road.right, y]);
  }
  const path = new Path2D();
  path.moveTo(left[0][0], left[0][1]);
  for (const point of left) path.lineTo(point[0], point[1]);
  for (let index = right.length - 1; index >= 0; index -= 1) path.lineTo(right[index][0], right[index][1]);
  path.closePath();
  return path;
}

function drawCurbs(ctx, state, viewport) {
  for (const side of [-1, 1]) {
    for (let y = -30; y < viewport.height + 60; y += 26) {
      const station = stationForScreenY(state, viewport, y);
      const road = roadEdgesAt(station, viewport);
      const x = side < 0 ? road.left : road.right;
      const next = roadEdgesAt(stationForScreenY(state, viewport, y + 28), viewport);
      const nx = side < 0 ? next.left : next.right;
      ctx.strokeStyle = Math.floor((y + state.distance * 0.18) / 28) % 2 === 0 ? "#f64b54" : "#f1f6f8";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, y + 28);
      ctx.stroke();
    }
  }
}

function drawRoadSurfaceDetails(ctx, state, viewport, path) {
  ctx.save();
  ctx.clip(path);

  ctx.globalCompositeOperation = "multiply";
  for (const lane of [-0.34, 0.34]) {
    for (let y = -80; y < viewport.height + 120; y += 74) {
      const station = stationForScreenY(state, viewport, y + ((state.distance * 0.16) % 74));
      const road = roadEdgesAt(station, viewport);
      const x = road.center + lane * road.half + Math.sin(station * 0.01) * 8;
      ctx.strokeStyle = "rgba(4, 7, 10, 0.18)";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 38);
      ctx.quadraticCurveTo(x + 10, y, x - 2, y + 42);
      ctx.stroke();
    }
  }

  ctx.globalCompositeOperation = "screen";
  for (let y = -40; y < viewport.height + 80; y += 38) {
    const station = stationForScreenY(state, viewport, y);
    const road = roadEdgesAt(station, viewport);
    const sparkle = Math.sin(station * 0.035) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(172, 221, 235, ${0.018 + sparkle * 0.028})`;
    ctx.fillRect(road.left + road.half * 0.24, y, road.half * 1.52, 1);
  }

  ctx.restore();
}

function drawTracksideBarriers(ctx, state, viewport) {
  ctx.save();
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    for (let y = -40; y < viewport.height + 90; y += 70) {
      const station = stationForScreenY(state, viewport, y);
      const road = roadEdgesAt(station, viewport);
      const next = roadEdgesAt(stationForScreenY(state, viewport, y + 52), viewport);
      const x = side < 0 ? road.left - 22 : road.right + 22;
      const nx = side < 0 ? next.left - 22 : next.right + 22;
      const glow = Math.floor((station + state.distance * 0.2) / 180) % 2 === 0;
      ctx.strokeStyle = glow ? "rgba(69, 237, 255, 0.34)" : "rgba(255, 79, 107, 0.28)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, y + 52);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawLaneLines(ctx, state, viewport) {
  ctx.save();
  ctx.strokeStyle = "rgba(235, 247, 255, 0.68)";
  ctx.lineWidth = 2;
  ctx.setLineDash([24, 18]);
  ctx.lineDashOffset = state.distance * 0.25;
  for (const lane of [-0.34, 0.34]) {
    ctx.beginPath();
    for (let y = -30; y <= viewport.height + 40; y += 24) {
      const station = stationForScreenY(state, viewport, y);
      const x = getTrackCenter(station, viewport) + lane * getRoadHalfWidth(viewport);
      if (y === -30) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawRoadGlow(ctx, path) {
  ctx.save();
  ctx.strokeStyle = "rgba(70, 238, 255, 0.18)";
  ctx.lineWidth = 12;
  ctx.stroke(path);
  ctx.restore();
}

function drawAtmosphere(ctx, state, viewport, time, tuning) {
  ctx.save();
  const speed = clamp(state.speed / 740, 0, 1);
  const shimmer = Math.sin(time * 2.2 + state.distance * 0.003) * 0.03;
  const horizon = ctx.createLinearGradient(0, 0, 0, viewport.height);
  horizon.addColorStop(0, `rgba(103, 238, 255, ${(0.16 + shimmer) * tuning.effectsIntensity})`);
  horizon.addColorStop(0.38, "rgba(13, 29, 41, 0.04)");
  horizon.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(255, 70, 103, ${0.025 * speed * tuning.effectsIntensity})`;
  ctx.fillRect(0, viewport.height * 0.52, viewport.width, viewport.height * 0.48);
  ctx.restore();
}

function drawGates(ctx, state, viewport, time) {
  for (const gate of state.gates) {
    const y = screenYForStation(state, gate.station);
    if (y < -80 || y > viewport.height + 80) continue;
    const road = roadEdgesAt(gate.station, viewport);
    const pulse = 0.65 + Math.sin(time * 5 + gate.station) * 0.15;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.strokeStyle = gate.hue ? "rgba(255, 82, 100, 0.8)" : "rgba(67, 242, 255, 0.85)";
    ctx.beginPath();
    ctx.moveTo(road.left + 28, y);
    ctx.quadraticCurveTo(road.center, y - 34, road.right - 28, y);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSlipstreams(ctx, state, viewport) {
  for (const rival of state.rivals) {
    if (!rival.drafted) continue;
    const y = screenYForStation(state, rival.station);
    const x = laneX(rival.station, rival.lane, viewport);
    const gradient = ctx.createLinearGradient(x, y, state.player.x, state.player.y);
    gradient.addColorStop(0, "rgba(75, 244, 255, 0.44)");
    gradient.addColorStop(0.62, "rgba(255, 77, 116, 0.08)");
    gradient.addColorStop(1, "rgba(75, 244, 255, 0.03)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x - 22, y + 34);
    ctx.lineTo(x + 22, y + 34);
    ctx.lineTo(state.player.x + 68, state.player.y + 22);
    ctx.lineTo(state.player.x - 68, state.player.y + 22);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPowerups(ctx, state, viewport, time) {
  for (const powerup of state.powerups) {
    const y = screenYForStation(state, powerup.station);
    if (y < -80 || y > viewport.height + 120) continue;
    const x = laneX(powerup.station, powerup.lane, viewport);
    const meta = POWERUP_META[powerup.type];
    const bob = Math.sin(time * 5 + powerup.phase) * 4;
    const radius = Math.max(18, Math.min(28, viewport.width * 0.045));
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `${meta.color}22`;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, radius, time * 2.4, time * 2.4 + Math.PI * 1.55);
    ctx.stroke();
    ctx.fillStyle = "rgba(4, 15, 24, 0.86)";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = meta.color;
    ctx.font = `800 ${Math.max(10, radius * 0.48)}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(meta.short, 0, 1);
    ctx.restore();
  }
}

function drawRivalWake(ctx, state, viewport, tuning) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const rival of state.rivals) {
    const y = screenYForStation(state, rival.station);
    if (y < -100 || y > viewport.height + 160) continue;
    const x = laneX(rival.station, rival.lane, viewport);
    const relativeSpeed = clamp((state.speed - rival.speed) / 420, 0.1, 1);
    const length = 34 + relativeSpeed * 72;
    const alpha = 0.08 * relativeSpeed * tuning.effectsIntensity;
    const gradient = ctx.createLinearGradient(x, y + 22, x, y + length);
    gradient.addColorStop(0, `rgba(126, 236, 255, ${alpha})`);
    gradient.addColorStop(1, "rgba(126, 236, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x - 14, y + 22);
    ctx.lineTo(x + 14, y + 22);
    ctx.lineTo(x + 26, y + length);
    ctx.lineTo(x - 26, y + length);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawRivals(ctx, state, gameAssets, viewport) {
  const rivalH = getPlayerHeight(viewport) * 0.76;
  const visible = state.rivals
    .map((rival) => ({ rival, y: screenYForStation(state, rival.station) }))
    .filter((entry) => entry.y > -140 && entry.y < viewport.height + 120)
    .sort((a, b) => a.y - b.y);

  for (const entry of visible) {
    const x = laneX(entry.rival.station, entry.rival.lane, viewport);
    const speedLean = clamp((entry.rival.speed / Math.max(state.speed, 1)) * 0.08, 0, 0.08);
    drawShadow(ctx, x, entry.y + rivalH * 0.2, rivalH * 0.44, rivalH * 0.18);
    drawFrame(ctx, gameAssets.images.rivalCars, gameAssets.rivalFrames[entry.rival.variant], x, entry.y, rivalH, entry.rival.tilt + speedLean);
  }
}

function drawPlayer(ctx, state, gameAssets, viewport, time) {
  const carH = getPlayerHeight(viewport);
  const carW = carH * (gameAssets.images.playerCar.width / gameAssets.images.playerCar.height);
  drawShadow(ctx, state.player.x, state.player.y + carH * 0.22, carW * 0.72, carH * 0.22);

  if (state.boost > 0.05) {
    const frame = state.boost > 0.6 ? gameAssets.effectFrames.boost_3 : gameAssets.effectFrames.boost_2;
    drawFrame(ctx, gameAssets.images.effects, frame, state.player.x, state.player.y + carH * 0.5, carH * (0.85 + state.boost * 0.5), Math.PI);
  }

  if (state.activePowerups.speedBoost > 0) {
    const frame = gameAssets.effectFrames.boost_3 || gameAssets.effectFrames.boost_2;
    drawFrame(ctx, gameAssets.images.effects, frame, state.player.x, state.player.y + carH * 0.58, carH * 1.35, Math.PI);
  }

  if (state.activePowerups.invincible > 0) {
    const pulse = 0.55 + Math.sin(time * 9) * 0.12;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(110, 247, 255, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(state.player.x, state.player.y, carW * 0.64, carH * 0.58, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(state.player.x, state.player.y);
  ctx.rotate(state.player.angle + Math.sin(time * 18) * state.player.scrape * 0.025);
  ctx.drawImage(gameAssets.images.playerCar, -carW * 0.5, -carH * 0.5, carW, carH);
  ctx.restore();
}

function drawParticles(ctx, state, tuning) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const particle of state.particles) {
    const alpha = Math.max(0, particle.life / particle.maxLife) * tuning.effectsIntensity;
    ctx.fillStyle = particle.color === "cyan"
      ? `rgba(86, 245, 255, ${alpha})`
      : particle.color === "gold"
        ? `rgba(255, 230, 109, ${alpha})`
        : `rgba(255, 125, 60, ${alpha})`;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawVignette(ctx, viewport, state) {
  const gradient = ctx.createRadialGradient(viewport.width * 0.5, viewport.height * 0.54, viewport.width * 0.18, viewport.width * 0.5, viewport.height * 0.54, viewport.height * 0.72);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, state.mode === "crashed" ? "rgba(38, 4, 12, 0.55)" : "rgba(0, 0, 0, 0.34)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
}

function drawShadow(ctx, x, y, width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  ctx.beginPath();
  ctx.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFrame(ctx, image, frame, x, y, targetHeight, rotation) {
  if (!frame) return;
  const crop = frame.content || frame.source;
  const width = targetHeight * (crop.w / crop.h);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, -width * 0.5, -targetHeight * 0.5, width, targetHeight);
  ctx.restore();
}

function getPlayerHeight(viewport) {
  return Math.max(78, Math.min(134, viewport.height * 0.15));
}

function createHud(shell) {
  const hud = document.createElement("div");
  hud.className = "race-hud";
  hud.innerHTML = `
    <div class="hud-badge hud-distance"><span>Dist</span><strong>0 m</strong></div>
    <div class="hud-badge hud-best"><span>Best</span><strong>0 m</strong></div>
    <div class="hud-tools">
      <button class="hud-icon-button pause-button" type="button" aria-label="Pause">II</button>
      <button class="hud-icon-button controls-button" type="button" aria-label="Controls">⌨</button>
    </div>
    <div class="controls-panel" hidden>
      <div class="controls-panel-title">Controls</div>
      ${CONTROL_ACTIONS.map((action) => `
        <button class="keybind-button" type="button" data-action="${action.id}">
          <span>${action.label}</span><strong></strong>
        </button>
      `).join("")}
      <button class="reset-keybinds" type="button">Reset keys</button>
    </div>
    <div class="powerup-strip" aria-label="Active powerups"></div>
    <div class="bonus-toast" hidden></div>
    <div class="draft-meter" aria-label="Draft boost"><span></span></div>
    <div class="race-hint" hidden>Drag to hold the racing line</div>
  `;

  const overlay = document.createElement("button");
  overlay.className = "start-overlay";
  overlay.type = "button";
  overlay.innerHTML = `
    <span class="overlay-title">Apex Slipstream</span>
    <span class="overlay-copy">Loading the grid…</span>
  `;

  shell.append(hud, overlay);

  const distanceValue = hud.querySelector(".hud-distance strong");
  const bestValue = hud.querySelector(".hud-best strong");
  const meterFill = hud.querySelector(".draft-meter span");
  const powerupStrip = hud.querySelector(".powerup-strip");
  const bonusToast = hud.querySelector(".bonus-toast");
  const pauseButton = hud.querySelector(".pause-button");
  const controlsButton = hud.querySelector(".controls-button");
  const controlsPanel = hud.querySelector(".controls-panel");
  const keybindButtons = [...hud.querySelectorAll(".keybind-button")];
  const resetKeybinds = hud.querySelector(".reset-keybinds");
  const hint = hud.querySelector(".race-hint");
  const title = overlay.querySelector(".overlay-title");
  const copy = overlay.querySelector(".overlay-copy");
  const startHandlers = new Set();
  const pauseHandlers = new Set();
  const resumeHandlers = new Set();
  const bindingHandlers = new Set();
  let bindings = { ...DEFAULT_KEY_BINDINGS };
  let remappingAction = "";

  function startClick() {
    if (overlay.dataset.mode === "paused") {
      for (const handler of resumeHandlers) handler();
      return;
    }
    for (const handler of startHandlers) handler();
  }

  function pauseClick() {
    for (const handler of pauseHandlers) handler();
  }

  function controlsClick() {
    controlsPanel.hidden = !controlsPanel.hidden;
  }

  function keybindClick(event) {
    const action = event.currentTarget.dataset.action;
    remappingAction = action;
    refreshKeybinds();
  }

  function resetClick() {
    bindings = { ...DEFAULT_KEY_BINDINGS };
    remappingAction = "";
    notifyBindingsChanged();
  }

  function remapKeyDown(event) {
    if (!remappingAction) return;
    event.preventDefault();
    event.stopPropagation();
    const previousCode = bindings[remappingAction];
    const duplicateAction = CONTROL_ACTIONS.find((action) => action.id !== remappingAction && bindings[action.id] === event.code);
    bindings = { ...bindings, [remappingAction]: event.code };
    if (duplicateAction) bindings[duplicateAction.id] = previousCode;
    remappingAction = "";
    notifyBindingsChanged();
  }

  function notifyBindingsChanged() {
    bindings = normalizeKeyBindings(bindings);
    refreshKeybinds();
    for (const handler of bindingHandlers) handler(bindings);
  }

  function refreshKeybinds() {
    for (const button of keybindButtons) {
      const action = button.dataset.action;
      const value = button.querySelector("strong");
      button.classList.toggle("is-remapping", action === remappingAction);
      value.textContent = action === remappingAction ? "Press key" : formatKey(bindings[action]);
    }
  }

  overlay.addEventListener("click", startClick);
  pauseButton.addEventListener("click", pauseClick);
  controlsButton.addEventListener("click", controlsClick);
  resetKeybinds.addEventListener("click", resetClick);
  for (const button of keybindButtons) button.addEventListener("click", keybindClick);
  window.addEventListener("keydown", remapKeyDown, true);

  return {
    onStart(handler) {
      startHandlers.add(handler);
    },
    onPause(handler) {
      pauseHandlers.add(handler);
    },
    onResume(handler) {
      resumeHandlers.add(handler);
    },
    onBindingsChange(handler) {
      bindingHandlers.add(handler);
    },
    setKeyBindings(nextBindings) {
      bindings = normalizeKeyBindings(nextBindings);
      refreshKeybinds();
    },
    setReady(best) {
      overlay.dataset.mode = "start";
      title.textContent = "Apex Slipstream";
      copy.textContent = best > 0 ? `Best ${best} m · tap to race` : "Tap to race";
      bestValue.textContent = `${best} m`;
    },
    setError(message) {
      title.textContent = "Race delayed";
      copy.textContent = message;
    },
    hideOverlay() {
      overlay.dataset.mode = "";
      overlay.hidden = true;
    },
    showPause(state) {
      overlay.hidden = false;
      overlay.dataset.mode = "paused";
      title.textContent = "Paused";
      copy.textContent = `${state.score} m · tap to resume`;
    },
    showResult(state) {
      overlay.hidden = false;
      overlay.dataset.mode = "start";
      title.textContent = state.crashReason === "Wall" ? "Ran out of track" : "Wheel-to-wheel hit";
      copy.textContent = `${state.score} m · best ${state.best} m · tap retry`;
    },
    update(state) {
      distanceValue.textContent = `${state.score} m`;
      bestValue.textContent = `${Math.max(state.best, state.score)} m`;
      meterFill.style.transform = `scaleY(${Math.max(0.04, state.boost)})`;
      const active = Object.entries(state.activePowerups)
        .filter(([, seconds]) => seconds > 0)
        .map(([type, seconds]) => {
          const meta = POWERUP_META[type];
          return `<span style="--powerup-color: ${meta.color}"><b>${meta.label}</b>${Math.ceil(seconds)}s</span>`;
        });
      powerupStrip.hidden = active.length === 0;
      powerupStrip.innerHTML = active.join("");
      bonusToast.hidden = state.bonusFlash <= 0;
      bonusToast.textContent = state.bonusText;
      bonusToast.style.opacity = String(clamp(state.bonusFlash, 0, 1));
      hint.hidden = !(state.mode === "running" && state.showHintFor > 0);
    },
    dispose() {
      overlay.removeEventListener("click", startClick);
      pauseButton.removeEventListener("click", pauseClick);
      controlsButton.removeEventListener("click", controlsClick);
      resetKeybinds.removeEventListener("click", resetClick);
      for (const button of keybindButtons) button.removeEventListener("click", keybindClick);
      window.removeEventListener("keydown", remapKeyDown, true);
      startHandlers.clear();
      pauseHandlers.clear();
      resumeHandlers.clear();
      bindingHandlers.clear();
    },
  };
}

function formatKey(code) {
  const labels = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Space: "Space",
    Escape: "Esc",
  };
  if (labels[code]) return labels[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code.replace(/^Numpad/, "Num ");
}

function createAudioController(sdk) {
  let audioHandle = null;
  let context = null;
  let engine = null;
  let engineGain = null;
  let lastDraft = 0;

  return {
    async unlock() {
      try {
        audioHandle ||= await sdk.audio.getContext();
        await audioHandle.unlock();
        context = audioHandle.context;
      } catch {
        context = null;
      }
    },
    startEngine() {
      if (!context || engine) return;
      engine = context.createOscillator();
      engine.type = "sawtooth";
      engine.frequency.value = 72;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 280;
      engineGain = context.createGain();
      engineGain.gain.value = 0.0001;
      engine.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(context.destination);
      engine.start();
    },
    updateEngine(speed, running) {
      if (!context || !engine || !engineGain) return;
      const now = context.currentTime;
      engine.frequency.setTargetAtTime(55 + speed * 0.13, now, 0.045);
      engineGain.gain.setTargetAtTime(running ? 0.028 : 0.0001, now, 0.08);
    },
    draftPing() {
      if (!context || context.currentTime - lastDraft < 0.42) return;
      lastDraft = context.currentTime;
      tone(context, 520, 0.05, 0.018, "sine");
      tone(context, 780, 0.08, 0.012, "triangle");
    },
    crash() {
      if (!context) return;
      tone(context, 90, 0.24, 0.065, "sawtooth");
      tone(context, 48, 0.34, 0.09, "square");
      if (engineGain) engineGain.gain.setTargetAtTime(0.0001, context.currentTime, 0.035);
    },
    dispose() {
      if (engine) {
        engine.stop();
        engine.disconnect();
      }
      engine = null;
      engineGain = null;
      audioHandle?.dispose?.();
    },
  };
}

function tone(context, frequency, duration, volume, type) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.value = volume;
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

function drawLoadingFrame(ctx, viewport) {
  const gradient = ctx.createLinearGradient(0, 0, 0, viewport.height);
  gradient.addColorStop(0, "#082a33");
  gradient.addColorStop(1, "#160d1c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  ctx.strokeStyle = "rgba(83, 238, 255, 0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(viewport.width * 0.25, viewport.height);
  ctx.quadraticCurveTo(viewport.width * 0.52, viewport.height * 0.55, viewport.width * 0.42, 0);
  ctx.moveTo(viewport.width * 0.75, viewport.height);
  ctx.quadraticCurveTo(viewport.width * 0.52, viewport.height * 0.55, viewport.width * 0.58, 0);
  ctx.stroke();
}
