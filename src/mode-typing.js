// mode-typing.js — タイピングモード（DESIGN.md §4.2）。Step8からは①ライフ専用ではなく、
// カードと問題の種類がシャッフルされるので、どのカードからでも開くことがある（commands.jsがcardTypeを渡す）。
// お手本（つづり）は最初のbalance.typing.exampleRevealSec秒だけ見せて消す（Step8。DESIGN.md §4.2・§6.1）。
// 日本語の意味とお手本を見ながら、英単語を1文字ずつ打つ。大文字・小文字は区別しない。
// 違うキーは赤く光って進まない（ミス）。ミス3回で不正解。
// Step21: タッチの機械では問題の欄にゲーム内キーボード（QWERTY 3段）を出し、タップでも同じ判定で打てる。

window.EG = window.EG || {};

EG.modeTyping = (function () {
  var bodyEl = null;
  var word = null;
  var index = 0;
  var misses = 0;
  var resolved = false;
  var onDone = null;
  var missLimit = 3;
  var revealTimer = 0;       // お手本が見える残り時間（秒）。0以下になったら消す（Step8）
  var exampleHidden = false; // お手本をもう消したか

  function buildDom() {
    var html = "";
    html += '<div class="example-row">';
    for (var i = 0; i < word.en.length; i++) {
      html += '<span class="example-letter">' + EG.util.escapeHtml(word.en[i]) + "</span>";
    }
    html += "</div>";

    html += '<div class="input-row">';
    html += '<span class="cursor-mark">▷</span>'; // ▷
    for (var j = 0; j < word.en.length; j++) {
      html += '<span class="input-letter" data-index="' + j + '"></span>';
    }
    html += '<span class="cursor-mark">◁</span>'; // ◁
    html += "</div>";

    html += '<div class="miss-dots"></div>';
    if (useScreenKeyboard()) {
      html += buildKeyboardHtml();
    }
    return html;
  }

  // ===== ゲーム内キーボード（Step21。DESIGN.md §3.3 v0.11）=====
  // タッチの機械では、端末のキーボード（画面の半分を隠す）を出さず、問題の欄に QWERTY の3段キーボードを出す。
  // キーを押すと、PCのキー入力と同じ判定（handleKey）に流す。input にはフォーカスしない（端末のキーボードが出ないように）
  var KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

  function useScreenKeyboard() {
    return !!(EG.layout && EG.layout.isTouch && EG.layout.isTouch());
  }

  function buildKeyboardHtml() {
    var html = '<div class="kb">';
    KEY_ROWS.forEach(function (row) {
      html += '<div class="kb-row">';
      for (var i = 0; i < row.length; i++) {
        html += '<div class="kb-key" data-key="' + row[i] + '">' + row[i] + "</div>"; // 文字は小文字表示
      }
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  // 押したキーを一瞬光らせる
  function flashKey(keyEl) {
    keyEl.classList.add("kb-flash");
    setTimeout(function () {
      keyEl.classList.remove("kb-flash");
    }, EG.balance.layout.keyFlashMs);
  }

  // キーを押した（指が触れた）とき。PCのキー入力と同じ handleKey に渡す
  function pressScreenKey(ch) {
    handleKey({ key: ch, ctrlKey: false, metaKey: false, altKey: false, preventDefault: function () {} });
  }

  function attachKeyboard() {
    var kb = bodyEl.querySelector(".kb");
    if (!kb) {
      return;
    }
    EG.util.onTap(kb, function (e) {
      var keyEl = e.target && e.target.closest ? e.target.closest(".kb-key") : null;
      if (!keyEl || resolved) {
        return;
      }
      flashKey(keyEl);
      pressScreenKey(keyEl.getAttribute("data-key"));
    });
  }

  function render() {
    var letterEls = bodyEl.querySelectorAll(".input-letter");
    for (var i = 0; i < letterEls.length; i++) {
      var el = letterEls[i];
      el.classList.remove("filled", "current", "revealed");
      if (i < index) {
        el.textContent = word.en[i];
        el.classList.add("filled");
      } else if (i === index && !resolved) {
        el.classList.add("current");
        el.textContent = "";
      } else {
        el.textContent = "";
      }
    }
    renderMissDots();
  }

  function renderMissDots() {
    var el = bodyEl.querySelector(".miss-dots");
    if (!el) {
      return;
    }
    var s = "";
    for (var i = 0; i < missLimit; i++) {
      s += i < misses ? "●" : "○"; // ● / ○
    }
    el.textContent = "ミス " + s; // ミス ○○○
  }

  function flashWrong() {
    var letterEls = bodyEl.querySelectorAll(".input-letter");
    var el = letterEls[index];
    if (!el) {
      return;
    }
    el.classList.add("wrong-flash");
    setTimeout(function () {
      el.classList.remove("wrong-flash");
    }, EG.balance.question.wrongFlashMs);
  }

  function reveal() {
    var letterEls = bodyEl.querySelectorAll(".input-letter");
    for (var i = index; i < word.en.length; i++) {
      letterEls[i].textContent = word.en[i];
      letterEls[i].classList.add("revealed");
    }
  }

  // お手本を消し、文字数ぶんの"_"だけにする（DESIGN.md §4.2「最初の約1.5秒だけ見せて消す」）。
  // 打った文字（input-letter側）はここでは触らない
  function hideExample() {
    if (exampleHidden) {
      return;
    }
    exampleHidden = true;
    var letterEls = bodyEl.querySelectorAll(".example-letter");
    for (var i = 0; i < letterEls.length; i++) {
      letterEls[i].textContent = "_";
      letterEls[i].classList.add("example-hidden");
    }
  }

  // canvas.jsの描画ループ（EG.commands.update経由）から毎フレーム呼ばれる（Step8）。
  // 一時停止中はcanvas.js側がそもそもupdate自体を呼ばないので、ここでは何も気にしなくてよい
  // （一時停止で自然にお手本を消すタイマーも止まる。DESIGN.md「一時停止中は進まない」）
  function update(dtSec) {
    if (resolved || exampleHidden) {
      return;
    }
    revealTimer -= dtSec;
    if (revealTimer <= 0) {
      hideExample();
    }
  }

  function finish(result) {
    resolved = true;
    if (result !== "correct") {
      reveal();
    }
    onDone(result, { misses: misses });
  }

  // キー入力を1文字ずつ判定する。英字以外のキー（Enter・Backspace・矢印キーなど）は無視する
  function handleKey(e) {
    if (resolved) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    var key = e.key;
    if (key === " ") {
      // スペースキーはボム専用（Step4、DESIGN.md §5.1）。単語にスペースは含まれないので
      // 入力にもミスにも数えず、そのまま素通りさせてEG.battle側のボム判定に渡す
      e.preventDefault();
      return;
    }
    if (!key || key.length !== 1) {
      // 数字キーも1文字なのでここは通る。お手本の単語には数字は含まれないため、
      // 押しても「違うキー」としてミス扱いになるだけで、カード選択と衝突しない
      return;
    }
    e.preventDefault();
    var expected = word.en[index];
    if (key.toLowerCase() === expected.toLowerCase()) {
      if (EG.sounds) {
        EG.sounds.play("type"); // 正しい文字（Step9）
      }
      index++;
      render();
      if (index >= word.en.length) {
        finish("correct");
      }
    } else {
      if (EG.sounds) {
        EG.sounds.play("miss"); // 打ち間違い（Step9）
      }
      misses++;
      flashWrong();
      renderMissDots();
      if (misses >= missLimit) {
        finish("incorrect");
      }
    }
  }

  function start(w, body, callbacks) {
    word = w;
    bodyEl = body;
    index = 0;
    misses = 0;
    resolved = false;
    missLimit = EG.balance.life.missLimit;
    revealTimer = EG.balance.typing.exampleRevealSec; // お手本が見えている時間をリセット（Step8）
    exampleHidden = false;
    onDone = callbacks.onDone;
    bodyEl.innerHTML = buildDom();
    attachKeyboard();
    render();
  }

  function pass() {
    if (resolved) {
      return;
    }
    finish("pass");
  }

  // テスト（tools/test/play_test.js）用: お手本が消えたあとでも、画面のDOMを見ずに正解のつづりを
  // 読めるようにするデバッグ用の入り口（Step8。DESIGN.md「デバッグ用の読み口を用意してよい」）
  function getDebugWord() {
    return word ? word.en : null;
  }

  return { start: start, update: update, handleKey: handleKey, pass: pass, getDebugWord: getDebugWord };
})();
