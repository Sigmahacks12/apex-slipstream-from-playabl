const SAVE_STORAGE = "apexPixel.save.v1";
const LEADERBOARD_STORAGE = "apexPixel.leaderboard.v1";
const SETTINGS_STORAGE = "apexPixel.settings.v1";
const ANALYTICS_STORAGE = "apexPixel.analytics.v1";

const WORLD = { width: 426, height: 240 };
const GRAVITY = 880;
const FLAP_VELOCITY = -285;
const DIVE_VELOCITY = 210;
const PLAYER_X = 82;
const PLAYER_W = 22;
const PLAYER_H = 14;
const GATE_W = 28;
const START_SPEED = 118;
const MAX_SPEED = 218;
const POWERUP_TYPES = ["shield", "double", "turbo"];

const DIFFICULTIES = {
  rookie: { label: "Rookie", gap: 88, speed: 0.86, score: 0.9 },
  pro: { label: "Pro", gap: 76, speed: 1, score: 1 },
  apex: { label: "Apex", gap: 64, speed: 1.14, score: 1.25 },
};

const SKINS = {
  cyan: { label: "Cyan", body: "#2ee8ff", dark: "#0f6c87", glass: "#eaffff", flame: "#ffdd55" },
  cherry: { label: "Cherry", body: "#ff4f6d", dark: "#8b1d37", glass: "#ffdce5", flame: "#ffe66d" },
  lime: { label: "Lime", body: "#7dff72", dark: "#278a3e", glass: "#eeffee", flame: "#ff9b54" },
  gold: { label: "Gold", body: "#ffd84a", dark: "#a46f12", glass: "#fff7c2", flame: "#ff633f" },
};

const WORLDS = {
  meadow: {
    label: "Meadow",
    sky: "#8bd9ff",
    cloud: "#f6fbff",
    ground: "#68c35a",
    groundDark: "#379245",
    road: "#5a5f68",
    roadDark: "#333941",
    pipe: "#42c75a",
    pipeDark: "#238a3f",
    coin: "#ffd84a",
  },
  dusk: {
    label: "Dusk",
    sky: "#7758c9",
    cloud: "#ffd8a6",
    ground: "#e27b45",
    groundDark: "#914632",
    road: "#494553",
    roadDark: "#2b2838",
    pipe: "#ff9f43",
    pipeDark: "#b8532a",
    coin: "#ffdf6f",
  },
  metro: {
    label: "Metro",
    sky: "#16283f",
    cloud: "#5be7ff",
    ground: "#2ec7a7",
    groundDark: "#12645a",
    road: "#3c4352",
    roadDark: "#202737",
    pipe: "#45e0ff",
    pipeDark: "#1682a0",
    coin: "#fff06a",
  },
};

const DEFAULT_SETTINGS = {
  difficulty: "pro",
  skin: "cyan",
  world: "meadow",
  muted: false,
  keyFlap: "Space",
  keyDive: "ArrowDown",
  keyPause: "Escape",
};

