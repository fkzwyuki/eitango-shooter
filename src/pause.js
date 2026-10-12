// pause.js — 一時停止（Step7。DESIGN.md §3.1）。
// 右上の一時停止ボタン（⏸）を押すか、「9」キー（Escキーでも可）で、シューティング・ウェーブの時間・被弾タイマー・演出など
// 全部を止め、「PAUSE」の画面に「再開」「最初から」を出す。止まっている間はカード選択・解答・ボムの
// キー入力を受け付けない（commands.js / battle.jsが EG.pause.isPaused() を見て自分でガードする）。
//
// 実際に「止める」仕組みは canvas.js 側にある: EG.pause.isPaused() が true の間、canvas.jsの描画ループは
// update()（EG.wave.update / EG.battle.update）を呼ばない。これだけで、被弾タイマー・敵の動き・
// ウェーブの残り時間・バナー演出のすべてが自然に止まる。再開時に大きなdtが一気に流れ込まないための
// 工夫もcanvas.js側にある。
//
// タイトル画面・結果画面では押せない（EG.screens.isTitleOrResultShown()）。ライフ0・中ボス撃破直後で
// まだ結果画面が出るまでの間（EG.commands.isLocked()）も押せない。

window.EG = window.EG || {};

EG.pause = (function () {
  var paused = false;
  var els = {};

  function isPaused() {
    return paused;
  }

  function canToggle() {
    if (EG.screens && EG.screens.isTitleOrResultShown()) {
      return false;
    }
    if (EG.commands && EG.commands.isLocked()) {
      return false;
    }
    return true;
  }

  function doPause() {
    if (paused || !canToggle()) {
      return;
    }
    if (EG.sounds) {
      // まだ「一時停止中」になる前に鳴らす（EG.sounds側の「一時停止中は新しく鳴らさない」ガードに引っかからないように。Step9）
      EG.sounds.play("pause");
    }
    paused = true;
    if (EG.speech) {
      EG.speech.stop(); // 読み上げ中なら止める
    }
    if (EG.commands) {
      EG.commands.pauseTimers(); // 答え合わせ後の「カード選択に戻る」待ちタイマーも止める
    }
    if (EG.sounds) {
      EG.sounds.pauseBgm(); // BGMも止める（位置は残す。Step9）
    }
    els.overlay.hidden = false;
  }

  function doResume() {
    if (!paused) {
      return;
    }
    paused = false;
    els.overlay.hidden = true;
    if (EG.commands) {
      EG.commands.resumeTimers(); // 止めておいた待ちタイマーを残り時間ぶんだけ再開する
    }
    if (EG.sounds) {
      EG.sounds.play("pause"); // 再開の合図の音（Step9）
      EG.sounds.resumeBgm(); // BGMを続きから鳴らす
    }
  }

  function toggle() {
    if (paused) {
      doResume();
    } else {
      doPause();
    }
  }

  // 「最初から」。一時停止画面から選ぶ（Escでは選べない。ボタンのみ）
  function restart() {
    paused = false;
    els.overlay.hidden = true;
    if (EG.screens) {
      EG.screens.restart();
    }
  }

  // 「9」キーでも一時停止・再開（Step11。DESIGN.md §3.1 v0.7。Escも残す）。
  // 9 は単語の文字やカード選択（1〜3）・PASS（5）とぶつからない。押しっぱなしで切り替わり続けないようrepeatは無視する
  function onKeyDown(e) {
    var isNine = EG.util.isDigitKey(e, "9");
    if (e.key !== "Escape" && !isNine) {
      return;
    }
    if (isNine && (e.repeat || e.ctrlKey || e.metaKey || e.altKey)) {
      return;
    }
    if (paused) {
      e.preventDefault();
      doResume();
      return;
    }
    if (canToggle()) {
      e.preventDefault();
      doPause();
    }
  }

  function init() {
    els = {
      overlay: document.getElementById("screen-pause"),
      pauseBtn: document.getElementById("pause-button"),
      resumeBtn: document.getElementById("pause-resume-button"),
      restartBtn: document.getElementById("pause-restart-button"),
    };

    EG.util.onTap(els.pauseBtn, function () { // 指が触れた瞬間に反応（Step21）
      // ボタン自体、タイトル・結果画面ではHUDの上に別の画面が重なっていて押せないが、念のため二重にガードする
      if (canToggle()) {
        toggle();
      }
    });
    els.resumeBtn.addEventListener("click", doResume);
    els.restartBtn.addEventListener("click", restart);
    document.addEventListener("keydown", onKeyDown);
  }

  return { init: init, isPaused: isPaused };
})();
