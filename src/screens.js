// screens.js — 始まりの画面（タイトル）・クリア画面・ゲームオーバー画面（DESIGN.md §3.2、Step6）。
//
// スタートを押すまでゲームはいっさい動かさない（被弾もしない）: DOMContentLoadedの時点では
// EG.battle.init() / EG.wave.init() / EG.canvas.start() を呼ばない。呼ぶのは「スタート」が
// 押されたとき（startGame()）だけにして、シューティングのループそのものを止めておく。
//
// Phase2 Step14: startGame(stage) は「そのステージをWAVE1から満タンで始める」入口になった。
//   ・タイトル: Stage1〜4を選んで始める（1〜4キー、←→＋Enter、クリック）。語が足りないステージは灰色で選べない
//   ・クリア画面（Stage1）: 「次のステージへ」（Enter）で次のステージのWAVE1から
//   ・ゲームオーバー／クリア画面の「もう一度」・一時停止の「最初から」: 今のステージのWAVE1から
//
// 「もう一度」も同じstartGame()を呼ぶ。EG.state.reset() / EG.commands.reset() / EG.battle.init() /
// EG.wave.init() はどれも「何度呼んでも安全」に作られている（Step4・Step5・Step6でそれぞれ確認済み）ので、
// 何回リトライしても2回目以降が1回目と同じように動く。EG.canvas.start()だけは、二重ループ防止のため
// 実際に動くのは最初の1回だけ（2回目以降はcanvas.js側で無視される）。

window.EG = window.EG || {};

