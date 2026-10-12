// wave.js — 1ステージ＝WAVE1（生き延びる）→ WAVE2（生き延びる）→ WAVE3（中ボス戦）の進行と、点数（DESIGN.md §3.1・§7.4・§7.6）。
// Phase2 Step14: Phase1では WAVE2 を飛ばしていた。今は「生き延びる」ウェーブを survivalWaveCount 回（WAVE1・WAVE2）
// 繰り返してから WARNING → 中ボス戦（WAVE3）に入る。ライフ・ショット・ボムはウェーブが変わっても引き継ぎ
// （ボムのカードの残り回数だけウェーブごとに戻す）。ステージが変わるとき（次のステージへ・もう一度）は screens.js が
// state.reset() で満タンに戻してから init(stage) を呼ぶ。
// 右端のバー（#progress-bar-fill）は通常ウェーブでは進み具合、中ボス戦では体力の割合として使い回す
// （state.data.progressRatio / state.data.rightBarMode を書き換え、実際の見た目はhud.jsが描く）。
// 中ボス本体（見た目・弾・撃破の爆発）はEG.battleが持つ。ここでは「いつ登場させるか」「正解でダメージを
// 指示する」「点数を積む」「モード（NORMAL→CLEAR→WARNING→MINIBOSS→STAGECLEAR）の進行」だけを見る。
//
// ウェーブ切り替えの文字（「WAVE 1」「WAVE CLEAR」「WARNING」「WAVE 3 — BOSS」など）の見た目（スライド演出）は
// EG.banner（src/banner.js）に任せる。モードの進行タイマー（bannerTimer。次のモードに移るまでの足止め時間）と
// 文字の表示時間は別物（Step7で分離。DESIGN.md §3.1）
//
// マス（道の難しさ）はまだマップがないため、常に「易」固定にしている（IMPLEMENTATION_NOTES.md Step5「決めたこと」参照）。

window.EG = window.EG || {};

