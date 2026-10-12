// mode-rearrange.js — ② ショット＝並べ替えモード（DESIGN.md §4.3）。
// バラバラになった文字タイルを、左から順にはめこんでいく。
// クリック・ドラッグ＆ドロップ・キーボード入力のどれでも操作できる。
// 同じ文字が複数あるときは、どのタイルを選んでも「正しい位置なら」受け付ける。
// タイルは元の単語の文字のまま表示する（例: Monday の M は大文字のまま）。

window.EG = window.EG || {};

EG.modeRearrange = (function () {
  var bodyEl = null;
  var word = null;
  var tiles = [];   // { char: "b", used: false } の配列（表示順はシャッフル済み）
  var slots = [];   // 埋まった文字（原文の大文字小文字のまま）。未使用は null
  var currentSlot = 0;
  var misses = 0;
  var resolved = false;
  var onDone = null;
  var missLimit = 3;

  function buildDom() {
    var order = EG.util.shuffle(word.en.split("").map(function (ch, i) { return i; }));
    tiles = order.map(function (letterIndex) {
      return { char: word.en[letterIndex], used: false };
    });
    slots = word.en.split("").map(function () { return null; });
    currentSlot = 0;
    misses = 0;
    resolved = false;

    var html = "";
    html += '<div class="tile-tray">';
    tiles.forEach(function (t, i) {
      html += '<div class="tile" draggable="true" data-tile-index="' + i + '">' +
        EG.util.escapeHtml(t.char) + "</div>";
    });
    html += "</div>";

    html += '<div class="slot-row">';
    for (var i = 0; i < word.en.length; i++) {
      html += '<div class="slot" data-slot-index="' + i + '"></div>';
    }
    html += "</div>";

    html += '<div class="miss-dots"></div>';
    return html;
  }

  function render() {
    var tileEls = bodyEl.querySelectorAll(".tile");
    tiles.forEach(function (t, i) {
      var el = tileEls[i];
      if (!el) {
        return;
      }
      el.classList.toggle("used", t.used);
    });

    var slotEls = bodyEl.querySelectorAll(".slot");
    slots.forEach(function (ch, i) {
      var el = slotEls[i];
      if (!el) {
        return;
      }
      el.classList.remove("current", "revealed");
      if (ch !== null) {
        el.textContent = ch;
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
      s += i < misses ? "●" : "○"; // ● / ○
    }
    el.textContent = "ミス " + s; // ミス ○○○
  }

  function flashTileWrong(tileIndex) {
    var tileEls = bodyEl.querySelectorAll(".tile");
    var el = tileEls[tileIndex];
    if (!el) {
      return;
    }
    el.classList.add("wrong-flash");
    setTimeout(function () {
      el.classList.remove("wrong-flash");
    }, EG.balance.question.wrongFlashMs);
  }

  function flashSlotWrong() {
    var slotEls = bodyEl.querySelectorAll(".slot");
    var el = slotEls[currentSlot];
    if (!el) {
      return;
    }
    el.classList.add("wrong-flash");
    setTimeout(function () {
      el.classList.remove("wrong-flash");
    }, EG.balance.question.wrongFlashMs);
  }

  function registerMiss() {
    misses++;
    renderMissDots();
    if (misses >= missLimit) {
      finish("incorrect");
    }
  }

  // tileIndex のタイルを、今アクティブな枠（currentSlot）にはめようとする
  function attemptTile(tileIndex) {
    if (resolved) {
      return;
    }
    var tile = tiles[tileIndex];
    if (!tile || tile.used) {
      return;
    }
    if (currentSlot >= word.en.length) {
      return;
    }
    var expected = word.en[currentSlot];
    if (tile.char.toLowerCase() === expected.toLowerCase()) {
      if (EG.sounds) {
        EG.sounds.play("type"); // 正しい文字（Step9）
      }
      tile.used = true;
      slots[currentSlot] = expected; // 元の単語の大文字小文字で表示
      currentSlot++;
      render();
      if (currentSlot >= word.en.length) {
        finish("correct");
      }
    } else {
      if (EG.sounds) {
        EG.sounds.play("miss"); // タイルが跳ね返る（Step9）
      }
      flashTileWrong(tileIndex);
      registerMiss();
    }
  }

  function reveal() {
    for (var i = currentSlot; i < word.en.length; i++) {
      slots[i] = word.en[i];
    }
    render();
    var slotEls = bodyEl.querySelectorAll(".slot");
    for (var j = currentSlot; j < word.en.length; j++) {
      if (slotEls[j]) {
        slotEls[j].classList.add("revealed");
      }
    }
  }

  function finish(result) {
    resolved = true;
    if (result !== "correct") {
      reveal();
    }
    onDone(result, { misses: misses });
  }

  // 英字1文字キーで、今アクティブな枠に合うタイルを自動で選んで置く
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
      return;
    }
    e.preventDefault();
    if (currentSlot >= word.en.length) {
      return;
    }
    var expected = word.en[currentSlot];
    if (key.toLowerCase() === expected.toLowerCase()) {
      var idx = -1;
      for (var i = 0; i < tiles.length; i++) {
        if (!tiles[i].used && tiles[i].char.toLowerCase() === expected.toLowerCase()) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        attemptTile(idx);
      }
    } else {
      // 数字キーもここに来るが、並べ替え対象の単語は英字だけなので
      // 「違うキー」としてミス扱いになるだけで、カード選択と衝突しない
      if (EG.sounds) {
        EG.sounds.play("miss"); // 違うキー（Step9）
      }
      flashSlotWrong();
      registerMiss();
    }
  }

  function attachEvents() {
    var tileEls = bodyEl.querySelectorAll(".tile");
    tileEls.forEach(function (el, i) {
      // タッチは指が触れた瞬間に反応（Step21）。マウスは従来どおり click（ドラッグ＆ドロップと両立させるため）
      EG.util.onTap(el, function () { attemptTile(i); }, { touchOnly: true });
      if (EG.layout && EG.layout.isTouch()) {
        el.draggable = false; // タッチの機械ではタップだけで入れる（長押しでドラッグが始まらないように）
      }
      el.addEventListener("dragstart", function (ev) {
        if (tiles[i].used) {
          ev.preventDefault();
          return;
        }
        ev.dataTransfer.setData("text/plain", String(i));
        ev.dataTransfer.effectAllowed = "move";
      });
    });

    // ドロップ先は「はめこみパネル」全体。左から順に埋める仕様なので、
    // どこに落としても今アクティブな枠に対して判定する
    bodyEl.addEventListener("dragover", function (ev) {
      ev.preventDefault();
    });
    bodyEl.addEventListener("drop", function (ev) {
      ev.preventDefault();
      var idxStr = ev.dataTransfer.getData("text/plain");
      var idx = parseInt(idxStr, 10);
      if (!isNaN(idx)) {
        attemptTile(idx);
      }
    });
  }

  function start(w, body, callbacks) {
    word = w;
    bodyEl = body;
    onDone = callbacks.onDone;
    missLimit = EG.balance.shot.missLimit;
    bodyEl.innerHTML = buildDom();
    attachEvents();
    render();
  }

  function pass() {
    if (resolved) {
      return;
    }
    finish("pass");
  }

  return { start: start, handleKey: handleKey, pass: pass };
})();