export function createGame({ mount, sdk }) {
  let cleanup = () => {};

  return {
    start() {
      const shell = document.createElement("section");
      shell.className = "apex-shell pixel-shell";

      const canvas = document.createElement("canvas");
      canvas.className = "game-surface apex-canvas pixel-canvas";
      shell.append(canvas);

      const hud = createHud(shell);
      mount.replaceChildren(shell);

      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.imageSmoothingEnabled = false;
      const state = createState();
      const controls = createControls(canvas, hud.touchButtons, state.settings, {
        flap: () => flap(state),
        dive: () => dive(state),
        pause: () => togglePause(state, hud),
      });
      const audio = createAudio(sdk);

      let disposed = false;
      let frameId = 0;
      let lastTime = performance.now();
      let resultSaved = false;

      function resize() {
        const rect = shell.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        ctx.imageSmoothingEnabled = false;
      }

      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(shell);
      resize();

      hud.setState(state);
      hud.showMenu(state);
      track("loads");

      hud.onStart(async () => {
        resultSaved = false;
        resetRun(state);
        state.mode = "running";
        hud.hideOverlay();
        hud.setState(state);
        track("starts");
        await audio.unlock();
        audio.start();
        flap(state);
      });

      hud.onResume(() => {
        if (state.mode !== "paused") return;
        state.mode = "running";
        hud.hideOverlay();
      });

      hud.onShare(() => shareGame(state));

      hud.onSettings((next) => {
        state.settings = normalizeSettings({ ...state.settings, ...next });
        saveSettings(state.settings);
        controls.setSettings(state.settings);
        audio.setMuted(state.settings.muted);
        hud.setState(state);
        if (state.mode !== "running") hud.showMenu(state);
      });

      function loop(now) {
        if (disposed) return;
        const dt = Math.min(0.033, Math.max(0, (now - lastTime) / 1000));
        lastTime = now;

        update(state, dt, audio);
        render(ctx, state, canvas.width, canvas.height);
        hud.update(state);

        if (state.mode === "crashed" && !resultSaved) {
          resultSaved = true;
          finishRun(state, sdk).then(() => hud.showResult(state)).catch(() => hud.showResult(state));
        }

        frameId = requestAnimationFrame(loop);
      }

      frameId = requestAnimationFrame(loop);

      cleanup = () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
        controls.dispose();
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

function createState() {
  const save = readSave();
  const settings = readSettings();
  return {
    mode: "menu",
    settings,
    best: Math.max(save.best || 0, readLeaderboard()[0]?.score || 0),
    leaderboard: readLeaderboard(),
    score: 0,
    scoreFloat: 0,
    distance: 0,
    speed: START_SPEED,
    time: 0,
    shake: 0,
    message: "",
    combo: 0,
    stats: { gates: 0, coins: 0, closeCalls: 0, powerups: 0, topSpeed: 0, seconds: 0 },
    player: { x: PLAYER_X, y: WORLD.height * 0.48, vy: 0, rot: 0, invuln: 0 },
    gates: [],
    coins: [],
    powerups: [],
    particles: [],
    active: { shield: 0, double: 0, turbo: 0 },
    nextGate: WORLD.width + 80,
    nextCloud: 30,
    clouds: makeClouds(),
    groundScroll: 0,
  };
}

function resetRun(state) {
  state.score = 0;
  state.scoreFloat = 0;
  state.distance = 0;
  state.speed = START_SPEED;
  state.time = 0;
  state.shake = 0;
  state.message = "";
  state.combo = 0;
  state.stats = { gates: 0, coins: 0, closeCalls: 0, powerups: 0, topSpeed: 0, seconds: 0 };
  state.player = { x: PLAYER_X, y: WORLD.height * 0.48, vy: 0, rot: 0, invuln: 0 };
  state.gates = [];
  state.coins = [];
  state.powerups = [];
  state.particles = [];
  state.active = { shield: 0, double: 0, turbo: 0 };
  state.nextGate = WORLD.width + 78;
  state.clouds = makeClouds();
  state.groundScroll = 0;
}

function update(state, dt, audio) {
  state.time += dt;
  updateParticles(state, dt);
  updateClouds(state, dt);
  if (state.mode !== "running") return;

  const difficulty = DIFFICULTIES[state.settings.difficulty] || DIFFICULTIES.pro;
  const turbo = state.active.turbo > 0 ? 1.28 : 1;
  state.speed = Math.min(MAX_SPEED, (START_SPEED + state.distance * 0.018) * difficulty.speed * turbo);
  state.stats.topSpeed = Math.max(state.stats.topSpeed, state.speed);
  state.stats.seconds += dt;
  state.distance += state.speed * dt;
  state.groundScroll = (state.groundScroll + state.speed * dt) % 32;

  for (const key of Object.keys(state.active)) state.active[key] = Math.max(0, state.active[key] - dt);
  state.player.invuln = Math.max(0, state.player.invuln - dt);
  state.shake = Math.max(0, state.shake - dt * 18);

  state.player.vy += GRAVITY * dt;
  state.player.y += state.player.vy * dt;
  state.player.rot = clamp(state.player.vy / 420, -0.42, 0.72);

  spawnGates(state, difficulty);
  updateGates(state, dt, audio);
  updateCoins(state, dt, audio);
  updatePowerups(state, dt, audio);

  const multiplier = (state.active.double > 0 ? 2 : 1) * difficulty.score;
  state.scoreFloat += dt * 7 * multiplier;
  state.score = Math.max(state.score, Math.floor(state.scoreFloat));

  if (state.player.y < 11 || state.player.y + PLAYER_H > WORLD.height - 22) {
    if (useShield(state, audio)) {
      state.player.y = clamp(state.player.y, 18, WORLD.height - 42);
      state.player.vy = FLAP_VELOCITY * 0.55;
    } else {
      crash(state, "Track edge", audio);
    }
  }
}

function spawnGates(state, difficulty) {
  const spacing = clamp(138 - state.distance * 0.006, 104, 138);
  while (state.nextGate < WORLD.width + 70) {
    const gap = difficulty.gap;
    const centerMin = 54;
    const centerMax = WORLD.height - 54;
    const wave = Math.sin((state.distance + state.nextGate) * 0.018) * 26;
    const center = clamp(WORLD.height * 0.5 + wave + (Math.random() - 0.5) * 52, centerMin, centerMax);
    const gate = {
      x: state.nextGate,
      gapTop: center - gap / 2,
      gapBottom: center + gap / 2,
      passed: false,
      closeScored: false,
    };
    state.gates.push(gate);

    if (Math.random() < 0.74) {
      state.coins.push({ x: gate.x + GATE_W + 32, y: center + (Math.random() - 0.5) * gap * 0.36, taken: false });
    }
    if (Math.random() < 0.25) {
      state.powerups.push({
        x: gate.x + GATE_W + 62,
        y: center + (Math.random() - 0.5) * gap * 0.42,
        type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)],
        taken: false,
      });
    }
    state.nextGate += spacing;
  }
}

function updateGates(state, dt, audio) {
  const move = state.speed * dt;
  for (const gate of state.gates) {
    gate.x -= move;
    const passedLine = gate.x + GATE_W < state.player.x;
    if (passedLine && !gate.passed) {
      gate.passed = true;
      state.stats.gates += 1;
      award(state, 45, "GATE");
      audio.blip();
    }

    if (hitsGate(state.player, gate)) {
      if (useShield(state, audio)) {
        gate.x = -999;
        award(state, 80, "SHIELD HIT");
        burst(state, state.player.x + 12, state.player.y + 6, "#8ff6ff", 18);
      } else {
        crash(state, "Traffic gate", audio);
      }
    } else if (!gate.closeScored && Math.abs(gate.x - state.player.x) < 9) {
      const clearance = Math.min(state.player.y - gate.gapTop, gate.gapBottom - (state.player.y + PLAYER_H));
      if (clearance > 0 && clearance < 10) {
        gate.closeScored = true;
        state.combo += 1;
        state.stats.closeCalls += 1;
        award(state, 65 + state.combo * 12, "CLOSE");
        burst(state, state.player.x, state.player.y, "#ffd84a", 8);
      }
    }
  }
  state.gates = state.gates.filter((gate) => gate.x > -GATE_W - 20);
  state.nextGate -= move;
}

function updateCoins(state, dt, audio) {
  const move = state.speed * dt;
  for (const coin of state.coins) {
    coin.x -= move;
    if (!coin.taken && intersects(state.player.x, state.player.y, PLAYER_W, PLAYER_H, coin.x - 5, coin.y - 5, 10, 10)) {
      coin.taken = true;
      state.stats.coins += 1;
      award(state, 25, "COIN");
      burst(state, coin.x, coin.y, "#ffd84a", 10);
      audio.coin();
    }
  }
  state.coins = state.coins.filter((coin) => !coin.taken && coin.x > -20);
}

function updatePowerups(state, dt, audio) {
  const move = state.speed * dt;
  for (const powerup of state.powerups) {
    powerup.x -= move;
    if (!powerup.taken && intersects(state.player.x, state.player.y, PLAYER_W, PLAYER_H, powerup.x - 7, powerup.y - 7, 14, 14)) {
      powerup.taken = true;
      state.stats.powerups += 1;
      if (powerup.type === "shield") state.active.shield = 8;
      if (powerup.type === "double") state.active.double = 8;
      if (powerup.type === "turbo") state.active.turbo = 6;
      award(state, 60, powerup.type.toUpperCase());
      burst(state, powerup.x, powerup.y, powerColor(powerup.type), 14);
      audio.power();
    }
  }
  state.powerups = state.powerups.filter((powerup) => !powerup.taken && powerup.x > -20);
}

function hitsGate(player, gate) {
  const carLeft = player.x + 2;
  const carTop = player.y + 2;
  const carW = PLAYER_W - 4;
  const carH = PLAYER_H - 4;
  const horizontal = carLeft + carW > gate.x && carLeft < gate.x + GATE_W;
  if (!horizontal) return false;
  return carTop < gate.gapTop || carTop + carH > gate.gapBottom;
}

function flap(state) {
  if (state.mode === "menu" || state.mode === "crashed") return;
  if (state.mode === "paused") return;
  state.player.vy = FLAP_VELOCITY;
  state.combo = Math.max(0, state.combo - 0.15);
  burst(state, state.player.x + 4, state.player.y + PLAYER_H, "#fff1a6", 3);
}

function dive(state) {
  if (state.mode !== "running") return;
  state.player.vy = Math.max(state.player.vy, DIVE_VELOCITY);
}

function togglePause(state, hud) {
  if (state.mode === "running") {
    state.mode = "paused";
    hud.showPause(state);
  } else if (state.mode === "paused") {
    state.mode = "running";
    hud.hideOverlay();
  }
}

function award(state, amount, label) {
  const difficulty = DIFFICULTIES[state.settings.difficulty] || DIFFICULTIES.pro;
  const multiplier = (state.active.double > 0 ? 2 : 1) * difficulty.score;
  const points = Math.round(amount * multiplier);
  state.scoreFloat += points;
  state.score = Math.max(state.score, Math.floor(state.scoreFloat));
  state.message = `+${points} ${label}`;
}

function useShield(state, audio) {
  if (state.active.shield <= 0 && state.player.invuln <= 0) return false;
  state.active.shield = 0;
  state.player.invuln = 1.2;
  state.shake = 7;
  audio.shield();
  return true;
}

function crash(state, reason, audio) {
  if (state.mode !== "running") return;
  state.mode = "crashed";
  state.message = reason;
  state.shake = 10;
  burst(state, state.player.x + 8, state.player.y + 7, "#ff5a3d", 28);
  audio.crash();
  track("finishes");
}

async function finishRun(state, sdk) {
  const score = Math.floor(state.score);
  state.best = Math.max(state.best, score);
  const row = {
    score,
    difficulty: state.settings.difficulty,
    gates: state.stats.gates,
    coins: state.stats.coins,
    closeCalls: state.stats.closeCalls,
    date: new Date().toISOString(),
  };
  state.leaderboard = normalizeLeaderboard([...state.leaderboard, row]);
  saveLeaderboard(state.leaderboard);
  try {
    await sdk.gameState.save({ version: 2, bestScore: state.best });
  } catch {
    saveLocal({ best: state.best });
  }
  try {
    await sdk.leaderboard.submit(score);
  } catch {
    // Static hosting and previews can play without hosted leaderboards.
  }
}

function render(ctx, state, canvasW, canvasH) {
  const scale = Math.max(1, Math.floor(Math.min(canvasW / WORLD.width, canvasH / WORLD.height)));
  const viewW = WORLD.width * scale;
  const viewH = WORLD.height * scale;
  const left = Math.floor((canvasW - viewW) / 2);
  const top = Math.floor((canvasH - viewH) / 2);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.translate(left, top);
  ctx.scale(scale, scale);
  if (state.shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * state.shake), Math.round((Math.random() - 0.5) * state.shake));

  const world = WORLDS[state.settings.world] || WORLDS.meadow;
  drawSky(ctx, state, world);
  drawClouds(ctx, state, world);
  drawRoad(ctx, state, world);
  drawGates(ctx, state, world);
  drawCoins(ctx, state, world);
  drawPowerups(ctx, state);
  drawPlayer(ctx, state);
  drawParticles(ctx, state);
  drawScanlines(ctx);
  ctx.restore();
}

