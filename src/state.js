// state.js — ゲームが「今どうなっているか」をひとつにまとめる場所（ゲームの状態）。
// HUDやコマンド欄は、ここに入っている値を読んで表示する。
// Step2では画面表示のための仮の初期値だけを持つ。実際にウェーブを進める処理は後のStepで作る。

window.EG = window.EG || {};

EG.state = (function () {
  var balance = EG.balance;

  var data = {
    stage: 1,                // 今遊んでいるステージ（1〜4。Phase2 Step14）
    stageLabel: "STAGE 1",   // 表示用のステージ番号（マップ機能はPhase3なので「STAGE n」だけ）
    waveLabel: "WAVE 1/3",   // 表示用のウェーブ番号（wave.jsが書き換える）
    score: 0,

    lifeMax: balance.life.max,
    life: balance.life.initial,

    shotMax: balance.shot.max,
    shot: balance.shot.initial,

    bombMax: balance.bomb.max,
    bomb: balance.bomb.initial,

    bombCardLimit: balance.bomb.cardLimitPerWave,
    bombCardUsed: 0, // このウェーブで③ボムのカードを選んだ回数

    progressRatio: 0, // 右端バーの割合（0〜1）。通常ウェーブは進み具合、中ボス戦は体力の割合。EG.waveが更新する（Step5）
    rightBarMode: "progress", // "progress"（進み具合）| "bosshp"（中ボスの体力）。hud.jsが見た目（色）を変えるのに使う

    // クリア・ゲームオーバー画面の「今回の成績」用（Step6）。commands.jsが答え合わせのたびに数える
    correctCount: 0,
    incorrectCount: 0,
    passCount: 0,
  };

  // ③ボムのカードを、このウェーブであと何回選べるか
  function bombCardRemaining() {
    return Math.max(0, data.bombCardLimit - data.bombCardUsed);
  }

  // 「もう一度」・次のステージへ・スタートで、そのステージをWAVE1から始めるときに呼ぶ（Step6、Step14でstage引数を追加）。
  // dataオブジェクトの参照は変えず、中身を初期値に書き戻す（EG.state.dataを他のファイルが保持していても壊れないように）。
  // ライフ・ショット・ボムは満タン、点数と今回の成績も0に戻る（点数はステージごと。IMPLEMENTATION_NOTES.md Step14）
  function reset(stage) {
    data.stage = stage || 1;
    data.stageLabel = "STAGE " + data.stage;
    data.waveLabel = "WAVE 1/3";
    data.score = 0;

    data.lifeMax = balance.life.max;
    data.life = balance.life.initial;

    data.shotMax = balance.shot.max;
    data.shot = balance.shot.initial;

    data.bombMax = balance.bomb.max;
    data.bomb = balance.bomb.initial;

    data.bombCardLimit = balance.bomb.cardLimitPerWave;
    data.bombCardUsed = 0;

    data.progressRatio = 0;
    data.rightBarMode = "progress";

    data.correctCount = 0;
    data.incorrectCount = 0;
    data.passCount = 0;
  }

  return {
    data: data,
    bombCardRemaining: bombCardRemaining,
    reset: reset,
  };
})();
