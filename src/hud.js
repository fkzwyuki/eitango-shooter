// hud.js — 上半分（シューティング画面）に重ねて出す文字・ゲージの表示を担当する。
// DESIGN.md §3.1 の骨組み: STAGE/WAVE/SCORE、LIFEとSHOTの縦ゲージ、BOMBの残り数、右端の進み具合バー。

window.EG = window.EG || {};

EG.hud = (function () {
  var els = null;

  function init() {
    els = {
      stage: document.getElementById("hud-stage"),
      wave: document.getElementById("hud-wave"),
      score: document.getElementById("hud-score"),
      lifeGauge: document.getElementById("life-gauge"),
      shotGauge: document.getElementById("shot-gauge"),
      bombCount: document.getElementById("bomb-count"),
      progressTrack: document.getElementById("progress-bar-track"),
      progressFill: document.getElementById("progress-bar-fill"),
      progressLabel: document.getElementById("progress-bar-label"),
      shotStatus: document.getElementById("shot-status"),
      bombButton: document.getElementById("bomb-button"),
    };
    // ボムボタン（タップ用。スペースキーと同じ。Phase 3 Step17）
    if (els.bombButton) {
      EG.util.onTap(els.bombButton, function () { // 指が触れた瞬間に撃つ（Step21）
        if (EG.battle && EG.battle.requestBomb) {
          EG.battle.requestBomb();
        }
      });
    }
    render();
  }

  // SCORE表示は7桁のゼロ埋め（モックアップの SCORE 0012340 に合わせる）
  function formatScore(score) {
    var s = String(Math.max(0, Math.floor(score)));
    while (s.length < 7) {
      s = "0" + s;
    }
    return s;
  }

  // ライフ・ショットの縦ゲージを、balance.hud.gaugeSegments段の目盛りで表示する
  function renderGauge(el, value, max) {
    el.innerHTML = "";
    var segments = EG.balance.hud.gaugeSegments;
    var filled = Math.round((value / max) * segments);
    for (var i = 0; i < segments; i++) {
      var seg = document.createElement("div");
      seg.className = "gauge-segment" + (i < filled ? " filled" : "");
      el.appendChild(seg);
    }
  }

  // ボムの残り数を ●○ で表示する
  function renderBomb(value, max) {
    var s = "";
    for (var i = 0; i < max; i++) {
      s += i < value ? "●" : "○";
    }
    els.bombCount.textContent = s;
  }

  // ライフ・ショットの危機感の表示（Step10。DESIGN.md §5.1 v0.6「ライフ・ショットが残り1/3以下で危機感の演出」）。
  // 画面のふちの脈動はcanvas.jsが描く。ここではLIFE/SHOTゲージの点滅クラスと「LOW AMMO」「NO AMMO」の文字を扱う
  function renderCriticalIndicators(s) {
    var hb = EG.balance.hud;

    var lifeRatio = s.lifeMax > 0 ? s.life / s.lifeMax : 0;
    var lifeCritical = s.life > 0 && lifeRatio <= hb.criticalLifeRatio;
    els.lifeGauge.classList.toggle("critical", lifeCritical);
    if (lifeCritical) {
      // 少ないほど速く点滅させる（点滅の間隔を短くする）
      var closeness = 1 - EG.util.clamp(lifeRatio / hb.criticalLifeRatio, 0, 1);
      var blinkSec = hb.lifeGaugeBlinkDurationMaxSec
        - (hb.lifeGaugeBlinkDurationMaxSec - hb.lifeGaugeBlinkDurationMinSec) * closeness;
      els.lifeGauge.style.setProperty("--blink-duration", blinkSec.toFixed(2) + "s");
    }

    var shotRatio = s.shotMax > 0 ? s.shot / s.shotMax : 0;
    var noAmmo = s.shot <= 0;
    var lowAmmo = !noAmmo && shotRatio <= hb.lowShotRatio;
    els.shotGauge.classList.toggle("low-ammo", lowAmmo);
    els.shotGauge.classList.toggle("no-ammo", noAmmo);
    if (els.shotStatus) {
      els.shotStatus.textContent = noAmmo ? "NO AMMO" : (lowAmmo ? "LOW AMMO" : "");
    }
  }

  function render() {
    var s = EG.state.data;
    els.stage.textContent = s.stageLabel;
    els.wave.textContent = s.waveLabel;
    els.score.textContent = "SCORE " + formatScore(s.score);
    renderGauge(els.lifeGauge, s.life, s.lifeMax);
    renderGauge(els.shotGauge, s.shot, s.shotMax);
    renderBomb(s.bomb, s.bombMax);
    if (els.bombButton) {
      els.bombButton.classList.toggle("empty", s.bomb <= 0); // ボムが無いときは薄く見せる
      els.bombButton.setAttribute("data-bomb", String(s.bomb));
    }
    els.progressFill.style.height = Math.round(s.progressRatio * 100) + "%";
    renderCriticalIndicators(s);

    // 中ボス戦の間は、右端のバーを「進み具合」から「体力」に見た目ごと切り替える（DESIGN.md §3.1・§7.4）
    var isBossBar = s.rightBarMode === "bosshp";
    els.progressTrack.classList.toggle("boss-mode", isBossBar);
    els.progressLabel.textContent = isBossBar ? "BOSS" : "";
  }

  // クリア・ゲームオーバー画面（screens.js）でもSCORE表示を揃えるために公開する（Step6）
  return { init: init, render: render, formatScore: formatScore };
})();