function drawSky(ctx, state, world) {
  ctx.fillStyle = world.sky;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  const band = state.settings.world === "metro" ? "#243c5f" : "#ffffff22";
  ctx.fillStyle = band;
  for (let y = 24; y < 132; y += 26) ctx.fillRect(0, y, WORLD.width, 2);
}

function drawClouds(ctx, state, world) {
  ctx.fillStyle = world.cloud;
  for (const cloud of state.clouds) {
    pixelRect(ctx, cloud.x, cloud.y, 18, 8);
    pixelRect(ctx, cloud.x + 8, cloud.y - 5, 18, 13);
    pixelRect(ctx, cloud.x + 23, cloud.y + 1, 20, 7);
  }
}

function drawRoad(ctx, state, world) {
  ctx.fillStyle = world.ground;
  ctx.fillRect(0, WORLD.height - 22, WORLD.width, 22);
  ctx.fillStyle = world.groundDark;
  for (let x = -32 - state.groundScroll; x < WORLD.width + 32; x += 32) {
    ctx.fillRect(Math.round(x), WORLD.height - 11, 17, 3);
  }
  ctx.fillStyle = world.road;
  ctx.fillRect(0, WORLD.height - 39, WORLD.width, 17);
  ctx.fillStyle = world.roadDark;
  ctx.fillRect(0, WORLD.height - 25, WORLD.width, 3);
  ctx.fillStyle = "#f8f0d8";
  for (let x = -32 - state.groundScroll * 1.6; x < WORLD.width + 32; x += 42) {
    ctx.fillRect(Math.round(x), WORLD.height - 32, 18, 2);
  }
}

