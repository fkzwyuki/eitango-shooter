// commands.js — 下半分（学習コマンド欄）の司令塔。
// カードの選択（数字キー1〜3を押すだけで決定、またはクリック。Step7でEnter不要にした）、選んだモードの開始、
// 答え合わせ（正解・不正解・PASSの共通処理（補充・読み上げ・イベント発行・カード選択への復帰）を担当する。
// 各モードの中身（1文字判定・タイル操作・3択）は mode-typing.js / mode-rearrange.js / mode-idiom.js。
//
// 他の部分への通知（Step4「間違えたら敵が2体増える」・Step5「正解で中ボスにダメージ」用）:
//   EG.events.on("eg:answer", function (detail) { ... });
//   detail = {
//     result: "correct" | "incorrect" | "pass",
//     cardType: "life" | "shot" | "bomb",           // 補充される資源（カードの位置で決まる。Step8）
//     mode: "typing" | "arrange" | "fill" | "meaning" | "idiom" | "talk" | "order", // 出題された問題の種類（Step8で追加。Step16で fill・meaning を追加）
//     word: {id, en, ja, type, stage, difficulty},  // 出題された単語 or 熟語
//     direction: "en2ja" | "ja2en" | null,           // 熟語(idiom)・意味4択(meaning)のときだけ入る
//   }
//
// Step7の変更点（1回目のプレイの「もっさりする」感想を受けて）:
//   - カード選択・熟語3択は、数字キーを押すだけで決定（Enter不要）。クリックは従来どおり即決定
//   - 答えたあとの待ち時間は、正解 0.6秒・間違い/PASS 1.4秒（balance.js question.correctResultMs/wrongResultMs）
//   - 待っている間に数字キー(1〜3)を押すと、待たずにそのカードの次の問題へ進める（skipWaitAndSelect）
//   - 一時停止中（EG.pause）はカード選択・解答・待ち時間スキップのキー入力をすべて受け付けない
//
// Step8の変更点（2回目のプレイの感想を受けて。DESIGN.md v0.5 §4.0・§4.1）:
//   - カードの資源（①ライフ②ショット③ボム）は位置固定のまま、そのカードで出る「問題の種類」
//     （タイピング・並べ替え・熟語3択）を、ゲーム開始時と1問答えるたび（正解・間違い・PASSとも）に
//     シャッフルして割り当て直す（cardModes。shuffleCardModes()）。補充はカードの資源で決まる（今まで通り）
//   - 答え待ちのとき、キーボードの「5」でもPASSできる（PASSボタンと同じ）

window.EG = window.EG || {};

