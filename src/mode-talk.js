// mode-talk.js — 会話モード（DESIGN.md §4.7、Phase3 Step20 → Step21 で作り直し）。
// 場面（📍＋scene）と相手のセリフ（line。話しかける型では空）を出し、選択肢（3つ）を最初から出す。
// 読み上げは流れるが、答えは待たずにいつでも選べる。答えられるのは1回だけ（タップ・クリック・数字キー1〜3）。
// 答え合わせで正解を光らせ、訳（answer_ja）を見せる。間違えたときは、選んだ文の「なぜ合わないか」（why）も見せる。PASSも正解と訳だけ見せる。
// 正解の英文を読み上げるのは commands.js（onAnswer）。選択肢は questions.js の pickTalkQuestion() が作る。

window.EG = window.EG || {};

EG.modeTalk = (function () {
  var bodyEl = null;
  var promptEl = null;
  var talk = null;
  var options = []; // [{text, correct, why}, ...]
  var resolved = false;
  var onDone = null;

  function buildPromptHtml() {
    var html = '<div class="talk-scene">📍 ' + EG.util.escapeHtml(talk.scene) + "</div>";
    if (talk.line) {
      html += '<div class="talk-line">“' + EG.util.escapeHtml(talk.line) + "”</div>";
    }
    return html;
  }

  function buildBodyHtml() {
    var html = '<div class="talk-wrap">';
    html += '<div class="idiom-options talk-options">';
    options.forEach(function (opt, i) {
      html += '<div class="idiom-option" data-option-index="' + i + '">' +
        '<span class="option-number">' + (i + 1) + ".</span>" +
        '<span class="option-text">' + EG.util.escapeHtml(opt.text) + "</span></div>";
    });
    html += "</div></div>";
    html += '<div class="talk-feedback"></div>';
    return html;
  }

  function showFeedback(chosenIndex) {
    var fb = bodyEl.querySelector(".talk-feedback");
    if (!fb) {
      return;
    }
    var html = '<div class="talk-ja">' + EG.util.escapeHtml(talk.answer_ja) + "</div>";
    if (chosenIndex >= 0 && !options[chosenIndex].correct && options[chosenIndex].why) {
      html += '<div class="talk-why">選んだ文は…' + EG.util.escapeHtml(options[chosenIndex].why) + "</div>";
    }
    fb.innerHTML = html;
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
    showFeedback(chosenIndex);
  }

  function confirm(i) {
    if (resolved || i === null || i === undefined || i < 0 || i >= options.length) {
      return;
    }
    resolved = true;
    markResultStyles(i);
    onDone(options[i].correct ? "correct" : "incorrect", { chosenIndex: i });
  }

  // 数字キー(1〜3)を押すだけで答える（選択肢は最初から出ている）
  function handleKey(e) {
    if (resolved) {
      return;
    }
    if (e.key >= "1" && e.key <= "9") {
      var i = Number(e.key) - 1;
      if (i < options.length) {
        e.preventDefault();
        confirm(i);
      }
    }
  }

  function start(question, body, callbacks) {
    talk = question.talk;
    options = question.options;
    bodyEl = body;
    promptEl = callbacks.promptEl;
    onDone = callbacks.onDone;
    resolved = false;
    promptEl.innerHTML = buildPromptHtml();
    bodyEl.innerHTML = buildBodyHtml();
    bodyEl.querySelectorAll(".idiom-option").forEach(function (el, i) {
      EG.util.onTap(el, function () { confirm(i); }); // 指が触れた瞬間に答える
    });
  }

  // PASS: 正解と訳を見せる
  function pass() {
    if (resolved) {
      return;
    }
    resolved = true;
    markResultStyles(-1);
    onDone("pass", {});
  }

  return {
    start: start,
    handleKey: handleKey,
    pass: pass,
  };
})();
