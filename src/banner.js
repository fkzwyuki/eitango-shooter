// banner.js — 「STAGE 1」「WAVE 1」「WAVE 2」「WAVE CLEAR」「WARNING」「WAVE 3 — BOSS」「CLEAR」などの
// 文字を、右からスライドして入り→中央で少し止まり→左へスライドして抜ける動きで出す（Step7。DESIGN.md §3.1）。
//
// ウェーブの進行（次のモードへ移るタイミング。wave.jsのMODE_CLEAR/MODE_WARNINGのbannerTimer）とは
// 別の、見た目だけのキュー。show()で積んだ文字を順番に1つずつ表示する。演出中もゲームと解答は
// 止めない（wave.js・commands.js側はこのモジュールを待たずに動き続ける）。
// 一時停止中はcanvas.js側がupdate()自体を呼ばないので、演出も自然に止まる。
//
// Step8: 「もっと激しく」（2回目のプレイの感想。DESIGN.md §3.1 v0.5）を受けて派手にした。
//   - 画面横幅いっぱいの帯（暗い帯＋上下のネオン線）と、帯の中を走る横向きスピード線
//   - 文字を大きく（48px→88px）、文字の後ろに薄い残像を数枚
//   - 文字が出現した瞬間、画面が白く光り、画面が揺れる（getFlashAlpha/getShakeOffsetをcanvas.jsが使う）
//   - WARNING（kind==="warning"）: 画面全体が赤く点滅し、黄色と黒の警告テープが上下を流れる。
//     これはbannerの文字が表示されている間だけでなく、wave.js側がsetWarningOverlay(true/false)で
//     WARNINGモードの間ずっとオン・オフできるようにした（文字の表示時間より短いバナーの都合と分離するため）
//   - CLEAR（kind==="clear"）: 光の粒が中央から飛び散る

window.EG = window.EG || {};

