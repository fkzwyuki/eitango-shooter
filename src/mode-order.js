// mode-order.js — 語順モード（DESIGN.md §4.8、Phase3 Step22）。
// 日本語の訳（answer_ja）を見て、バラバラになった英語の単語タイルを、左から順に正しい語順で入れていく。
// 並べ替えモード（mode-rearrange.js）の「単語版」。文は会話のデータ（window.TALKS）の answer を使う。
// タップ・クリックは「触れた瞬間」に反応する（EG.util.onTap。Step21）。PC でもキー操作は無し（クリックのみ）。
// 違う単語のタイルは跳ね返る（ミス1回、赤く揺れる）。ミス balance.order.missLimit 回で不正解。
// 同じ単語のタイルが2つあれば、どちらを押してもよい（文字が同じなら正しい単語として受け付ける）。
// 答えたあとの英文の読み上げは commands.js（onAnswer）。出題時は読まない（答えが分かってしまうため）。

window.EG = window.EG || {};

EG.modeOrder = (function () {
  var bodyEl = null;
  var question = null;   // { talk, words, tiles }
  var tiles = [];        // { text, used } の配列（表示順はシャッフル済み）
  var slots = [];        // 埋まった単語。未使用は null
  var currentSlot = 0;
  var misses = 0;
  var resolved = false;
  var onDone = null;
  var missLimit = 3;

  function buildDom() {
    tiles = question.tiles.map(function (t) { return { text: t, used: false }; });
    slots = question.words.map(function () { return null; });
    currentSlot = 0;
    misses = 0;
    resolved = false;

    var html = '<div class="order-wrap">';
    html += '<div class="order-slots">';
    question.words.forEach(function (w, i) {
      html += '<div class="order-slot" data-slot-index="' + i + '"></div>';
    });
    html += "</div>";
    html += '<div class="order-tiles">';
    tiles.forEach(function (t, i) {
      html += '<div class="order-tile" data-tile-index="' + i + '">' + EG.util.escapeHtml(t.text) + "</div>";
    });
    html += "</div>";
    html += '<div class="miss-dots"></div>';
    html += "</div>";
    return html;
  }

  function render() {
    var tileEls = bodyEl.querySelectorAll(".order-tile");
    tiles.forEach(function (t, i) {
      if (tileEls[i]) {
        tileEls[i].classList.toggle("used", t.used);
      }
    });
    var slotEls = bodyEl.querySelectorAll(".order-slot");
    slots.forEach(function (w, i) {
      var el = slotEls[i];
      if (!el) {
        return;
      }
      el.classList.remove("current");
      if (w !== null) {
        el.textContent = w;
        el.classList.add("filled");
      } else {
        el.textContent = "";
        el.classList.remove("filled");
        if (i === currentSlot && !resolved) {
          el.classList.add("current");
        }
      }
    });
    renderMissDots();
  }

  function renderMissDots() {
    var el = bodyEl.querySelector(".miss-dots");
    if (!el) {
      return;
    }
    var s = "";
    for (var i = 0; i < missLimit; i++) {
      s += i < misses ? "●" : "○";
    }
    el.textContent = "ミス " + s;
  }

  function flashTileWrong(tileIndex) {
    var el = bodyEl.querySelectorAll(".order-tile")[tileIndex];
    if (!el) {
      return;
    }
    el.classList.add("wrong-flash");
    setTimeout(function () {
      el.classList.remove("wrong-flash");
    }, EG.balance.question.wrongFlashMs);
  }

  // tileIndex のタイルを、今の枠（currentSlot）に入れようとする
  function attemptTile(tileIndex) {
    if (resolved) {
      return;
    }
    var tile = tiles[tileIndex];
    if (!tile || tile.used || currentSlot >= question.words.length) {
      return;
    }
    if (tile.text === question.words[currentSlot]) {
      if (EG.sounds) {
        EG.sounds.play("type"); // 正しい単語
      }
      tile.used = true;
      slots[currentSlot] = tile.text;
      currentSlot++;
      render();
      if (currentSlot >= question.words.length) {
        finish("correct");
      }
    } else {
      if (EG.sounds) {
        EG.sounds.play("miss"); // 跳ね返る
      }
      flashTileWrong(tileIndex);
      misses++;
      renderMissDots();
      if (misses >= missLimit) {
        finish("incorrect");
      }
    }
  }

  // 不正解・PASS のとき、残りの枠に正しい単語を入れて（オレンジ色で）正解の英文を見せる
  function reveal() {
    var slotEls = bodyEl.querySelectorAll(".order-slot");
    for (var i = currentSlot; i < question.words.length; i++) {
      slots[i] = question.words[i];
    }
    render();
    for (var j = currentSlot; j < question.words.length; j++) {
      if (slotEls[j]) {
        slotEls[j].classList.add("revealed");
      }
    }
    bodyEl.querySelectorAll(".order-tile").forEach(function (el) {
      el.classList.add("used");
    });
  }

  function finish(result) {
    resolved = true;
    if (result !== "correct") {
      reveal();
    } else {
      render();
    }
    onDone(result, { misses: misses });
  }

  function start(q, body, callbacks) {
    question = q;
    bodyEl = body;
    onDone = callbacks.onDone;
    missLimit = EG.balance.order.missLimit;
    bodyEl.innerHTML = buildDom();
    bodyEl.querySelectorAll(".order-tile").forEach(function (el, i) {
      EG.util.onTap(el, function () { attemptTile(i); });
    });
    render();
  }

  // PCでもキー操作は無し（クリックのみ）。数字キー・スペースは commands.js / battle.js が扱う
  function handleKey() {}

  function pass() {
    if (resolved) {
      return;
    }
    finish("pass");
  }

  // テスト用: 今の状態
  function getDebugState() {
    return { words: question.words.slice(), tiles: tiles.map(function (t) { return t.text; }), currentSlot: currentSlot, misses: misses };
  }

  return { start: start, handleKey: handleKey, pass: pass, getDebugState: getDebugState };
})();