function drawGates(ctx, state, world) {
  for (const gate of state.gates) {
    const x = Math.round(gate.x);
    drawPipe(ctx, x, 0, GATE_W, Math.floor(gate.gapTop), world);
    drawPipe(ctx, x, Math.ceil(gate.gapBottom), GATE_W, WORLD.height - 39 - Math.ceil(gate.gapBottom), world);
  }
}

function drawPipe(ctx, x, y, w, h, world) {
  if (h <= 0) return;
  ctx.fillStyle = world.pipeDark;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = world.pipe;
  ctx.fillRect(x + 3, y, w - 6, h);
  ctx.fillStyle = "#ffffff55";
  ctx.fillRect(x + 6, y + 4, 3, Math.max(0, h - 8));
  const capY = y === 0 ? h - 8 : y;
  ctx.fillStyle = world.pipeDark;
  ctx.fillRect(x - 4, capY, w + 8, 8);
  ctx.fillStyle = world.pipe;
  ctx.fillRect(x - 1, capY + 2, w + 2, 4);
}

function drawCoins(ctx, state, world) {
  for (const coin of state.coins) {
    const x = Math.round(coin.x);
    const y = Math.round(coin.y + Math.sin(state.time * 8 + coin.x) * 2);
    ctx.fillStyle = world.coin;
    ctx.fillRect(x - 4, y - 5, 8, 10);
    ctx.fillStyle = "#fff7ab";
    ctx.fillRect(x - 1, y - 3, 2, 6);
  }
}

