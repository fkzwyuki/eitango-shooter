// canvas.js — 上半分のCanvas描画ループ。
// 星空の背景を描いたあと、敵・自機・弾などの実体（EG.battle）を重ねて描く（Step4）。
// 被弾時の画面揺れ（DESIGN.md §5.1）も、EG.battleから受け取った揺れ幅ぶんだけctxをずらして表現する。
// Step7: 星空を2〜3層（奥行き）にした。一時停止中（EG.pause）はupdateを呼ばず、画面を止める。
// Step8: ウェーブ切り替え演出が出現した瞬間の画面揺れ（EG.banner）も被弾の揺れと合算する。
// 演出の白いフラッシュ（EG.banner.getFlashAlpha）は画面全体に最後に重ねて描く。
// EG.commands.update(dtSec)もここから呼ぶ（タイピングのお手本を消すタイマーなど。一時停止と自然に整合する）。

window.EG = window.EG || {};

EG.canvas = (function () {
  var ctx = null;
  var canvasEl = null;
  var starLayers = []; // [{stars:[...], speedMin, speedMax, sizeMin, sizeMax, alpha}, ...]。奥から手前の順
  var lastTime = null;
  var running = false;
  var pulseClock = 0; // ライフ危機感の脈動用の経過時間（Step10）。一時停止中はupdate自体が呼ばれないので自然に止まる

  // fps表示（URLに ?fps=1 を付けたときだけ。実機で滑らかさを確かめる用。Step21）
  var fpsEl = null;
  var fpsFrames = 0;
  var fpsElapsedMs = 0;

  function setupFpsDisplay() {
    if (!/[?&]fps=1(&|$)/.test(window.location.search)) {
      return;
    }
    fpsEl = document.createElement("div");
    fpsEl.id = "fps-display";
    fpsEl.textContent = "-- fps";
    document.body.appendChild(fpsEl);
  }

  // 1フレームごとに呼び、fpsSampleSec秒ぶんたまったら平均のfpsを表示に出す
  function tickFps(frameMs) {
    fpsFrames++;
    fpsElapsedMs += frameMs;
    if (fpsElapsedMs >= EG.balance.perf.fpsSampleSec * 1000) {
      fpsEl.textContent = Math.round(fpsFrames * 1000 / fpsElapsedMs) + " fps";
      fpsFrames = 0;
      fpsElapsedMs = 0;
    }
  }

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  // 星空を層ごとに作る（DESIGN.md §5.1「奥行きのある2〜3層のスクロール」）。
  // 奥の層ほど遅く・小さく・薄く、手前の層ほど速く・大きく・濃く見せることで奥行きを出す
  function createStarLayers(width, height) {
    var layers = EG.balance.visual.starLayers;
    return layers.map(function (layerDef) {
      var stars = [];
      for (var i = 0; i < layerDef.count; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          speed: randRange(layerDef.speedMin, layerDef.speedMax),
          size: randRange(layerDef.sizeMin, layerDef.sizeMax),
        });
      }
      return { stars: stars, alpha: layerDef.alpha };
    });
  }

  function init(canvasElement) {
    canvasEl = canvasElement;
    ctx = canvasEl.getContext("2d");
    starLayers = createStarLayers(canvasEl.width, canvasEl.height);
    setupFpsDisplay();
  }

  // Canvasの大きさが変わったとき（layout.jsから。向きの切り替え）。星空を新しい大きさで作り直す
  function onResize(w, h) {
    if (!canvasEl) {
      return;
    }
    // canvas要素の大きさを変えると描画の設定が初期化されるが、ctxの参照はそのまま使える
    starLayers = createStarLayers(w, h);
    // 一時停止中は描画ループが止まっているので、大きさを変えて消えた絵をここで描き直す
    if (EG.pause && EG.pause.isPaused() && EG.battle) {
      draw();
    }
  }

  function updateStars(dtSec) {
    var h = canvasEl.height;
    for (var l = 0; l < starLayers.length; l++) {
      var stars = starLayers[l].stars;
      for (var i = 0; i < stars.length; i++) {
        var star = stars[i];
        star.y += star.speed * dtSec;
        if (star.y > h) {
          star.y = 0;
          star.x = Math.random() * canvasEl.width;
        }
      }
    }
  }

  function update(dtSec) {
    pulseClock += dtSec;
    updateStars(dtSec);
    // ウェーブの進行（通常ウェーブの残り時間・中ボス戦への切り替え）を先に進めてから、
    // その結果（中ボス登場など）を同じフレームのバトル更新に反映させる
    if (EG.wave) {
      EG.wave.update(dtSec);
    }
    if (EG.battle) {
      EG.battle.update(dtSec);
    }
    // 今動いている問題の種類（モード）に時間経過を伝える（Step8。タイピングのお手本を消すタイマーなど）
    if (EG.commands) {
      EG.commands.update(dtSec);
    }
  }

  function drawStars() {
    for (var l = 0; l < starLayers.length; l++) {
      var layer = starLayers[l];
      ctx.globalAlpha = layer.alpha;
      ctx.fillStyle = "#ffffff";
      for (var i = 0; i < layer.stars.length; i++) {
        var star = layer.stars[i];
        ctx.fillRect(star.x, star.y, star.size, star.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ライフが残り1/3以下のとき、画面のふちを赤く脈打たせる（Step10。DESIGN.md §5.1 v0.6
  // 「ライフが残り1/3以下になると画面のふちが赤く脈打つ（少なくなるほど速く）」）。音は付けない
  function drawLifeCriticalVignette(w, h) {
    var s = EG.state && EG.state.data;
    var hb = EG.balance && EG.balance.hud;
    if (!s || !hb || s.life <= 0 || !s.lifeMax) {
      return;
    }
    var ratio = s.life / s.lifeMax;
    if (ratio > hb.criticalLifeRatio) {
      return;
    }
    // 0(ちょうど閾値)〜1(ライフほぼ0)。低いほど脈打つ速さを上げる
    var closeness = 1 - EG.util.clamp(ratio / hb.criticalLifeRatio, 0, 1);
    var speed = hb.lifeCriticalPulseSpeedMin + (hb.lifeCriticalPulseSpeedMax - hb.lifeCriticalPulseSpeedMin) * closeness;
    var pulse = 0.5 + 0.5 * Math.sin(pulseClock * speed * Math.PI * 2);
    // 脈の谷でも少し赤が残るようにする（消えきると「危ない状態が続いている」ことが伝わりにくい）
    var floor = hb.lifeCriticalPulseMinRatio;
    var alpha = hb.lifeCriticalPulseMaxAlpha * (floor + (1 - floor) * pulse);
    // 横長の画面なので、円形のグラデーションだと上下のふちに届かない。4辺それぞれから内側へ赤を伸ばす
    var edge = Math.min(w, h) * hb.lifeCriticalEdgeWidthRatio;
    var color = "rgba(255, 40, 30, " + alpha.toFixed(2) + ")";
    var clear = "rgba(255, 40, 30, 0)";
    ctx.save();
    [
      [0, 0, 0, edge, 0, 0, w, edge],             // 上
      [0, h, 0, h - edge, 0, h - edge, w, edge],  // 下
      [0, 0, edge, 0, 0, 0, edge, h],             // 左
      [w, 0, w - edge, 0, w - edge, 0, edge, h],  // 右
    ].forEach(function (g) {
      var grad = ctx.createLinearGradient(g[0], g[1], g[2], g[3]);
      grad.addColorStop(0, color);
      grad.addColorStop(1, clear);
      ctx.fillStyle = grad;
      ctx.fillRect(g[4], g[5], g[6], g[7]);
    });
    ctx.restore();
  }

  function draw() {
    var w = canvasEl.width;
    var h = canvasEl.height;
    var battleShake = (EG.battle && EG.battle.getShakeOffset) ? EG.battle.getShakeOffset() : { x: 0, y: 0 };
    // ウェーブ切り替えの文字が出現した瞬間の画面揺れ（Step8。DESIGN.md §3.1）も被弾の揺れと合算する
    var bannerShake = (EG.banner && EG.banner.getShakeOffset) ? EG.banner.getShakeOffset() : { x: 0, y: 0 };
    var shake = { x: battleShake.x + bannerShake.x, y: battleShake.y + bannerShake.y };

    ctx.save();
    ctx.translate(shake.x, shake.y);

    // 宇宙の暗い背景（画面が揺れても端が見えないよう少し大きめに塗る）
    ctx.fillStyle = "#04050f";
    ctx.fillRect(-20, -20, w + 40, h + 40);
    drawStars();

    if (EG.battle) {
      EG.battle.draw(ctx);
    }

    ctx.restore();

    // ライフの危機感の脈動（Step10）。画面が揺れても動かない位置に重ねる
    drawLifeCriticalVignette(w, h);

    // WAVE CLEAR / WARNING / CLEAR などの文字・帯は、読みやすさのため画面が揺れても動かない位置で描く
    // （画面そのものが揺れる感覚は、上のワールド全体の揺れで表現している）
    if (EG.wave) {
      EG.wave.draw(ctx, w, h);
    }

    // 文字が出現した瞬間の白いフラッシュ（Step8）。すべての上に重ねて一瞬だけ光らせる
    if (EG.banner && EG.banner.getFlashAlpha) {
      var flashAlpha = EG.banner.getFlashAlpha();
      if (flashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }
  }

  function loop(timestamp) {
    if (!running) {
      return;
    }
    if (lastTime === null) {
      lastTime = timestamp;
    }
    // 一時停止中（Step7）はupdateもdrawも呼ばず、最後に描いた画面のまま止める。
    // lastTimeをそのフレームの時刻に更新し続けるので、再開したときに「止めていた時間ぶん」
    // 大きなdtが一気に流れ込むことはない
    if (EG.pause && EG.pause.isPaused()) {
      lastTime = timestamp;
      requestAnimationFrame(loop);
      return;
    }
    // タブを裏に回して戻したときなど、1フレームのdtが異常に大きくなる場合があるので0.1秒で切り詰める
    if (fpsEl) {
      tickFps(timestamp - lastTime);
    }
    var dtSec = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;
    update(dtSec);
    draw();
    requestAnimationFrame(loop);
  }

  function start() {
    if (running) {
      // 二重にループが走ると更新が倍速になってしまうため、既に動いているときは何もしない
      // （Step6: 「もう一度」のたびにEG.screens.startGame()から呼ばれても安全にするため）
      return;
    }
    running = true;
    lastTime = null;
    requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
  }

  return { init: init, start: start, stop: stop, onResize: onResize };
})();