EG.commands = (function () {
  var els = {};
  var cardElByKey = {}; // {1: el, 2: el, 3: el}
  var view = "cards";   // "cards" | "question"
  var busy = false;        // 結果表示中(true)はカード選択・モードへの入力を止める（数字キーでのスキップだけ別扱い）
  var activeMode = null;   // 現在動いているモード(EG.modeTyping / modeRearrange / modeIdiom)
  var currentCardKey = null;
  var currentSpeechText = null; // 🔊ボタンで再生する英語テキスト
  // ライフが0、または中ボスを倒したら true。以降カード選択・キー入力を止める（Step4・Step5）。
  // Step6: 最初は「スタート」を押すまでゲームを動かさないため、初期値もtrue（EG.screens.startGame()内のreset()で解除する）
  var gameOverLocked = true;

  // カードの資源（位置固定。DESIGN.md §4.0）と、問題の種類（1問ごとにシャッフルする）の対応（Step8）
  var CARD_RESOURCE = { 1: "life", 2: "shot", 3: "bomb" };
  // 問題の種類は7つ（Phase3 Step16・22。DESIGN.md §4.0 v0.12）。talk（会話）・order（語順）は今のステージ以下の会話のデータがあるときだけ選ばれる
  var MODE_TYPES = ["typing", "arrange", "fill", "meaning", "idiom", "talk", "order"];
  var MODE_LABEL = { typing: "タイプ", arrange: "並べ替え", fill: "穴埋め", meaning: "意味", idiom: "熟語", talk: "会話", order: "語順" };
  var DEFAULT_MODES = ["typing", "arrange", "idiom"]; // 出せる種類が1つも無いときの最後の手段
  var cardModes = { 1: "typing", 2: "arrange", 3: "idiom" }; // 初期値。init()・reset()・答えるたびに上書きされる
  // どの重み（balance.js の question.modeWeights）を使うか。"pc" か "touch"。タッチ判定は Step17 で
  // setInputKind("touch") を呼んで差し込む（今は常に pc）
  var inputKind = "pc";

  // 答え合わせ後、カード選択に戻るまでの setTimeout（Step7: 一時停止中は止め、数字キーでスキップできるように保持しておく）
  var answeredAt = 0; // 最後に答えた時刻（ミリ秒）。結果表示中のタップ飛ばしで、答えた直後の誤タップを無視するのに使う（Step21）
  var pendingReturnTimer = null;
  var pendingReturnStartedAt = null;
  var pendingReturnDelayMs = null;
  var pendingReturnRemainingMs = null;

  EG.events.on("eg:gameover", function () {
    gameOverLocked = true;
  });

  // 中ボスを倒してゲームが止まったら、ゲームオーバーと同じ理由で入力を止める（Step5）
  EG.events.on("eg:stageclear", function () {
    gameOverLocked = true;
  });

  // 自動の読み上げを、カードを選ぶ音（select）や答え合わせの音（correct/wrong/pass）の出だしと
  // 重ならないよう少しだけ遅らせて始める（Step10。DESIGN.md §10.3 v0.6「カードを選ぶ音と読み上げが
  // 重ならないよう、読み上げを少しだけ遅らせる」）。🔊ボタンでの手動の再生は遅らせない（即座に聞きたいため）
  function speakSoon(text) {
    var delayMs = (EG.balance.sound && EG.balance.sound.speechDelayAfterSelectSec) ? EG.balance.sound.speechDelayAfterSelectSec * 1000 : 0;
    setTimeout(function () {
      EG.speech.speak(text);
    }, delayMs);
  }

  // 🔊ボタンの有効・無効を切り替える。熟語の日→英は、答え合わせが終わるまで
  // 押すと答え（英語）が聞こえてしまうので無効にする（DESIGN.md §4.1、Step3の直し）
  function setSpeakEnabled(enabled) {
    var el = document.getElementById("speak-button");
    if (!el) {
      return;
    }
    el.disabled = !enabled;
    el.classList.toggle("disabled", !enabled);
  }

  // カードと問題の種類をシャッフルして割り当て直す（DESIGN.md §4.0）。
  // ゲーム開始時（init/reset）と、1問答えるたび（正解・間違い・PASSとも。onAnswer内）に呼ぶ
  function shuffleCardModes() {
    var order = pickCardModes();
    cardModes = { 1: order[0], 2: order[1], 3: order[2] };
    renderCardModes();
  }

  // その問題の種類が今出せるか（重みが0でない・そのステージに語がある・モードが実装済み）
  function isModeAvailable(mode) {
    var weights = EG.balance.question.modeWeights[inputKind] || EG.balance.question.modeWeights.pc;
    if (!(weights[mode] > 0)) {
      return false;
    }
    if (!MODE_IMPL[mode]) {
      return false; // まだ作っていない種類（会話）
    }
    return EG.questions.canPick(mode);
  }

  // 出せる種類の中から、重みに従って重なりなく3つ選ぶ（DESIGN.md §4.0）。
  // 出せる種類が3つに足りないときは、出せるものを繰り返して埋める（エラーにしない）
  function pickCardModes() {
    var weights = EG.balance.question.modeWeights[inputKind] || EG.balance.question.modeWeights.pc;
    var pool = MODE_TYPES.filter(isModeAvailable);
    var picked = [];
    while (picked.length < 3 && pool.length > 0) {
      var total = 0;
      pool.forEach(function (m) { total += weights[m]; });
      var r = Math.random() * total;
      var idx = 0;
      for (var i = 0; i < pool.length; i++) {
        r -= weights[pool[i]];
        if (r < 0) {
          idx = i;
          break;
        }
        idx = i;
      }
      picked.push(pool[idx]);
      pool.splice(idx, 1);
    }
    if (picked.length === 0) {
      return EG.util.shuffle(DEFAULT_MODES);
    }
    var all = picked.slice();
    while (picked.length < 3) {
      picked.push(all[picked.length % all.length]);
    }
    return picked;
  }

  // 重みの組を切り替える（Step17 がタッチ判定で呼ぶ）。"pc" | "touch"
  function setInputKind(kind) {
    inputKind = kind === "touch" ? "touch" : "pc";
  }

  // カードのDOM（data-mode属性・問題の種類のラベル）を今のcardModesに合わせて描き直す
  function renderCardModes() {
    [1, 2, 3].forEach(function (key) {
      var el = cardElByKey[key];
      if (!el) {
        return;
      }
      var mode = cardModes[key];
      el.setAttribute("data-mode", mode); // テスト（tools/test/）から今の割り当てを読めるようにする
      var labelEl = el.querySelector(".card-mode-label");
      if (labelEl) {
        labelEl.textContent = MODE_LABEL[mode];
      }
    });
  }

  // 実装済みのモード（これに無い種類はカードに入らない）
  var MODE_IMPL = { typing: true, arrange: true, fill: true, meaning: true, idiom: true, talk: true, order: true };

  function init() {
    els = {
      cardSelectView: document.getElementById("card-select-view"),
      questionView: document.getElementById("question-view"),
      bombRemaining: document.getElementById("bomb-remaining"),
      prompt: document.getElementById("question-prompt"),
      speakBtn: document.getElementById("speak-button"),
      body: document.getElementById("question-body"),
      message: document.getElementById("question-message"),
      passBtn: document.getElementById("pass-button"),
    };

    var cardEls = document.querySelectorAll(".command-card");
    cardEls.forEach(function (el) {
      var key = Number(el.getAttribute("data-card"));
      cardElByKey[key] = el;
      EG.util.onTap(el, function () { // 指が触れた瞬間に確定（数字キーと同じく即決定。Step21）
        if (gameOverLocked || (EG.pause && EG.pause.isPaused())) {
          return;
        }
        selectCard(key);
      });
    });
    shuffleCardModes(); // 起動時点の見た目を整えておく（実際にプレイできるのはスタート後）

    EG.util.onTap(els.speakBtn, function () {
      if (els.speakBtn.disabled) {
        return; // disabled中は何もしない（pointerdownはdisabledでも届くことがあるため必要）
      }
      if (currentSpeechText) {
        EG.speech.speak(currentSpeechText);
      }
    });

    EG.util.onTap(els.passBtn, function () {
      if (EG.pause && EG.pause.isPaused()) {
        return;
      }
      if (activeMode && activeMode.pass) {
        activeMode.pass();
      }
    });

    // 結果表示中（答えたあと）に問題の欄のどこかをタップ／クリックすると、待たずにカード選択へ戻る（Step21）。
    // 捕捉フェーズで受けるので、答えを押したそのタップでは（まだ結果表示中ではないため）飛ばない。
    // 🔊ボタンは結果を見ながら聞き直すために使うので、飛ばさない
    EG.util.onTap(els.questionView, function (e) {
      if (!busy || view !== "question" || gameOverLocked || (EG.pause && EG.pause.isPaused())) {
        return;
      }
      if (e.target && e.target.closest && e.target.closest("#speak-button")) {
        return;
      }
      if (Date.now() - answeredAt < EG.balance.question.resultSkipGuardMs) {
        return; // 答えた指の続けてのタップは無視
      }
      showCardSelect();
    }, { capture: true });

    document.addEventListener("keydown", onKeyDown);

    showCardSelect();
  }

  function render() {
    var remaining = EG.state.bombCardRemaining();
    els.bombRemaining.textContent = "残り" + remaining + "回";
    var bombCardEl = cardElByKey[3];
    if (bombCardEl) {
      bombCardEl.classList.toggle("disabled", remaining <= 0);
    }
  }

  function isCardDisabled(key) {
    return key === 3 && EG.state.bombCardRemaining() <= 0;
  }

  function clearPendingReturnTimer() {
    if (pendingReturnTimer) {
      clearTimeout(pendingReturnTimer);
    }
    pendingReturnTimer = null;
    pendingReturnStartedAt = null;
    pendingReturnDelayMs = null;
    pendingReturnRemainingMs = null;
  }

  function showCardSelect() {
    view = "cards";
    busy = false;
    activeMode = null;
    currentCardKey = null;
    currentSpeechText = null;
    clearPendingReturnTimer();
    els.cardSelectView.hidden = false;
    els.questionView.hidden = true;
    els.passBtn.style.display = "";
    els.message.textContent = "";
    els.message.className = "question-message";
    render();
  }

  function selectCard(key) {
    if (busy || view !== "cards" || isCardDisabled(key)) {
      return;
    }
    startQuestion(key);
  }

  function startQuestion(key) {
    clearPendingReturnTimer();
    currentCardKey = key;
    view = "question";
    busy = false;
    els.cardSelectView.hidden = true;
    els.questionView.hidden = false;
    els.passBtn.style.display = "";
    els.message.textContent = "";
    setSpeakEnabled(true); // 既定は押せる（熟語の日→英だけstartIdiom側で無効にする）
    els.message.className = "question-message";
    // 会話のときだけ問題の欄の見た目を変える（場面・セリフの2段、選択肢を縦の画面で1列に）。前の問題の表示を戻す
    els.questionView.classList.remove("talk-q");
    els.questionView.classList.remove("order-q");
    els.prompt.textContent = "";

    if (key === 3) {
      // 正解・不正解・PASSに関係なく「ボムのカードを選んだ回数」で数える。問題の種類（mode）には関係ない（DESIGN.md §4.0・§4.4）
      EG.state.data.bombCardUsed++;
      render();
    }

    if (EG.sounds) {
      // まだ鳴っている前の問題の結果音（correct/wrong/pass）を止めてから、カードを選んだ決定音を鳴らす
      // （Step10。DESIGN.md §10.3 v0.6「問題が始まるとき、まだ鳴っている効果音は止める」）
      EG.sounds.stopSe(["correct", "wrong", "pass"]);
      EG.sounds.play("select"); // カードを選んだ決定音（Step9。DESIGN.md §10.2）
    }

    // カードの資源（補充されるもの）は位置固定、問題の種類（mode）はcardModesの今の割り当てに従う（DESIGN.md §4.0）
    var cardType = CARD_RESOURCE[key];
    var mode = cardModes[key];
    if (mode === "typing") {
      startTyping(cardType);
    } else if (mode === "arrange") {
      startRearrange(cardType);
    } else if (mode === "fill") {
      startFill(cardType);
    } else if (mode === "meaning") {
      startMeaning(cardType);
    } else if (mode === "idiom") {
      startIdiom(cardType);
    } else if (mode === "talk") {
      startTalk(cardType);
    } else if (mode === "order") {
      startOrder(cardType);
    }
  }

  // 語順（DESIGN.md §4.8）。上に日本語の訳、単語タイルを左から順に入れる。出題時は読まない（答えが分かる）。
  // 答えたあとに正解の英文を読む（onAnswer内）。🔊は答え合わせが終わるまで押せない
  function startOrder(cardType) {
    var q = EG.questions.pickOrderQuestion();
    els.questionView.classList.add("order-q");
    els.prompt.textContent = q.talk.answer_ja;
    currentSpeechText = q.talk.answer;
    setSpeakEnabled(false);
    activeMode = EG.modeOrder;
    activeMode.start(q, els.body, {
      onDone: function (result) {
        setSpeakEnabled(true);
        onAnswer(result, { cardType: cardType, mode: "order", word: q.talk, direction: null });
      },
    });
  }

  // 会話（DESIGN.md §4.7）。場面と相手のセリフ・3つの選択肢を最初から出し、セリフは出題時に読む（読み上げは答えを止めない。mode-talk.js）。
  // 記録のキーは会話の id（eg:answer の word に会話のデータをそのまま入れる）
  function startTalk(cardType) {
    var q = EG.questions.pickTalkQuestion();
    els.questionView.classList.add("talk-q");
    currentSpeechText = q.talk.line || null;
    // 相手のセリフが無い型（話しかける型）は、出題時に読むものが無いので🔊も押せない。答え合わせのあとに押せる
    setSpeakEnabled(!!q.talk.line);
    activeMode = EG.modeTalk;
    activeMode.start(q, els.body, {
      promptEl: els.prompt,
      onDone: function (result) {
        setSpeakEnabled(true);
        currentSpeechText = q.talk.answer; // 答え合わせのあとの🔊は正解の英文
        onAnswer(result, { cardType: cardType, mode: "talk", word: q.talk, direction: null });
      },
    });
    if (q.talk.line) {
      speakSoon(q.talk.line); // 相手のセリフを出題時に読む
    }
  }

  function startFill(cardType) {
    var word = EG.questions.pickWordForFill();
    els.prompt.textContent = word.ja;
    currentSpeechText = word.en;
    activeMode = EG.modeFill;
    activeMode.start(word, els.body, {
      onDone: function (result) {
        onAnswer(result, { cardType: cardType, mode: "fill", word: word, direction: null });
      },
    });
    speakSoon(word.en); // 出題時に自動で読む（タイピングと同じ）
  }

  function startMeaning(cardType) {
    var q = EG.questions.pickMeaningQuestion();
    els.prompt.textContent = q.direction === "en2ja" ? q.word.en : q.word.ja;
    currentSpeechText = q.word.en;
    activeMode = EG.modeMeaning;
    // 和→英は、答え合わせが終わるまで🔊を押せない（押すと答えが分かるため。熟語と同じ）
    setSpeakEnabled(q.direction !== "ja2en");
    activeMode.start(q, els.body, {
      onDone: function (result) {
        setSpeakEnabled(true);
        onAnswer(result, { cardType: cardType, mode: "meaning", word: q.word, direction: q.direction });
      },
    });
    if (q.direction === "en2ja") {
      speakSoon(q.word.en); // 英→和は出題時に読む。和→英は答え合わせで読む（onAnswer内）
    }
  }

  function startTyping(cardType) {
    var word = EG.questions.pickWordForTyping();
    els.prompt.textContent = word.ja;
    currentSpeechText = word.en;
    activeMode = EG.modeTyping;
    activeMode.start(word, els.body, {
      onDone: function (result) {
        onAnswer(result, { cardType: cardType, mode: "typing", word: word, direction: null });
      },
    });
    speakSoon(word.en); // 出題したときに自動で1回読む（選択音と重ならないよう少し遅らせる。Step10）
  }

  function startRearrange(cardType) {
    var word = EG.questions.pickWordForRearrange();
    els.prompt.textContent = word.ja;
    currentSpeechText = word.en;
    activeMode = EG.modeRearrange;
    activeMode.start(word, els.body, {
      onDone: function (result) {
        onAnswer(result, { cardType: cardType, mode: "arrange", word: word, direction: null });
      },
    });
    speakSoon(word.en); // Step10: 選択音と重ならないよう少し遅らせる
  }

  function startIdiom(cardType) {
    var q = EG.questions.pickIdiomQuestion();
    var promptText = q.direction === "en2ja" ? q.idiom.en : q.idiom.ja;
    els.prompt.textContent = promptText;
    currentSpeechText = q.idiom.en;
    activeMode = EG.modeIdiom;
    // 日→英は、答え合わせが終わるまで🔊を押せないようにする（押すと英語の答えが分かってしまうため。Step3の直し）
    setSpeakEnabled(q.direction !== "ja2en");
    activeMode.start(q, els.body, {
      onDone: function (result, detail) {
        setSpeakEnabled(true); // 答え合わせが終わったら、向きに関係なく押せるようにする
        onAnswer(result, { cardType: cardType, mode: "idiom", word: q.idiom, direction: q.direction });
      },
    });
    if (q.direction === "en2ja") {
      // 英→日は表示済みの英語を読むだけなのでネタバレにならない（Step10: 選択音と重ならないよう少し遅らせる）
      speakSoon(q.idiom.en);
    }
    // 日→英は出題時に読むと答えが分かってしまうため読まない（onAnswer内で答え合わせ時に読む）
  }

  // 正解したときの補充量。問題の種類ごとの指定（rewardByMode。意味4択・会話）があればそれ、なければ今までの量
  function rewardAmount(cardKey, mode) {
    var B = EG.balance;
    var res = CARD_RESOURCE[cardKey];
    var special = B.question.rewardByMode && B.question.rewardByMode[mode];
    if (special && special[res] !== undefined) {
      return special[res];
    }
    return res === "life" ? B.life.healOnCorrect : res === "shot" ? B.shot.healOnCorrect : B.bomb.healOnCorrect;
  }

  function applyReward(cardKey, mode) {
    var s = EG.state.data;
    var amount = rewardAmount(cardKey, mode);
    if (cardKey === 1) {
      s.life = Math.min(s.lifeMax, s.life + amount);
    } else if (cardKey === 2) {
      s.shot = Math.min(s.shotMax, s.shot + amount);
    } else if (cardKey === 3) {
      s.bomb = Math.min(s.bombMax, s.bomb + amount);
    }
    EG.hud.render();
  }

  function messageFor(result) {
    if (result === "correct") {
      return "⭕ 正解！"; // ⭕ 正解！
    }
    if (result === "pass") {
      return "PASS ― 正解を確認しよう"; // PASS ― 正解を確認しよう
    }
    return "❌ 不正解…"; // ❌ 不正解…
  }

  function onAnswer(result, info) {
    busy = true;
    answeredAt = Date.now();
    els.passBtn.style.display = "none";

    // クリア・ゲームオーバー画面の「今回の成績」用に数える（Step6）
    if (result === "correct") {
      EG.state.data.correctCount++;
    } else if (result === "incorrect") {
      EG.state.data.incorrectCount++;
    } else if (result === "pass") {
      EG.state.data.passCount++;
    }

    if (result === "correct") {
      applyReward(currentCardKey, info.mode);
    }

    // 日→英の熟語だけ、答え合わせのときに正解の英語を読む（DESIGN.md §4.1）
    // Step8: 熟語はどのカードにも出るので、資源ではなく問題の種類で判定する
    // Step10: この直後に結果音（correct/wrong/pass）も鳴るので、読み上げは少し遅らせて重なりを避ける
    if ((info.mode === "idiom" || info.mode === "meaning") && info.direction === "ja2en") {
      speakSoon(info.word.en);
    } else if (info.mode === "talk" || info.mode === "order") {
      speakSoon(info.word.answer); // 会話・語順は、答え合わせのときに正解の英文を読む（DESIGN.md §4.7・§4.8）
    }

    els.message.textContent = messageFor(result);
    els.message.className = "question-message result-" + result;

    if (EG.sounds) {
      // result: "correct"|"incorrect"|"pass" → 効果音の名前は"correct"|"wrong"|"pass"（Step9）
      EG.sounds.play(result === "incorrect" ? "wrong" : result);
    }

    EG.events.emit("eg:answer", {
      result: result,
      cardType: info.cardType,
      mode: info.mode,
      word: info.word,
      direction: info.direction,
    });

    // 1問答えたので、カードと問題の種類をシャッフルし直す（正解・間違い・PASSとも。DESIGN.md §4.0）
    shuffleCardModes();

    // 答えを見せる短い間をおいてから、カード選択に戻る（DESIGN.md §4.1）。
    // 正解は短く、間違い・PASSは正解を見て覚えられるよう少し長くする（Step7）
    // 会話は文が長いので、読む時間のぶん長めにする（balance.talk）
    var timing = info.mode === "talk" ? EG.balance.talk : info.mode === "order" ? EG.balance.order : EG.balance.question;
    var delayMs = result === "correct" ? timing.correctResultMs : timing.wrongResultMs;
    scheduleReturn(delayMs);
  }

  // カード選択に戻るまでの待ちタイマーを仕掛ける（一時停止での中断・再開もこの1本で扱う。Step7）
  function scheduleReturn(delayMs) {
    pendingReturnStartedAt = Date.now();
    pendingReturnDelayMs = delayMs;
    pendingReturnRemainingMs = null;
    pendingReturnTimer = setTimeout(function () {
      pendingReturnTimer = null;
      showCardSelect();
    }, delayMs);
  }

  // 待っている間（busy===true）に数字キーが押されたら、待たずにそのカードの次の問題へ進む（Step7）
  function skipWaitAndSelect(key) {
    if (isCardDisabled(key)) {
      return;
    }
    startQuestion(key);
  }

  // 一時停止に入るとき、カード選択に戻る待ちタイマーが動いていたら止めて残り時間を覚えておく（pause.jsから呼ぶ）
  function pauseTimers() {
    if (!pendingReturnTimer) {
      return;
    }
    clearTimeout(pendingReturnTimer);
    pendingReturnTimer = null;
    var elapsedMs = Date.now() - pendingReturnStartedAt;
    pendingReturnRemainingMs = Math.max(0, pendingReturnDelayMs - elapsedMs);
  }

  // 一時停止から再開するとき、止めておいた待ちタイマーを残り時間ぶんだけ再開する（pause.jsから呼ぶ）
  function resumeTimers() {
    if (pendingReturnRemainingMs === null) {
      return;
    }
    var remaining = pendingReturnRemainingMs;
    pendingReturnRemainingMs = null;
    scheduleReturn(remaining);
  }

  // 「スタート」「もう一度」で呼ぶ（Step6）。DOMのイベント登録はinit()で済んでいるので、
  // ここでは内部状態を最初の状態に戻し、入力ロックを解除するだけでよい
  function reset() {
    gameOverLocked = false;
    shuffleCardModes(); // ゲーム開始時にカードと問題の種類をシャッフルする（DESIGN.md §4.0）
    showCardSelect();
  }

  // canvas.jsの描画ループから毎フレーム呼ばれる（Step8）。今動いているモードに時間経過を伝える
  // （タイピングのお手本を消すタイマーなど）。一時停止中はcanvas.js側がそもそもこれ自体を呼ばないので、
  // ここでは何も気にしなくてよい（一時停止と自然に整合する）
  function update(dtSec) {
    if (activeMode && activeMode.update) {
      activeMode.update(dtSec);
    }
  }

  function onKeyDown(e) {
    if (EG.pause && EG.pause.isPaused()) {
      return; // 一時停止中はカード選択・解答・待ち時間スキップのキー入力をすべて受け付けない（Step7）
    }
    if (gameOverLocked) {
      return; // スタート前、ライフが0、または中ボスを倒した後は、カード選択・問題への入力を止める（Step4〜6）
    }
    if (EG.util.isDigitKey(e, "7") || EG.util.isDigitKey(e, "9")) {
      // 「7」（音のオン・オフ）と「9」（一時停止）は別のところ（sounds.js・pause.js）が扱う。
      // タイピング・並べ替えの「違うキー＝ミス」扱いにならないよう、ここで受け流す（Step11）
      return;
    }
    if (view === "cards") {
      if (busy) {
        return;
      }
      if (e.key >= "1" && e.key <= "3") {
        var key = Number(e.key);
        if (!isCardDisabled(key)) {
          e.preventDefault();
          selectCard(key); // 数字キーは押すだけで決定（Step7。Enter不要）
        }
        return;
      }
      return;
    }

    // view === "question"
    if (busy) {
      // 結果表示（答え合わせ）を待っている間。数字キーを押せば、待たずにそのカードの次の問題へ進める（Step7）
      if (e.key >= "1" && e.key <= "3") {
        var skipKey = Number(e.key);
        if (!isCardDisabled(skipKey)) {
          e.preventDefault();
          skipWaitAndSelect(skipKey);
        }
      }
      return;
    }
    if (e.key === "5") {
      // PASSをキーボードの「5」でもできるようにする（DESIGN.md §4.1 v0.5）。「p」は英単語を打つ文字と
      // ぶつかるので使わない。answer待ちのときだけ有効（busy中・一時停止中は上のガードで既に弾かれている）
      e.preventDefault();
      if (activeMode && activeMode.pass) {
        activeMode.pass();
      }
      return;
    }
    if (activeMode && activeMode.handleKey) {
      activeMode.handleKey(e);
    }
  }

  // ===== テスト（tools/test/survival_test.js）専用のデバッグ用入り口 =====
  // 実際のUI操作（つづりを打つ・タイルをはめる・選択肢を選ぶ）を行わずに、
  // 「指定したカードを選んで正解した」ことにする。startQuestion→onAnswer(correct)と全く同じ経路
  // （カードの資源に応じた補充・シャッフル・"eg:answer"発行）を通るので、本物の回答と同じ結果になる
  function debugAnswerCorrect(cardKey) {
    if (gameOverLocked || busy || view !== "cards" || isCardDisabled(cardKey) || (EG.pause && EG.pause.isPaused())) {
      return false;
    }
    currentCardKey = cardKey;
    var mode = cardModes[cardKey];
    var cardType = CARD_RESOURCE[cardKey];
    var word;
    if (mode === "order") {
      word = EG.questions.pickOrderQuestion().talk;
    } else if (mode === "talk") {
      word = EG.questions.pickTalkQuestion().talk;
    } else if (mode === "idiom") {
      word = EG.questions.pickIdiomQuestion().idiom;
    } else if (mode === "meaning") {
      word = EG.questions.pickMeaningQuestion().word;
    } else if (mode === "fill") {
      word = EG.questions.pickWordForFill();
    } else if (mode === "arrange") {
      word = EG.questions.pickWordForRearrange();
    } else {
      word = EG.questions.pickWordForTyping();
    }
    if (cardKey === 3) {
      EG.state.data.bombCardUsed++;
      render();
    }
    onAnswer("correct", { cardType: cardType, mode: mode, word: word, direction: null });
    return true;
  }

  return {
    init: init,
    render: render,
    reset: reset,
    update: update,
    pauseTimers: pauseTimers,
    resumeTimers: resumeTimers,
    isLocked: function () {
      return gameOverLocked;
    },
    debugAnswerCorrect: debugAnswerCorrect,
    setInputKind: setInputKind,
    // テスト用: カードの問題の種類を指定して固定する（次に答えるまで。答えるとまた重みで選び直す）
    debugSetCardModes: function (modes) {
      cardModes = { 1: modes[1], 2: modes[2], 3: modes[3] }; // 例 {1:"typing",2:"fill",3:"idiom"}
      renderCardModes();
    },
    // テスト用: 重みで選んだ3種類を返す（カードには割り当てない）
    debugPickCardModes: pickCardModes,
    getRewardAmount: rewardAmount,
  };
})();