EG.screens = (function () {
  var els = {};
  var canvasEl = null;
  var pendingResultTimer = null; // 「CLEAR/GAME OVERの文字が出てから少し待つ」タイマー
  var selectedStage = 1;  // タイトル画面で選んでいるステージ（Enter・スタートで始まるもの）
  var currentStage = 1;   // 今遊んでいる（または直前まで遊んでいた）ステージ。「もう一度」「最初から」はこれをやり直す
  var stageButtons = [];  // タイトル画面のステージ選択ボタン（index 0 = Stage1）
  var nextStageAvailable = false; // クリア画面に「次のステージへ」を出している間だけ true

  function show(name) {
    // name: "title" | "playing" | "result"
    els.title.hidden = name !== "title";
    els.result.hidden = name !== "result";
  }

  function fillResult(reason) {
    var s = EG.state.data;
    var isClear = reason === "stageclear";
    els.resultTitle.textContent = isClear ? "STAGE " + s.stage + " CLEAR" : "GAME OVER"; // STAGE n CLEAR / GAME OVER
    els.resultTitle.className = "result-title " + (isClear ? "result-title-clear" : "result-title-gameover");
    els.resultScore.textContent = "SCORE " + EG.hud.formatScore(s.score);
    els.resultCorrect.textContent = String(s.correctCount);
    els.resultIncorrect.textContent = String(s.incorrectCount);
    els.resultPass.textContent = String(s.passCount);

    // Stage1をクリアしたときだけ「次のステージへ」を出す（次のステージが遊べるとき。最後のステージのクリアでは出さない）
    nextStageAvailable = isClear && s.stage < EG.balance.stage.count && EG.questions.isStagePlayable(s.stage + 1);
    els.nextBtn.hidden = !nextStageAvailable;
    // 「次のステージへ」があるときは、それが主役（Enterもこちら）。「もう一度」は控えめな見た目にする
    els.retryBtn.className = nextStageAvailable ? "secondary-button" : "primary-button";
    els.resultKeyHint.textContent = nextStageAvailable ? "Enterキーで次のステージへ" : "Enterキーでも遊べます";
  }

  // 「CLEAR」「GAME OVER」の文字（既存のCanvas描画）が少し見えたあとで、成績つきの画面を出す
  function scheduleResult(reason, delaySec) {
    if (pendingResultTimer) {
      clearTimeout(pendingResultTimer);
    }
    pendingResultTimer = setTimeout(function () {
      pendingResultTimer = null;
      fillResult(reason);
      show("result");
    }, delaySec * 1000);
  }

  // ユーザー操作（クリック／Enter）の直後に呼んでおくと、ブラウザによっては
  // このあとの自動読み上げ（出題時のspeechSynthesis）が鳴りやすくなる（DESIGN.md §4.1の注記どおり）
  function primeSpeech() {
    if (!EG.speech.isSupported()) {
      return;
    }
    try {
      EG.speech.prime(); // スマホ用: 最初のタップで読み上げを使える状態にする（Phase 3 Step17）
      window.speechSynthesis.resume();
    } catch (e) {
      // 対応していないブラウザでも無視してよい
    }
  }

  // 「スタート」「もう一度」「次のステージへ」「最初から」共通の開始処理: 状態を全部初期値（満タン）に戻してから、
  // 指定したステージのWAVE1を開始する
  function startGame(stage) {
    if (pendingResultTimer) {
      clearTimeout(pendingResultTimer);
      pendingResultTimer = null;
    }
    primeSpeech();

    currentStage = stage || 1;
    EG.state.reset(currentStage);
    EG.questions.init(currentStage); // 出題はこのステージの語だけ
    EG.commands.reset();
    EG.battle.init(canvasEl);
    EG.wave.init(currentStage);
    EG.hud.render();

    show("playing");
    EG.canvas.start(); // 初回だけ実際にループが始まる（2回目以降はcanvas.js内で無視される）
  }

  // ===== タイトル画面のステージ選択（Step14） =====

  function isStageSelectable(stage) {
    return EG.questions.isStagePlayable(stage);
  }

  function renderStageSelect() {
    stageButtons.forEach(function (btn, i) {
      btn.classList.toggle("selected", i + 1 === selectedStage);
    });
  }

  function buildStageSelect() {
    var count = EG.balance.stage.count;
    var labels = EG.balance.stage.levelLabels;
    els.stageSelect.innerHTML = "";
    stageButtons = [];
    for (var n = 1; n <= count; n++) {
      (function (stage) {
        var playable = isStageSelectable(stage);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "stage-button";
        btn.setAttribute("data-stage", String(stage));
        btn.innerHTML =
          '<span class="stage-key">' + stage + '</span>' +
          '<span class="stage-name">STAGE ' + stage + '</span>' +
          '<span class="stage-level">' + EG.util.escapeHtml(labels[stage - 1] || "") + '</span>' +
          (playable ? "" : '<span class="stage-note">準備中</span>');
        if (!playable) {
          btn.disabled = true; // 語がまだ無いステージは灰色で選べない（エラーにはしない）
          btn.classList.add("locked");
        } else {
          btn.addEventListener("click", function () {
            selectedStage = stage; // クリックで、選んでそのまま始める
            renderStageSelect();
            startGame(stage);
          });
        }
        els.stageSelect.appendChild(btn);
        stageButtons.push(btn);
      })(n);
    }
    // 最初の選択は、遊べる最初のステージ（普通はStage1）
    selectedStage = 1;
    for (var k = 1; k <= count; k++) {
      if (isStageSelectable(k)) {
        selectedStage = k;
        break;
      }
    }
    renderStageSelect();
  }

  // ←→↑↓で、遊べるステージだけを順に選ぶ（dir: +1 / -1）
  function moveSelection(dir) {
    var count = EG.balance.stage.count;
    var n = selectedStage;
    for (var i = 0; i < count; i++) {
      n += dir;
      if (n < 1 || n > count) {
        return; // 端でとまる
      }
      if (isStageSelectable(n)) {
        selectedStage = n;
        renderStageSelect();
        return;
      }
    }
  }

  function onKeyDown(e) {
    if (e.repeat) {
      return;
    }
    if (!els.title.hidden) {
      if (e.key === "Enter") {
        e.preventDefault();
        startGame(selectedStage);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        moveSelection(+1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(-1);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // 数字キー（1〜4）: そのステージを選んで、そのまま始める。語が足りないステージは何も起きない
        for (var n = 1; n <= EG.balance.stage.count; n++) {
          if (EG.util.isDigitKey(e, String(n)) && isStageSelectable(n)) {
            e.preventDefault();
            selectedStage = n;
            renderStageSelect();
            startGame(n);
            return;
          }
        }
      }
      return;
    }
    if (e.key !== "Enter") {
      return;
    }
    if (!els.result.hidden) {
      e.preventDefault();
      // 「次のステージへ」が出ているときはそちら、そうでなければ「もう一度」（今のステージをWAVE1から）
      startGame(nextStageAvailable ? currentStage + 1 : currentStage);
    }
    // ゲーム中（両方hidden）はここでは何もしない。カード選択・熟語3択のEnterは
    // commands.js / mode-idiom.jsが同じdocumentのkeydownで別途処理する
  }

  function init(canvasElement) {
    canvasEl = canvasElement;
    els = {
      title: document.getElementById("screen-title"),
      result: document.getElementById("screen-result"),
      startBtn: document.getElementById("start-button"),
      retryBtn: document.getElementById("retry-button"),
      nextBtn: document.getElementById("next-stage-button"),
      resultKeyHint: document.getElementById("result-key-hint"),
      stageSelect: document.getElementById("stage-select"),
      resultTitle: document.getElementById("result-title"),
      resultScore: document.getElementById("result-score"),
      resultCorrect: document.getElementById("result-correct"),
      resultIncorrect: document.getElementById("result-incorrect"),
      resultPass: document.getElementById("result-pass"),
    };

    buildStageSelect();
    els.startBtn.addEventListener("click", function () {
      startGame(selectedStage);
    });
    els.retryBtn.addEventListener("click", function () {
      startGame(currentStage); // 今のステージをWAVE1から
    });
    els.nextBtn.addEventListener("click", function () {
      startGame(currentStage + 1);
    });
    document.addEventListener("keydown", onKeyDown);

    EG.events.on("eg:gameover", function () {
      if (EG.sounds) {
        EG.sounds.playBgm("gameover"); // ゲームオーバーのジングル（Step9。ループしない）
      }
      scheduleResult("gameover", EG.balance.screens.gameOverOverlayDelaySec);
    });
    EG.events.on("eg:stageclear", function () {
      if (EG.sounds) {
        EG.sounds.playBgm("clear"); // クリアのジングル（Step9。ループしない）
      }
      scheduleResult("stageclear", EG.balance.screens.clearOverlayDelaySec);
    });

    show("title");
    if (EG.sounds) {
      // タイトルBGM。最初のユーザー操作より前は鳴らないよう、EG.sounds側で「あとで鳴らす」扱いになる（Step9）
      EG.sounds.playBgm("title");
    }
  }

  return {
    init: init,
    // 成績つきの画面（STAGE CLEAR / GAME OVER）が出ているか。出ている間は、Canvas側の同じ文字を描かない（文字が二重に見えるため）
    isResultShown: function () {
      return !!els.result && !els.result.hidden;
    },
    // タイトル画面・結果画面のどちらかが出ているか（Step7: 一時停止ボタン・Escキーはこの間は押せない）
    isTitleOrResultShown: function () {
      return (!!els.title && !els.title.hidden) || (!!els.result && !els.result.hidden);
    },
    // 「最初から」（一時停止画面から。Step7）で使う。今のステージをWAVE1から始め直す（Step14）
    restart: function () {
      startGame(currentStage);
    },
    startGame: startGame, // 指定したステージから始める（テスト用にも公開）
    refreshStageSelect: buildStageSelect, // 単語データが変わったあとにステージ選択を作り直す（テストが仮のStage2語を入れたあとに使う）
  };
})();