EG.wave = (function () {
  var MODE_NORMAL = "normal";       // 通常ウェーブ（生き延びる）
  var MODE_CLEAR = "clear";         // 「WAVE CLEAR」表示中（次のモードへ移るまでの足止め）
  var MODE_WARNING = "warning";     // 「WARNING」表示中（中ボス登場前の足止め）
  var MODE_MINIBOSS = "miniboss";   // 中ボス戦
  var MODE_STAGECLEAR = "stageclear"; // 中ボスを倒した後（Step5はここで止めてCLEARの文字を出すだけ）

  var mode = MODE_NORMAL;
  var stage = 1;          // 今のステージ（1〜4）
  var waveNumber = 1;     // 今のウェーブ番号（1・2は生き延びる。3は中ボス戦）
  var bannerTimer = 0;    // 次のモードへ移るまでの残り秒数（CLEAR/WARNINGの足止め時間。文字の見た目とは別）
  var waveElapsed = 0;    // 通常ウェーブの経過秒数
  var waveTimeSec = 0;    // 今のウェーブの制限時間（balance.mass.easy.waveTimeSec）
  var comboStreak = 0;    // 連続正解の数（間違い・PASSで0に戻る）
  var listenersAttached = false;

  function currentMassBalance() {
    // Phase1は「易」固定（マップはPhase3）
    return EG.balance.mass.easy;
  }

  function addScore(amount) {
    EG.state.data.score += Math.round(amount);
    EG.hud.render();
  }

  // 連続正解ボーナス: 連続正解が続くほど増える。comboCapで頭打ちにする（DESIGN.md §7.6）
  function comboBonus(streak) {
    var sc = EG.balance.score;
    return sc.comboStep * Math.min(streak, sc.comboCap);
  }

  function onAnswer(detail) {
    if (mode === MODE_STAGECLEAR || !detail) {
      return;
    }
    if (detail.result === "correct") {
      comboStreak++;
      addScore(EG.balance.score.correctBonus + comboBonus(comboStreak));
      if (mode === MODE_MINIBOSS) {
        // 正解するたびに1ダメージ（PASS・間違いはダメージなし。DESIGN.md §7.4）
        EG.battle.damageMiniboss(1);
      }
    } else {
      // 間違い・PASSで連続正解が途切れる
      comboStreak = 0;
    }
  }

  function enterClear() {
    mode = MODE_CLEAR;
    bannerTimer = EG.balance.wave.clearMessageSec;
    EG.banner.show("WAVE CLEAR", "#4be07a");
  }

  // 次の「生き延びる」ウェーブ（WAVE2）を始める。ライフ・ショット・ボムは引き継ぐ。
  // ボムのカードの残り回数だけ戻す（DESIGN.md §7.4）
  function startSurvivalWave(n) {
    mode = MODE_NORMAL;
    waveNumber = n;
    waveElapsed = 0;
    var s = EG.state.data;
    s.waveLabel = "WAVE " + n + "/" + EG.balance.wave.wavesPerMass;
    s.bombCardUsed = 0;
    s.rightBarMode = "progress";
    s.progressRatio = 0;
    EG.commands.render();
    EG.hud.render();
    EG.banner.show("WAVE " + n, "#9fe6ff");
  }

  function enterWarning() {
    mode = MODE_WARNING;
    bannerTimer = EG.balance.wave.warningMessageSec;
    // WARNING中の画面演出（赤い点滅・警告テープ）はWARNINGモードでいる間ずっと出す（Step8。enterMinibossで止める）
    EG.banner.setWarningOverlay(true);
    EG.banner.show("WARNING", "#ff5050", "warning"); // kind: "warning"（ちかちか明滅＋赤い点滅＋警告テープ）
    if (EG.sounds) {
      EG.sounds.play("warning"); // サイレン（Step9。合成音）
    }
  }

  function enterMiniboss() {
    mode = MODE_MINIBOSS;
    waveNumber = EG.balance.wave.wavesPerMass;
    EG.state.data.waveLabel = "WAVE " + waveNumber + "/" + EG.balance.wave.wavesPerMass;
    // ボムのカードの残り回数は、ウェーブが変わったら戻す（DESIGN.md §7.4）。ライフ・ショット・ボムそのものは引き継ぐ
    EG.state.data.bombCardUsed = 0;
    EG.state.data.rightBarMode = "bosshp";
    EG.commands.render();
    var hp = currentMassBalance().minibossHp;
    EG.battle.startMiniboss(hp);
    EG.state.data.progressRatio = 1; // 体力満タン＝バー満タンから始まる
    EG.hud.render();
    EG.banner.setWarningOverlay(false); // WARNINGの画面演出はここで止める（Step8）
    EG.banner.show("WAVE " + waveNumber + " — BOSS", "#c04cff");
    if (EG.sounds) {
      EG.sounds.playBgm("boss"); // 中ボス戦のBGM（Step9）
    }
  }

  function enterStageClear() {
    mode = MODE_STAGECLEAR;
    addScore(EG.balance.score.minibossDefeatBonus);
    EG.banner.show("CLEAR", "#ffe27a", "clear"); // kind: "clear"（光の粒が飛び散る）
    EG.events.emit("eg:stageclear", {});
  }

  function update(dtSec) {
    EG.banner.update(dtSec); // 文字のスライド演出はモードの進行と関係なく、いつも更新する

    if (mode === MODE_NORMAL) {
      waveElapsed += dtSec;
      EG.state.data.progressRatio = EG.util.clamp(waveElapsed / waveTimeSec, 0, 1);
      if (waveElapsed >= waveTimeSec) {
        enterClear();
      }
      return;
    }
    if (mode === MODE_CLEAR) {
      bannerTimer -= dtSec;
      if (bannerTimer <= 0) {
        if (waveNumber < EG.balance.wave.survivalWaveCount) {
          startSurvivalWave(waveNumber + 1); // WAVE1のあとはWAVE2へ
        } else {
          enterWarning(); // 最後の生き延びるウェーブのあとは、中ボス戦（WAVE3）の前のWARNINGへ
        }
      }
      return;
    }
    if (mode === MODE_WARNING) {
      bannerTimer -= dtSec;
      if (bannerTimer <= 0) {
        enterMiniboss();
      }
      return;
    }
    if (mode === MODE_MINIBOSS) {
      EG.state.data.progressRatio = EG.battle.getMinibossHpRatio();
      if (EG.battle.isMinibossDefeated()) {
        enterStageClear();
      }
      return;
    }
    // MODE_STAGECLEAR: 何もしない。ゲームを止めてCLEARの文字を出し続けるだけ（Step6で正式なクリア画面にする）
  }

  function draw(ctx, canvasW, canvasH) {
    if (EG.screens && EG.screens.isResultShown()) {
      return; // 成績つきの画面が出たら、同じ意味の文字が二重に見えないようここでは描かない
    }
    EG.banner.draw(ctx, canvasW, canvasH);
  }

  // stage: 今から遊ぶステージ（1〜4）。WAVE1の最初から始める（screens.jsの startGame から呼ぶ）
  function init(stageNumber) {
    stage = stageNumber || 1;
    mode = MODE_NORMAL;
    waveNumber = 1;
    bannerTimer = 0;
    waveElapsed = 0;
    waveTimeSec = currentMassBalance().waveTimeSec;
    comboStreak = 0;

    EG.state.data.stage = stage;
    EG.state.data.stageLabel = "STAGE " + stage;
    EG.state.data.waveLabel = "WAVE 1/" + EG.balance.wave.wavesPerMass;
    EG.state.data.rightBarMode = "progress";
    EG.state.data.progressRatio = 0;
    EG.hud.render();

    EG.banner.reset();
    EG.banner.show("STAGE " + stage, "#ffe27a");
    EG.banner.show("WAVE 1", "#9fe6ff");

    if (EG.sounds) {
      EG.sounds.playBgm("stage"); // 通常ウェーブのBGM（Step9）。WAVE2・中ボス戦への切り替えでは鳴らし直さない（WAVE3だけ boss 曲）
    }

    if (!listenersAttached) {
      EG.events.on("eg:answer", onAnswer);
      listenersAttached = true;
    }
  }

  return {
    init: init,
    update: update,
    draw: draw,
    isStageClear: function () {
      return mode === MODE_STAGECLEAR;
    },
    getStage: function () {
      return stage;
    },
    getWaveNumber: function () {
      return waveNumber;
    },
    // 敵の編隊が出てくるペースの倍率（battle.js が見る）。WAVE1は1.0、WAVE2以降は少しだけ混ませる（Step14）
    getSpawnRateMultiplier: function () {
      return waveNumber >= 2 && mode !== MODE_MINIBOSS ? EG.balance.wave.wave2SpawnRateMultiplier : 1;
    },
  };
})();