function drawPowerups(ctx, state) {
  for (const powerup of state.powerups) {
    const x = Math.round(powerup.x);
    const y = Math.round(powerup.y);
    ctx.fillStyle = powerColor(powerup.type);
    ctx.fillRect(x - 7, y - 7, 14, 14);
    ctx.fillStyle = "#151515";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(powerLabel(powerup.type), x, y + 1);
  }
}

function drawPlayer(ctx, state) {
  const skin = SKINS[state.settings.skin] || SKINS.cyan;
  const p = state.player;
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  ctx.save();
  ctx.translate(x + PLAYER_W / 2, y + PLAYER_H / 2);
  ctx.rotate(p.rot);
  if (state.active.shield > 0 || p.invuln > 0) {
    ctx.fillStyle = state.time % 0.18 < 0.09 ? "#ffffff" : "#8ff6ff";
    ctx.fillRect(-16, -11, 32, 2);
    ctx.fillRect(-16, 9, 32, 2);
    ctx.fillRect(-18, -9, 2, 18);
    ctx.fillRect(16, -9, 2, 18);
  }
  ctx.fillStyle = skin.dark;
  ctx.fillRect(-10, -5, 20, 10);
  ctx.fillStyle = skin.body;
  ctx.fillRect(-8, -7, 15, 13);
  ctx.fillRect(2, -4, 10, 8);
  ctx.fillStyle = skin.glass;
  ctx.fillRect(-2, -5, 5, 5);
  ctx.fillStyle = "#151515";
  ctx.fillRect(-8, 5, 4, 3);
  ctx.fillRect(5, 5, 4, 3);
  ctx.fillStyle = skin.flame;
  const flame = state.time % 0.12 < 0.06 ? 8 : 5;
  ctx.fillRect(-18, -2, flame, 4);
  ctx.restore();
}

function drawParticles(ctx, state) {
  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawScanlines(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  for (let y = 0; y < WORLD.height; y += 4) ctx.fillRect(0, y, WORLD.width, 1);
}

function pixelRect(ctx, x, y, w, h) {
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function updateClouds(state, dt) {
  for (const cloud of state.clouds) {
    cloud.x -= cloud.speed * dt;
    if (cloud.x < -60) {
      cloud.x = WORLD.width + Math.random() * 80;
      cloud.y = 22 + Math.random() * 74;
      cloud.speed = 10 + Math.random() * 24;
    }
  }
}

function makeClouds() {
  return Array.from({ length: 7 }, (_, index) => ({
    x: index * 72 + Math.random() * 30,
    y: 18 + Math.random() * 90,
    speed: 10 + Math.random() * 24,
  }));
}

function updateParticles(state, dt) {
  for (const p of state.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 180 * dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
}

function burst(state, x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 30 + Math.random() * 120;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size: 2 + Math.floor(Math.random() * 3),
      life: 0.25 + Math.random() * 0.42,
      maxLife: 0.7,
    });
  }
}

