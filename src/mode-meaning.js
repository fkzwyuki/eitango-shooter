// mode-meaning.js — 意味4択モード（DESIGN.md §4.6、Phase3 Step16）。mode-idiom.js を4択にしたもの。
// 英→和 または 和→英 の4択。数字キー（1〜4）を押すだけで決定、またはクリック・タップで答える。1回勝負。
// 選択肢（和→英ではつづりの似た語を混ぜる）は questions.js の pickMeaningQuestion() が作る。

window.EG = window.EG || {};

EG.modeMeaning = (function () {
  var bodyEl = null;
  var options = []; // [{text, correct}, ...]
  var direction = "en2ja";
  var resolved = false;
  var onDone = null;

  function buildDom() {
    var html = '<div class="idiom-options meaning-options">';
    options.forEach(function (opt, i) {
      html += '<div class="idiom-option" data-option-index="' + i + '">' +
        '<span class="option-number">' + (i + 1) + ".</span>" +
        '<span class="option-text">' + EG.util.escapeHtml(opt.text) + "</span></div>";
    });
    html += "</div>";
    return html;
  }

  function markResultStyles(chosenIndex) {
    bodyEl.querySelectorAll(".idiom-option").forEach(function (el, i) {
      el.classList.remove("armed");
      if (options[i].correct) {
        el.classList.add("correct");
      } else if (i === chosenIndex) {
        el.classList.add("incorrect");
      }
    });
  }

  function confirm(i) {
    if (resolved || i === null || i === undefined || i < 0 || i >= options.length) {
      return;
    }
    resolved = true;
    markResultStyles(i);
    onDone(options[i].correct ? "correct" : "incorrect", { direction: direction, chosenIndex: i });
  }

  // 数字キー(1〜4)を押すだけで決定する
  function handleKey(e) {
    if (resolved) {
      return;
    }
    if (e.key >= "1" && e.key <= "4") {
      var i = Number(e.key) - 1;
      if (i < options.length) {
        e.preventDefault();
        confirm(i);
      }
    }
  }

  function attachEvents() {
    bodyEl.querySelectorAll(".idiom-option").forEach(function (el, i) {
      EG.util.onTap(el, function () { confirm(i); }); // 指が触れた瞬間に決定（Step21）
    });
  }

  function start(question, body, callbacks) {
    options = question.options;
    direction = question.direction;
    bodyEl = body;
    resolved = false;
    onDone = callbacks.onDone;
    bodyEl.innerHTML = buildDom();
    attachEvents();
  }

  // PASS: 正解の選択肢だけ光らせて見せる
  function pass() {
    if (resolved) {
      return;
    }
    resolved = true;
    markResultStyles(-1);
    onDone("pass", { direction: direction });
  }

  return { start: start, handleKey: handleKey, pass: pass };
})();
