// mode-idiom.js — ③ ボム＝熟語3択モード（DESIGN.md §4.4）。
// 英→日 または 日→英 の3択。数字キー（1〜3）を押すだけで決定、またはクリックで答える（Step7でEnter不要にした）。1回勝負。

window.EG = window.EG || {};

EG.modeIdiom = (function () {
  var bodyEl = null;
  var options = []; // [{text, correct}, ...]
  var direction = "en2ja";
  var resolved = false;
  var onDone = null;

  function buildDom() {
    var html = '<div class="idiom-options">';
    options.forEach(function (opt, i) {
      html += '<div class="idiom-option" data-option-index="' + i + '">' +
        '<span class="option-number">' + (i + 1) + ".</span>" +
        '<span class="option-text">' + EG.util.escapeHtml(opt.text) + "</span></div>";
    });
    html += "</div>";
    return html;
  }

  function markResultStyles(chosenIndex) {
    var optEls = bodyEl.querySelectorAll(".idiom-option");
    optEls.forEach(function (el, i) {
      el.classList.remove("armed");
      if (options[i].correct) {
        el.classList.add("correct");
      } else if (i === chosenIndex) {
        el.classList.add("incorrect");
      }
    });
  }

  function confirm(i) {
    if (resolved || i === null || i === undefined) {
      return;
    }
    if (i < 0 || i >= options.length) {
      return;
    }
    resolved = true;
    var chosen = options[i];
    markResultStyles(i);
    onDone(chosen.correct ? "correct" : "incorrect", { direction: direction, chosenIndex: i });
  }

  // 数字キー(1〜3)を押すだけで決定する（Step7。カード選択と同じ操作感にしている）
  function handleKey(e) {
    if (resolved) {
      return;
    }
    if (e.key >= "1" && e.key <= "3") {
      var i = Number(e.key) - 1;
      if (i < options.length) {
        e.preventDefault();
        confirm(i);
      }
    }
  }

  function attachEvents() {
    var optEls = bodyEl.querySelectorAll(".idiom-option");
    optEls.forEach(function (el, i) {
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

  // 熟語モードのPASS: 正解の選択肢だけ光らせて見せる
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