function createHud(shell) {
  const hud = document.createElement("div");
  hud.className = "race-hud pixel-hud";
  hud.innerHTML = `
    <div class="pixel-score"><span>score</span><strong>0</strong></div>
    <div class="pixel-best"><span>best</span><strong>0</strong></div>
    <div class="pixel-tools">
      <button class="pixel-icon pause-button" type="button" aria-label="Pause">II</button>
      <button class="pixel-icon settings-button" type="button" aria-label="Settings">⚙</button>
      <button class="pixel-icon mute-button" type="button" aria-label="Mute">♪</button>
    </div>
    <div class="pixel-powerups"></div>
    <div class="pixel-toast" hidden></div>
    <div class="pixel-touch">
      <button class="pixel-touch-button flap-touch" type="button">TAP</button>
      <button class="pixel-touch-button dive-touch" type="button">DROP</button>
    </div>
    <div class="pixel-settings" hidden>
      <div class="pixel-setting-title">Settings</div>
      <div class="pixel-row" data-setting="difficulty">
        ${Object.entries(DIFFICULTIES).map(([id, item]) => `<button type="button" data-value="${id}">${item.label}</button>`).join("")}
      </div>
      <div class="pixel-row" data-setting="skin">
        ${Object.entries(SKINS).map(([id, item]) => `<button type="button" data-value="${id}">${item.label}</button>`).join("")}
      </div>
      <div class="pixel-row" data-setting="world">
        ${Object.entries(WORLDS).map(([id, item]) => `<button type="button" data-value="${id}">${item.label}</button>`).join("")}
      </div>
    </div>
  `;

  const overlay = document.createElement("div");
  overlay.className = "pixel-overlay";
  overlay.innerHTML = `
    <div class="pixel-card">
      <div class="pixel-kicker">PIXEL ARCADE RACER</div>
      <h1>Apex Slipstream</h1>
      <p class="pixel-copy">Tap to rise. Drop to dive. Thread the traffic gates.</p>
      <div class="pixel-actions">
        <button class="play-button" type="button">PLAY</button>
        <button class="share-button" type="button">SHARE</button>
      </div>
      <div class="pixel-help">Space / click / tap = flap · Down = drop · Esc = pause</div>
      <ol class="pixel-leaderboard"></ol>
    </div>
  `;
  shell.append(hud, overlay);

  const score = hud.querySelector(".pixel-score strong");
  const best = hud.querySelector(".pixel-best strong");
  const pauseButton = hud.querySelector(".pause-button");
  const settingsButton = hud.querySelector(".settings-button");
  const muteButton = hud.querySelector(".mute-button");
  const settingsPanel = hud.querySelector(".pixel-settings");
  const rows = [...hud.querySelectorAll(".pixel-row")];
  const powerups = hud.querySelector(".pixel-powerups");
  const toast = hud.querySelector(".pixel-toast");
  const playButton = overlay.querySelector(".play-button");
  const shareButton = overlay.querySelector(".share-button");
  const copy = overlay.querySelector(".pixel-copy");
  const leaderboard = overlay.querySelector(".pixel-leaderboard");

  const startHandlers = new Set();
  const resumeHandlers = new Set();
  const shareHandlers = new Set();
  const settingsHandlers = new Set();
  let lastMessage = "";

  pauseButton.addEventListener("click", () => {
    if (overlay.dataset.mode === "paused") {
      for (const handler of resumeHandlers) handler();
    } else {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: readSettings().keyPause }));
    }
  });
  settingsButton.addEventListener("click", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
  });
  muteButton.addEventListener("click", () => {
    const settings = readSettings();
    for (const handler of settingsHandlers) handler({ muted: !settings.muted });
  });
  playButton.addEventListener("click", () => {
    if (overlay.dataset.mode === "paused") {
      for (const handler of resumeHandlers) handler();
    } else {
      for (const handler of startHandlers) handler();
    }
  });
  shareButton.addEventListener("click", () => {
    for (const handler of shareHandlers) handler();
  });
  for (const row of rows) {
    row.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      for (const handler of settingsHandlers) handler({ [row.dataset.setting]: button.dataset.value });
    });
  }

  return {
    touchButtons: {
      flap: hud.querySelector(".flap-touch"),
      dive: hud.querySelector(".dive-touch"),
    },
    onStart(handler) {
      startHandlers.add(handler);
    },
    onResume(handler) {
      resumeHandlers.add(handler);
    },
    onShare(handler) {
      shareHandlers.add(handler);
    },
    onSettings(handler) {
      settingsHandlers.add(handler);
    },
    setState(state) {
      refreshSettings(state.settings);
      muteButton.textContent = state.settings.muted ? "×" : "♪";
      best.textContent = String(Math.max(state.best, state.score));
    },
    showMenu(state) {
      overlay.hidden = false;
      overlay.dataset.mode = "menu";
      playButton.textContent = "PLAY";
      copy.textContent = state.best > 0 ? `Best ${state.best}. Beat your pixel run.` : "Tap to rise. Drop to dive. Thread the traffic gates.";
      refreshLeaderboard(state.leaderboard);
    },
    showPause(state) {
      overlay.hidden = false;
      overlay.dataset.mode = "paused";
      playButton.textContent = "RESUME";
      copy.textContent = `Paused at ${state.score}.`;
      refreshLeaderboard(state.leaderboard);
    },
    showResult(state) {
      overlay.hidden = false;
      overlay.dataset.mode = "result";
      playButton.textContent = "RETRY";
      copy.textContent = `${state.message}. Score ${state.score}. ${state.stats.gates} gates, ${state.stats.coins} coins, ${state.stats.closeCalls} close calls.`;
      refreshLeaderboard(state.leaderboard);
    },
    hideOverlay() {
      overlay.hidden = true;
      overlay.dataset.mode = "";
      settingsPanel.hidden = true;
    },
    update(state) {
      score.textContent = String(state.score);
      best.textContent = String(Math.max(state.best, state.score));
      const active = Object.entries(state.active)
        .filter(([, seconds]) => seconds > 0)
        .map(([key, seconds]) => `<span>${powerLabel(key)} ${Math.ceil(seconds)}</span>`);
      powerups.innerHTML = active.join("");
      powerups.hidden = active.length === 0;
      toast.hidden = !state.message;
      if (state.message && state.message !== lastMessage) {
        lastMessage = state.message;
        toast.animate([{ transform: "translate(-50%, -10px)" }, { transform: "translate(-50%, 0)" }], { duration: 140 });
      }
      toast.textContent = state.message;
    },
    dispose() {
      startHandlers.clear();
      resumeHandlers.clear();
      shareHandlers.clear();
      settingsHandlers.clear();
    },
  };

  function refreshSettings(settings) {
    for (const row of rows) {
      for (const button of row.querySelectorAll("button")) {
        button.classList.toggle("is-selected", settings[row.dataset.setting] === button.dataset.value);
      }
    }
  }

  function refreshLeaderboard(rows) {
    leaderboard.innerHTML = normalizeLeaderboard(rows)
      .map((row, index) => `<li><b>${index + 1}. ${row.score}</b><span>${DIFFICULTIES[row.difficulty]?.label || "Pro"} · ${row.gates} gates</span></li>`)
      .join("");
  }
}

