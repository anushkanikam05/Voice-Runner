/* ============================================================
   VOICE RUNNER — NOISE CHAOS
   Pure HTML/CSS/JS. Web Audio API + Web Speech API.
   ============================================================ */

(() => {
  // ---------- Canvas setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = Math.max(1, window.devicePixelRatio || 1);

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // ---------- DOM refs ----------
  const startScreen = document.getElementById('startScreen');
  const gameOverScreen = document.getElementById('gameOverScreen');
  const startBtn = document.getElementById('startBtn');
  const restartBtn = document.getElementById('restartBtn');
  const micBar = document.getElementById('micBar');
  const energyBar = document.getElementById('energyBar');
  const scoreDisplay = document.getElementById('scoreDisplay');
  const voiceTag = document.getElementById('voiceTag');
  const finalScore = document.getElementById('finalScore');
  const bestScoreEl = document.getElementById('bestScore');
  const bgm = document.getElementById('bgm');

  // ---------- Game state ----------
  const state = {
    running: false,
    over: false,
    score: 0,
    best: parseInt(localStorage.getItem('vr_best') || '0', 10),
    speed: 5,
    baseSpeed: 5,
    speedTimer: 0,        // boost timer (seconds)
    slowTimer: 0,         // slow-mo timer
    energy: 100,
    micLevel: 0,          // smoothed 0..1
    micPeak: 0,           // raw current 0..1
    noiseFloor: 0.02,
    glitchTimer: 0,
    invertTimer: 0,
    spawnTimer: 0,
    lastTime: 0,
  };

  // ---------- Player ----------
  const player = {
    x: 0, y: 0,
    w: 36, h: 48,
    vy: 0,
    onGround: true,
    color: '#00f0ff',
    trail: [],
  };
  const GRAVITY = 1800; // px/s^2
  const JUMP_VY = -700;
  const GROUND_Y_OFFSET = 80; // distance from bottom

  // ---------- Obstacles ----------
  const obstacles = [];
  function groundY() { return H - GROUND_Y_OFFSET; }
  function resetPlayer() {
    player.x = Math.max(80, W * 0.18);
    player.y = groundY() - player.h;
    player.vy = 0;
    player.onGround = true;
    player.trail = [];
  }

  function spawnObstacle() {
    const types = ['block', 'tall', 'low', 'spike'];
    const t = types[Math.floor(Math.random() * types.length)];
    let w = 28, h = 40, yOff = 0;
    if (t === 'tall') { w = 28; h = 70; }
    if (t === 'low')  { w = 50; h = 22; }
    if (t === 'spike'){ w = 30; h = 30; }
    obstacles.push({
      type: t,
      x: W + 40,
      y: groundY() - h - yOff,
      w, h,
      passed: false,
    });
  }

  // ---------- Particles (background) ----------
  const stars = [];
  for (let i = 0; i < 80; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H * 0.7,
      z: Math.random() * 0.8 + 0.2,
      r: Math.random() * 1.5 + 0.3,
    });
  }

  // ---------- Input: keyboard ----------
  const keys = {};
  window.addEventListener('keydown', (e) => {
    if (['Space','ShiftLeft','ShiftRight','KeyS'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'Space') triggerJump();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') triggerBoost(1.2);
    if (e.code === 'KeyS') triggerSlow(1.2);
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // ---------- Input: touch (mobile) ----------
  let touchStartX = 0, touchStartTime = 0, holdTimer = null, isHolding = false;
  canvas.addEventListener('touchstart', (e) => {
    if (!state.running) return;
    e.preventDefault();
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartTime = performance.now();
    isHolding = false;
    holdTimer = setTimeout(() => {
      isHolding = true;
      triggerSlow(1.5);
    }, 300);
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!state.running) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartX;
    if (dx > 60 && !isHolding) {
      clearTimeout(holdTimer);
      triggerBoost(1.5);
      touchStartX = t.clientX;
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (!state.running) return;
    e.preventDefault();
    clearTimeout(holdTimer);
    const dt = performance.now() - touchStartTime;
    if (!isHolding && dt < 250) triggerJump();
    isHolding = false;
  }, { passive: false });

  // ---------- Game actions ----------
  function triggerJump() {
    if (!state.running || state.over) return;
    if (player.onGround && state.energy > 5) {
      player.vy = JUMP_VY * (0.6 + 0.4 * (state.energy / 100));
      player.onGround = false;
      flashVoiceTag('JUMP');
    }
  }
  function triggerBoost(seconds = 1.5) {
    if (!state.running || state.over) return;
    state.speedTimer = Math.max(state.speedTimer, seconds);
    state.slowTimer = 0;
    flashVoiceTag('BOOST');
  }
  function triggerSlow(seconds = 1.5) {
    if (!state.running || state.over) return;
    state.slowTimer = Math.max(state.slowTimer, seconds);
    state.speedTimer = 0;
    flashVoiceTag('SLOW');
  }

  let voiceTagTimeout = null;
  function flashVoiceTag(text) {
    voiceTag.textContent = text;
    voiceTag.classList.add('active');
    clearTimeout(voiceTagTimeout);
    voiceTagTimeout = setTimeout(() => {
      voiceTag.classList.remove('active');
      voiceTag.textContent = '—';
    }, 700);
  }

  // ---------- Audio: microphone ----------
  let audioCtx = null, analyser = null, micData = null, micStream = null;
  let micReady = false;

  async function initMic() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false }
      });
      const src = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser);
      micData = new Uint8Array(analyser.fftSize);
      micReady = true;
    } catch (err) {
      console.warn('Mic unavailable:', err);
      micReady = false;
    }
  }

  function readMicLevel() {
    if (!micReady) return 0;
    analyser.getByteTimeDomainData(micData);
    // RMS
    let sum = 0;
    for (let i = 0; i < micData.length; i++) {
      const v = (micData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / micData.length); // 0..1-ish
    return Math.min(1, rms * 2.2);
  }

  // ---------- Audio: speech recognition ----------
  let recognition = null;
  function initSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const text = e.results[i][0].transcript.toLowerCase();
          if (/\b(jump|up)\b/.test(text)) triggerJump();
          else if (/\b(go|fast|boost|run)\b/.test(text)) triggerBoost(1.5);
          else if (/\b(stop|slow|down)\b/.test(text)) triggerSlow(1.5);
        }
      };
      recognition.onerror = () => {};
      recognition.onend = () => {
        // Auto-restart while game is running
        if (state.running && !state.over) {
          try { recognition.start(); } catch(_) {}
        }
      };
      recognition.start();
    } catch (err) {
      console.warn('Speech recognition unavailable:', err);
    }
  }

  // ---------- Voice intensity → controls ----------
  // Thresholds relative to noise floor
  let lastJumpAt = 0, lastBoostAt = 0, lastSlowAt = 0;
  let sustainedLoudFrames = 0;

  function processVoice(now, dt) {
    const raw = readMicLevel();
    state.micPeak = raw;
    // Smooth for HUD
    state.micLevel = state.micLevel * 0.7 + raw * 0.3;

    micBar.style.width = (Math.min(1, state.micLevel * 1.4) * 100) + '%';

    // Adaptive noise floor (slow drift toward minimum)
    if (raw < state.noiseFloor + 0.01) {
      state.noiseFloor = state.noiseFloor * 0.995 + raw * 0.005;
    }
    const nf = Math.max(0.015, state.noiseFloor);

    // Energy: speaking drains, silence regenerates
    const speakingAmount = Math.max(0, raw - nf);
    if (speakingAmount > 0.04) {
      state.energy -= speakingAmount * 60 * dt;
    } else {
      state.energy += 18 * dt;
    }
    state.energy = Math.max(0, Math.min(100, state.energy));
    energyBar.style.width = state.energy + '%';

    // Responsiveness reduced at low energy
    const responsiveness = 0.4 + 0.6 * (state.energy / 100);

    // Voice → actions (with cooldowns)
    const veryLoud = 0.55, loud = 0.30, soft = 0.06;

    if (raw > veryLoud * (2 - responsiveness)) {
      sustainedLoudFrames++;
      if (now - lastBoostAt > 800) {
        triggerBoost(1.2);
        lastBoostAt = now;
      }
    } else if (raw > loud * (2 - responsiveness)) {
      if (now - lastJumpAt > 380 && player.onGround) {
        triggerJump();
        lastJumpAt = now;
      }
    } else if (raw > soft && raw < loud * 0.8) {
      // Soft sustained voice → slow motion
      if (now - lastSlowAt > 1200) {
        triggerSlow(0.8);
        lastSlowAt = now;
      }
    } else {
      sustainedLoudFrames = Math.max(0, sustainedLoudFrames - 1);
    }

    // Background noise chaos: sustained loud OR sudden spike → glitch effects
    if (sustainedLoudFrames > 30 || raw > 0.78) {
      if (Math.random() < 0.04) {
        triggerChaos();
      }
    }
  }

  function triggerChaos() {
    const r = Math.random();
    if (r < 0.4) {
      // Screen shake
      document.body.classList.remove('shake');
      void document.body.offsetWidth;
      document.body.classList.add('shake');
      setTimeout(() => document.body.classList.remove('shake'), 400);
    } else if (r < 0.7) {
      // Hue glitch
      document.body.classList.add('glitch-effect');
      state.glitchTimer = 0.4;
    } else if (r < 0.85) {
      // Invert
      document.body.classList.add('invert-effect');
      state.invertTimer = 0.25;
    } else {
      // Random temporary speed change
      if (Math.random() < 0.5) triggerBoost(0.6);
      else triggerSlow(0.6);
    }
  }

  // ---------- Game loop ----------
  function update(dt, now) {
    // Speed modifiers
    let curSpeed = state.baseSpeed + state.score * 0.0015;
    if (state.speedTimer > 0) { curSpeed *= 1.8; state.speedTimer -= dt; }
    if (state.slowTimer > 0)  { curSpeed *= 0.45; state.slowTimer -= dt; }
    state.speed = curSpeed;

    // Player physics
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt * 0.6;
    const gy = groundY() - player.h;
    if (player.y >= gy) {
      player.y = gy;
      player.vy = 0;
      player.onGround = true;
    }

    // Trail
    player.trail.push({ x: player.x + player.w/2, y: player.y + player.h/2, life: 1 });
    if (player.trail.length > 18) player.trail.shift();
    player.trail.forEach(p => p.life -= dt * 2);

    // Obstacles
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnObstacle();
      state.spawnTimer = 0.9 + Math.random() * 0.9 - Math.min(0.5, state.score * 0.0001);
    }
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.x -= state.speed * 60 * dt;
      if (!o.passed && o.x + o.w < player.x) {
        o.passed = true;
        state.score += 10;
      }
      // Collision (AABB with small inset)
      if (rectIntersect(player.x + 4, player.y + 4, player.w - 8, player.h - 8,
                         o.x, o.y, o.w, o.h)) {
        gameOver();
      }
      if (o.x + o.w < -20) obstacles.splice(i, 1);
    }

    // Stars
    for (const s of stars) {
      s.x -= state.speed * 12 * s.z * dt;
      if (s.x < 0) { s.x = W; s.y = Math.random() * H * 0.7; }
    }

    // Score increments with time
    state.score += dt * 6;
    scoreDisplay.textContent = 'SCORE ' + Math.floor(state.score);

    // Effect timers
    if (state.glitchTimer > 0) {
      state.glitchTimer -= dt;
      if (state.glitchTimer <= 0) document.body.classList.remove('glitch-effect');
    }
    if (state.invertTimer > 0) {
      state.invertTimer -= dt;
      if (state.invertTimer <= 0) document.body.classList.remove('invert-effect');
    }
  }

  function rectIntersect(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Sky gradient already from CSS background, draw subtle grid
    const gy = groundY();

    // Distant stars
    for (const s of stars) {
      ctx.fillStyle = `rgba(${200 + s.z*55|0}, ${150 + s.z*100|0}, 255, ${0.3 + s.z*0.5})`;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }

    // Horizon glow
    const grad = ctx.createLinearGradient(0, gy - 120, 0, gy);
    grad.addColorStop(0, 'rgba(138,43,255,0)');
    grad.addColorStop(1, 'rgba(255,43,214,0.25)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, gy - 120, W, 120);

    // Perspective grid
    ctx.strokeStyle = 'rgba(0,240,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();

    const gridOffset = (performance.now() * state.speed * 0.06) % 40;
    for (let i = 0; i < 14; i++) {
      const yy = gy + i * (i + 2) * 1.2;
      if (yy > H) break;
      ctx.strokeStyle = `rgba(255,43,214,${0.25 - i*0.015})`;
      ctx.beginPath();
      ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
    for (let x = -gridOffset; x < W; x += 40) {
      const t = (x - W/2) / (W/2);
      ctx.strokeStyle = 'rgba(0,240,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(W/2 + t * W * 0.6, gy);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // Trail
    for (const p of player.trail) {
      if (p.life <= 0) continue;
      ctx.fillStyle = `rgba(0,240,255,${p.life * 0.4})`;
      const r = 8 * p.life;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }

    // Player
    drawPlayer();

    // Obstacles
    for (const o of obstacles) drawObstacle(o);

    // Voice ring around player
    if (state.micLevel > 0.05) {
      const r = 26 + state.micLevel * 60;
      ctx.strokeStyle = `rgba(255,43,214,${Math.min(0.8, state.micLevel * 1.2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x + player.w/2, player.y + player.h/2, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Slow-mo / boost vignette
    if (state.slowTimer > 0) {
      ctx.fillStyle = 'rgba(0, 240, 255, 0.06)';
      ctx.fillRect(0, 0, W, H);
    }
    if (state.speedTimer > 0) {
      ctx.fillStyle = 'rgba(255, 43, 214, 0.07)';
      ctx.fillRect(0, 0, W, H);
      // speed lines
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      for (let i = 0; i < 20; i++) {
        const yy = Math.random() * H;
        ctx.beginPath();
        ctx.moveTo(Math.random() * W, yy);
        ctx.lineTo(Math.random() * W - 80, yy);
        ctx.stroke();
      }
    }
  }

  function drawPlayer() {
    const x = player.x, y = player.y, w = player.w, h = player.h;
    // body
    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 16;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;
    // visor
    ctx.fillStyle = '#ff2bd6';
    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 12;
    ctx.fillRect(x + 6, y + 10, w - 12, 6);
    ctx.shadowBlur = 0;
    // legs animation
    const t = performance.now() * 0.02 * state.speed;
    const legOff = Math.sin(t) * 4;
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(x + 4, y + h - 4, 10, 4 + Math.abs(legOff));
    ctx.fillRect(x + w - 14, y + h - 4, 10, 4 + Math.abs(-legOff));
  }

  function drawObstacle(o) {
    let color = '#ff2bd6';
    if (o.type === 'tall')  color = '#8a2bff';
    if (o.type === 'low')   color = '#f7ff2b';
    if (o.type === 'spike') color = '#ff3860';

    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;

    if (o.type === 'spike') {
      ctx.beginPath();
      ctx.moveTo(o.x, o.y + o.h);
      ctx.lineTo(o.x + o.w / 2, o.y);
      ctx.lineTo(o.x + o.w, o.y + o.h);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else {
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      // inner detail
      ctx.fillStyle = color;
      ctx.fillRect(o.x + 4, o.y + 4, o.w - 8, 3);
    }
    ctx.shadowBlur = 0;
  }

  // ---------- Game lifecycle ----------
  function startGame() {
    state.running = true;
    state.over = false;
    state.score = 0;
    state.energy = 100;
    state.speedTimer = 0;
    state.slowTimer = 0;
    state.spawnTimer = 1.0;
    obstacles.length = 0;
    resetPlayer();
    gameOverScreen.classList.add('hidden');
    startScreen.classList.add('hidden');

    // Background music
    bgm.volume = 0.4;
    bgm.play().catch(() => {/* no asset or autoplay blocked */});

    // Resume audio context if suspended
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    // Speech start
    if (recognition) {
      try { recognition.start(); } catch(_) {}
    }
  }

  function gameOver() {
    if (state.over) return;
    state.over = true;
    state.running = false;
    state.best = Math.max(state.best, Math.floor(state.score));
    localStorage.setItem('vr_best', String(state.best));
    finalScore.textContent = Math.floor(state.score);
    bestScoreEl.textContent = state.best;
    gameOverScreen.classList.remove('hidden');
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 400);
    if (recognition) { try { recognition.stop(); } catch(_) {} }
    bgm.pause();
  }

  // ---------- Main loop ----------
  function loop(ts) {
    const now = ts || performance.now();
    let dt = (now - state.lastTime) / 1000;
    if (!state.lastTime) dt = 0;
    state.lastTime = now;
    dt = Math.min(dt, 0.05);

    if (state.running && !state.over) {
      processVoice(now, dt);
      update(dt, now);
    } else if (micReady) {
      // Still update mic bar on menus
      const raw = readMicLevel();
      state.micLevel = state.micLevel * 0.7 + raw * 0.3;
      micBar.style.width = (Math.min(1, state.micLevel * 1.4) * 100) + '%';
    }
    draw();
    requestAnimationFrame(loop);
  }

  // ---------- Buttons ----------
  startBtn.addEventListener('click', async () => {
    await initMic();
    initSpeech();
    resetPlayer();
    startGame();
  });
  restartBtn.addEventListener('click', () => {
    resetPlayer();
    startGame();
  });

  // initial paint
  resetPlayer();
  energyBar.style.width = '100%';
  requestAnimationFrame(loop);
})();