EG.banner = (function () {
  var queue = [];   // 表示待ちの { text, color, kind } の列
  var current = null; // 今表示中の項目 + { t: 経過秒 }

  var flashTimer = 0;   // 出現直後、画面が白く光っている残り時間
  var shakeTimer = 0;   // 出現直後、画面が揺れている残り時間
  var warningActive = false; // WARNING中の画面演出（赤い点滅・警告テープ）を出すか
  var tapePhase = 0;    // 警告テープが流れるアニメーションの経過時間
  var particles = [];   // CLEARの「光の粒」 { x, y, vx, vy, life, maxLife }（中心からの相対位置）

  function show(text, color, kind) {
    // kind: 省略(通常) | "warning" | "clear"
    queue.push({ text: text, color: color || "#ffe27a", kind: kind || null });
  }

  function reset() {
    queue = [];
    current = null;
    flashTimer = 0;
    shakeTimer = 0;
    warningActive = false;
    tapePhase = 0;
    particles = [];
  }

  // WARNING中の画面演出（赤い点滅・警告テープ）のオン・オフ（wave.jsから呼ぶ。Step8）。
  // バナーの文字そのものの表示時間（slideIn+hold+slideOut）とは別に、WARNINGモードでいる間ずっと出す
  function setWarningOverlay(active) {
    warningActive = !!active;
  }

  function totalDurationSec() {
    var b = EG.balance.banner;
    return b.slideInSec + b.holdSec + b.slideOutSec;
  }

  function spawnClearParticles() {
    var b = EG.balance.banner;
    for (var i = 0; i < b.clearParticleCount; i++) {
      var ang = Math.random() * Math.PI * 2;
      var spd = b.clearParticleSpeedMin + Math.random() * (b.clearParticleSpeedMax - b.clearParticleSpeedMin);
      particles.push({
        x: 0,
        y: 0,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: b.clearParticleLifeSec,
        maxLife: b.clearParticleLifeSec,
      });
    }
  }

  function updateParticles(dtSec) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dtSec;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
  }

  function update(dtSec) {
    if (!current && queue.length > 0) {
      current = queue.shift();
      current.t = 0;
      // 出現した瞬間、画面が白く光り、画面が揺れる（DESIGN.md §3.1 v0.5。全ての文字に共通）
      flashTimer = EG.balance.banner.flashSec;
      shakeTimer = EG.balance.banner.shakeSec;
      if (current.kind === "clear") {
        spawnClearParticles();
      }
      if (EG.sounds) {
        EG.sounds.play("banner"); // WAVEの文字が入ってくる風切り音（Step9。合成音）
      }
    }
    if (flashTimer > 0) {
      flashTimer -= dtSec;
    }
    if (shakeTimer > 0) {
      shakeTimer -= dtSec;
    }
    tapePhase += dtSec;
    updateParticles(dtSec);

    if (!current) {
      return;
    }
    current.t += dtSec;
    if (current.t >= totalDurationSec()) {
      current = null;
    }
  }

  // イージング（ease-out): 動き始めが速く、終わりがゆっくり止まる
  function easeOutCubic(t) {
    var u = 1 - t;
    return 1 - u * u * u;
  }
  // イージング（ease-in）: 動き始めがゆっくり、終わりが速く抜ける
  function easeInCubic(t) {
    return t * t * t;
  }

  // 今の経過時間から、中央からのx方向のずれ（px）を計算する。
  // スライドイン中は右（プラス）から0へ、ホールド中は0、スライドアウト中は0から左（マイナス）へ
  function offsetXFor(item, canvasW) {
    var b = EG.balance.banner;
    var t = item.t;
    var travel = canvasW * 0.6; // 端から中央までの距離（見映えのよい移動量）
    if (t < b.slideInSec) {
      var p = b.slideInSec <= 0 ? 1 : t / b.slideInSec;
      return travel * (1 - easeOutCubic(p));
    }
    if (t < b.slideInSec + b.holdSec) {
      return 0;
    }
    var outT = t - b.slideInSec - b.holdSec;
    var op = b.slideOutSec <= 0 ? 1 : outT / b.slideOutSec;
    return -travel * easeInCubic(EG.util.clamp(op, 0, 1));
  }

  // 画面横幅いっぱいの帯（半透明の暗い帯＋上下のネオン線。DESIGN.md §3.1 v0.5）
  function drawBand(ctx, canvasW, canvasH, color) {
    var b = EG.balance.banner;
    var top = canvasH / 2 - b.bandHeight / 2;
    ctx.save();
    ctx.globalAlpha = b.bandAlpha;
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, top, canvasW, b.bandHeight);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.fillRect(0, top, canvasW, b.bandLineHeight);
    ctx.fillRect(0, top + b.bandHeight - b.bandLineHeight, canvasW, b.bandLineHeight);
    ctx.restore();
  }

  // 帯の中を走る横向きのスピード線
  function drawSpeedLines(ctx, canvasW, canvasH, color, t) {
    var b = EG.balance.banner;
    var top = canvasH / 2 - b.bandHeight / 2;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (var i = 0; i < b.speedLineCount; i++) {
      var y = top + (i + 0.5) * (b.bandHeight / b.speedLineCount);
      var len = 40 + (i % 3) * 22;
      var xOff = ((t * b.speedLineSpeed) + i * 61) % (canvasW + len) - len;
      ctx.beginPath();
      ctx.moveTo(xOff, y);
      ctx.lineTo(xOff + len, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 文字本体＋残像（数枚のずれた薄い文字。DESIGN.md §3.1 v0.5）
  function drawText(ctx, x, canvasH, item) {
    var b = EG.balance.banner;
    var alpha = 1;
    if (item.kind === "warning") {
      // WARNINGの文字はちかちか明滅させる
      alpha = 0.55 + 0.45 * Math.abs(Math.sin(item.t * b.warningPulseSpeed));
    }
    ctx.save();
    ctx.font = "bold " + b.fontSize + "px 'Consolas', 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (var g = b.afterimageCount; g >= 1; g--) {
      ctx.globalAlpha = alpha * 0.12 * (b.afterimageCount - g + 1) / b.afterimageCount;
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, x + g * b.afterimageOffset, canvasH / 2);
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = item.color;
    ctx.shadowColor = item.color;
    ctx.shadowBlur = 22;
    ctx.fillText(item.text, x, canvasH / 2);
    ctx.restore();
  }

  // WARNING: 画面全体が赤く点滅
  function drawWarningFlash(ctx, canvasW, canvasH, t) {
    var b = EG.balance.banner;
    var a = b.warningFlashAlpha * (0.5 + 0.5 * Math.abs(Math.sin(t * b.warningPulseSpeed)));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();
  }

  // 黄色と黒の警告テープ（斜めしま）を、画面の上または下で横に流す
  function drawHazardTape(ctx, y, canvasW, height, t) {
    var b = EG.balance.banner;
    var stripeW = b.tapeStripeWidth;
    var offset = (t * b.tapeScrollSpeed) % (stripeW * 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, canvasW, height);
    ctx.clip();
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, y, canvasW, height);
    ctx.fillStyle = "#ffcc00";
    ctx.save();
    ctx.translate(-offset, 0);
    for (var x = -stripeW * 2; x < canvasW + stripeW * 2; x += stripeW * 2) {
      ctx.beginPath();
      ctx.moveTo(x, y + height);
      ctx.lineTo(x + stripeW, y + height);
      ctx.lineTo(x + stripeW * 2, y);
      ctx.lineTo(x + stripeW, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  function drawWarningOverlay(ctx, canvasW, canvasH, t) {
    var b = EG.balance.banner;
    drawWarningFlash(ctx, canvasW, canvasH, t);
    drawHazardTape(ctx, 0, canvasW, b.tapeHeight, t);
    drawHazardTape(ctx, canvasH - b.tapeHeight, canvasW, b.tapeHeight, t);
  }

  // CLEAR: 光の粒が中央から飛び散る
  function drawClearParticles(ctx, canvasW, canvasH) {
    var cx = canvasW / 2;
    var cy = canvasH / 2;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = "rgba(255, 240, 180, " + a.toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(cx + p.x, cy + p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw(ctx, canvasW, canvasH) {
    if (warningActive) {
      drawWarningOverlay(ctx, canvasW, canvasH, tapePhase);
    }
    if (particles.length > 0) {
      drawClearParticles(ctx, canvasW, canvasH);
    }
    if (!current) {
      return;
    }
    var x = canvasW / 2 + offsetXFor(current, canvasW);
    drawBand(ctx, canvasW, canvasH, current.color);
    drawSpeedLines(ctx, canvasW, canvasH, current.color, current.t);
    drawText(ctx, x, canvasH, current);
  }

  // canvas.jsが、出現した瞬間の画面揺れ（被弾の揺れと合算する）に使う
  function getShakeOffset() {
    if (shakeTimer <= 0) {
      return { x: 0, y: 0 };
    }
    var b = EG.balance.banner;
    var amp = b.shakeAmplitude * (shakeTimer / b.shakeSec);
    return { x: (Math.random() * 2 - 1) * amp, y: (Math.random() * 2 - 1) * amp };
  }

  // canvas.jsが、出現した瞬間の白いフラッシュに使う
  function getFlashAlpha() {
    if (flashTimer <= 0) {
      return 0;
    }
    var b = EG.balance.banner;
    return Math.max(0, flashTimer / b.flashSec) * b.flashPeakAlpha;
  }

  return {
    show: show,
    reset: reset,
    update: update,
    draw: draw,
    setWarningOverlay: setWarningOverlay,
    getShakeOffset: getShakeOffset,
    getFlashAlpha: getFlashAlpha,
  };
})();