function createControls(canvas, touchButtons, settings, actions) {
  let current = normalizeSettings(settings);
  const downKeys = new Set();

  function onPointerDown(event) {
    actions.flap();
    event.preventDefault();
  }
  function onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === current.keyFlap || event.code === "ArrowUp") {
      downKeys.add(event.code);
      actions.flap();
      event.preventDefault();
    }
    if (event.code === current.keyDive) {
      actions.dive();
      event.preventDefault();
    }
    if (event.code === current.keyPause) {
      actions.pause();
      event.preventDefault();
    }
  }
  function onKeyUp(event) {
    downKeys.delete(event.code);
  }
  function touchAction(action) {
    return (event) => {
      action();
      event.preventDefault();
    };
  }

  const flapTouch = touchAction(actions.flap);
  const diveTouch = touchAction(actions.dive);
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  touchButtons.flap.addEventListener("pointerdown", flapTouch);
  touchButtons.dive.addEventListener("pointerdown", diveTouch);

  return {
    setSettings(next) {
      current = normalizeSettings(next);
      downKeys.clear();
    },
    dispose() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      touchButtons.flap.removeEventListener("pointerdown", flapTouch);
      touchButtons.dive.removeEventListener("pointerdown", diveTouch);
    },
  };
}

function createAudio(sdk) {
  let handle = null;
  let context = null;
  let muted = readSettings().muted;

  return {
    async unlock() {
      try {
        handle ||= await sdk.audio.getContext();
        await handle.unlock();
        context = handle.context;
      } catch {
        context = null;
      }
    },
    start() {
      this.blip();
    },
    setMuted(value) {
      muted = Boolean(value);
    },
    blip() {
      beep(context, muted, 520, 0.05, 0.025, "square");
    },
    coin() {
      beep(context, muted, 820, 0.06, 0.03, "triangle");
    },
    power() {
      beep(context, muted, 330, 0.05, 0.03, "square");
      beep(context, muted, 660, 0.08, 0.025, "square");
    },
    shield() {
      beep(context, muted, 250, 0.08, 0.035, "triangle");
    },
    crash() {
      beep(context, muted, 86, 0.22, 0.07, "sawtooth");
      beep(context, muted, 48, 0.32, 0.08, "square");
    },
    dispose() {
      handle?.dispose?.();
    },
  };
}

function beep(context, muted, frequency, duration, volume, type) {
  if (muted || !context) return;
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

async function shareGame(state) {
  const score = Math.max(state.score, state.best);
  const text = score > 0
    ? `I scored ${score} in the pixel version of Apex Slipstream.`
    : "Play the pixel arcade version of Apex Slipstream.";
  const data = { title: "Apex Slipstream", text, url: window.location.href };
  try {
    if (navigator.share) {
      await navigator.share(data);
    } else {
      await navigator.clipboard.writeText(`${text} ${window.location.href}`);
    }
    track("shares");
  } catch {
    window.prompt("Share Apex Slipstream", `${text} ${window.location.href}`);
  }
}

function readSave() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SAVE_STORAGE) || window.localStorage.getItem("apexSlipstream.save.v1") || "{}");
    return { best: Math.max(0, Math.floor(raw.bestScore || raw.best || 0)) };
  } catch {
    return { best: 0 };
  }
}

function saveLocal(value) {
  try {
    window.localStorage.setItem(SAVE_STORAGE, JSON.stringify(value));
  } catch {
    // Play can continue without storage.
  }
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE) || "{}"));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(normalizeSettings(settings)));
  } catch {
    // Settings remain active for the current session.
  }
}

function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    difficulty: DIFFICULTIES[settings?.difficulty] ? settings.difficulty : DEFAULT_SETTINGS.difficulty,
    skin: SKINS[settings?.skin] ? settings.skin : DEFAULT_SETTINGS.skin,
    world: WORLDS[settings?.world] ? settings.world : DEFAULT_SETTINGS.world,
    muted: Boolean(settings?.muted),
  };
}

function readLeaderboard() {
  try {
    return normalizeLeaderboard(JSON.parse(window.localStorage.getItem(LEADERBOARD_STORAGE) || "[]"));
  } catch {
    return [];
  }
}

function saveLeaderboard(rows) {
  try {
    window.localStorage.setItem(LEADERBOARD_STORAGE, JSON.stringify(normalizeLeaderboard(rows)));
  } catch {
    // Optional.
  }
}

function normalizeLeaderboard(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => Number.isFinite(row?.score))
    .map((row) => ({
      score: Math.max(0, Math.floor(row.score)),
      difficulty: DIFFICULTIES[row.difficulty] ? row.difficulty : "pro",
      gates: Math.max(0, Math.floor(row.gates || 0)),
      coins: Math.max(0, Math.floor(row.coins || 0)),
      closeCalls: Math.max(0, Math.floor(row.closeCalls || row.closeMisses || 0)),
      date: typeof row.date === "string" ? row.date : new Date().toISOString(),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function track(name) {
  try {
    const analytics = JSON.parse(window.localStorage.getItem(ANALYTICS_STORAGE) || "{}");
    analytics[name] = Math.max(0, Number(analytics[name]) || 0) + 1;
    analytics.updatedAt = new Date().toISOString();
    window.localStorage.setItem(ANALYTICS_STORAGE, JSON.stringify(analytics));
  } catch {
    // Optional.
  }
}

function powerColor(type) {
  if (type === "shield") return "#8ff6ff";
  if (type === "double") return "#ffd84a";
  return "#ff6b35";
}

function powerLabel(type) {
  if (type === "shield") return "S";
  if (type === "double") return "2X";
  return "T";
}

function intersects(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
