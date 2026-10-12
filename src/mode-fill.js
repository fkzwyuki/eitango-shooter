// mode-fill.js — 穴埋めモード（DESIGN.md §4.5、Phase3 Step16）。スマホでのタイピングの代わり。
// 日本語と、何文字か抜けたつづりが出る。抜けたところを左から順に、下の文字タイル（6つ）をタップ・クリック・
// キー入力で埋める。mode-rearrange.js を土台にしている（左から順に埋める・ミスで跳ね返る・全部埋まれば正解）。
// ミス上限・抜く数の区切り・タイルの数は balance.js の fill。ここには「どこを抜くか」「どの文字をまぎらわしいとするか」の表を置く。

window.EG = window.EG || {};

EG.modeFill = (function () {
  // ===== 表1: 抜く場所の優先順位（上ほど優先。DESIGN.md §4.5）=====
  // ① 重なった文字（apple の pp、letter の tt）… 同じ文字が2つ並ぶ所。並びのうち1つだけ抜く
  // ② 読まない文字 … 下の SILENT_PATTERNS の並びの、blank で示した文字（kn の k、wr の w、gh の g と h、語末 mb の b）
  // ③ 母音 … a e i o u
  // ④ ①〜③で数が足りないときだけ、残りの子音（頭文字以外）
  // どの段でも、候補の中からランダムに選ぶ（同じ単語でも毎回同じ所とは限らない）
  // ※頭文字は抜かないが、例外として語頭の kn の k・wr の w（knife, write）だけは抜いてよい（headOk。DESIGN.md §4.5 v0.10.1。
  //   いちばん書き忘れやすい所なので）
  var SILENT_PATTERNS = [
    { seq: "kn", blank: [0], atEnd: false, headOk: true }, // knife, know … k を読まない
    { seq: "wr", blank: [0], atEnd: false, headOk: true }, // write, wrong … w を読まない
    { seq: "gh", blank: [0, 1], atEnd: false }, // night, high … gh を読まない
    { seq: "mb", blank: [1], atEnd: true },  // climb, bomb … 語末の b を読まない
  ];
  var VOWELS = "aeiou";

  // ===== 表2: まぎらわしい文字の組（文字タイルの「おとり」に使う。DESIGN.md §4.5）=====
  // 同じ組の中の文字どうしは、おとりとして出やすい。足りなければランダムな文字で埋める
  var CONFUSABLE_GROUPS = [
    "aeiou", // 母音どうし
    "bd",    // b と d
    "bp",    // b と p
    "pq",    // p と q
    "rl",    // r と l
    "mn",    // m と n
    "cks",   // c・k・s
    "fv",    // f と v
    "gj",    // g と j
    "stz",   // s・t・z
    "uvw",   // u・v・w
    "hn",    // h と n
  ];

  var bodyEl = null;
  var word = null;
  var blanks = [];    // 抜いた文字の位置（小さい順）
  var tiles = [];     // { char: "e", used: false }（表示順はシャッフル済み）
  var filled = [];    // 埋めた文字（blanks と同じ順。未だなら null）
  var currentBlank = 0; // 次に埋める blanks の添字
  var misses = 0;
  var resolved = false;
  var onDone = null;
  var missLimit = 2;

  // 単語の長さから、抜く数を決める（4文字以下1・5〜7文字2・8文字以上3。balance.js の fill）
  function blankCountFor(len) {
    var F = EG.balance.fill;
    if (len <= F.shortMaxLen) {
      return F.shortBlanks;
    }
    if (len <= F.midMaxLen) {
      return F.midBlanks;
    }
    return F.longBlanks;
  }

  // 「重なった文字」の候補。同じ文字が続く並び（run）ごとに、頭文字以外の添字のグループを返す
  function doubledGroups(en) {
    var lower = en.toLowerCase();
    var groups = [];
    var i = 0;
    while (i < lower.length) {
      var j = i;
      while (j + 1 < lower.length && lower.charAt(j + 1) === lower.charAt(i)) {
        j++;
      }
      if (j > i) {
        var g = [];
        for (var k = i; k <= j; k++) {
          if (k > 0) {
            g.push(k); // 頭文字は抜かない
          }
        }
        if (g.length > 0) {
          groups.push(g);
        }
      }
      i = j + 1;
    }
    return groups;
  }

  // 「読まない文字」の候補（添字の配列。頭文字は除く。ただし headOk の並びが語頭にあるときは頭文字も入れる）
  function silentIndexes(en) {
    var lower = en.toLowerCase();
    var out = [];
    SILENT_PATTERNS.forEach(function (p) {
      var from = 0;
      while (true) {
        var at = lower.indexOf(p.seq, from);
        if (at < 0) {
          break;
        }
        from = at + 1;
        if (p.atEnd && at + p.seq.length !== lower.length) {
          continue;
        }
        p.blank.forEach(function (off) {
          var idx = at + off;
          if ((idx > 0 || p.headOk) && out.indexOf(idx) === -1) {
            out.push(idx);
          }
        });
      }
    });
    return out;
  }

  // 抜く場所を選ぶ。優先順位（重なった文字 → 読まない文字 → 母音 → 残りの文字）で、段ごとに候補をランダムに取る。
  // 返すのは添字を小さい順に並べた配列。頭文字（0番目）が入るのは語頭の kn・wr のときだけ
  function chooseBlanks(en, count) {
    var chosen = [];
    var want = Math.min(count, Math.max(0, en.length - 1));

    function takeFrom(list) {
      EG.util.shuffle(list).forEach(function (idx) {
        if (chosen.length < want && chosen.indexOf(idx) === -1) {
          chosen.push(idx);
        }
      });
    }

    // ① 重なった文字（並びごとに1つ）
    takeFrom(doubledGroups(en).map(function (g) { return g[Math.floor(Math.random() * g.length)]; }));
    // ② 読まない文字
    takeFrom(silentIndexes(en));
    // ③ 母音
    var vowels = [];
    var others = [];
    for (var i = 1; i < en.length; i++) {
      if (VOWELS.indexOf(en.charAt(i).toLowerCase()) >= 0) {
        vowels.push(i);
      } else {
        others.push(i);
      }
    }
    takeFrom(vowels);
    // ④ それでも足りなければ残りの文字
    takeFrom(others);

    chosen.sort(function (a, b) { return a - b; });
    return chosen;
  }

  // どの段の候補か（テスト・確認用）: "doubled" | "silent" | "vowel" | "other"
  function tierOf(en, idx) {
    if (doubledGroups(en).some(function (g) { return g.indexOf(idx) >= 0; })) {
      return "doubled";
    }
    if (silentIndexes(en).indexOf(idx) >= 0) {
      return "silent";
    }
    if (VOWELS.indexOf(en.charAt(idx).toLowerCase()) >= 0) {
      return "vowel";
    }
    return "other";
  }

  // 文字タイルを作る: 抜いた文字（正解）＋まぎらわしい文字（おとり）で tileCount 個。
  // おとりは、抜いた文字と同じ組の文字から選び、足りなければランダムな文字。おとりどうし・正解の文字とは重ならない
  function buildTileChars(en, blankIdx, tileCount) {
    var correct = blankIdx.map(function (i) { return en.charAt(i); });
    var taken = {};
    correct.forEach(function (c) { taken[c.toLowerCase()] = true; });
    var decoys = [];

    function addDecoy(ch) {
      var lc = ch.toLowerCase();
      if (taken[lc] || correct.length + decoys.length >= tileCount) {
        return;
      }
      taken[lc] = true;
      decoys.push(lc);
    }

    // 抜いた文字の「まぎらわしい組」から、組の文字をばらして入れる
    var pool = [];
    correct.forEach(function (c) {
      CONFUSABLE_GROUPS.forEach(function (g) {
        if (g.indexOf(c.toLowerCase()) >= 0) {
          g.split("").forEach(function (ch) { pool.push(ch); });
        }
      });
    });
    EG.util.shuffle(pool).forEach(addDecoy);
    // まだ足りなければランダムな文字
    EG.util.shuffle("abcdefghijklmnopqrstuvwxyz".split("")).forEach(addDecoy);
    return correct.concat(decoys);
  }

  function buildDom() {
    blanks = chooseBlanks(word.en, blankCountFor(word.en.length));
    var chars = buildTileChars(word.en, blanks, EG.balance.fill.tileCount);
    tiles = EG.util.shuffle(chars).map(function (c) { return { char: c, used: false }; });
    filled = blanks.map(function () { return null; });
    currentBlank = 0;
    misses = 0;
    resolved = false;

    var html = '<div class="slot-row fill-word">';
    for (var i = 0; i < word.en.length; i++) {
      if (blanks.indexOf(i) >= 0) {
        html += '<div class="slot blank" data-pos="' + i + '"></div>';
      } else {
        html += '<div class="slot known">' + EG.util.escapeHtml(word.en.charAt(i)) + "</div>";
      }
    }
    html += "</div>";

    html += '<div class="tile-tray fill-tiles">';
    tiles.forEach(function (t, i) {
      html += '<div class="tile fill-tile" data-tile-index="' + i + '">' + EG.util.escapeHtml(t.char) + "</div>";
    });
    html += "</div>";

    html += '<div class="miss-dots"></div>';
    return html;
  }

  function render() {
    var tileEls = bodyEl.querySelectorAll(".tile");
    tiles.forEach(function (t, i) {
      if (tileEls[i]) {
        tileEls[i].classList.toggle("used", t.used);
      }
    });
    blanks.forEach(function (pos, bi) {
      var el = bodyEl.querySelector('.slot[data-pos="' + pos + '"]');
      if (!el) {
        return;
      }
      el.classList.remove("current");
      if (filled[bi] !== null) {
        el.textContent = filled[bi];
        el.classList.add("filled");
      } else if (bi === currentBlank && !resolved) {
        el.classList.add("current");
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

  function flashEl(el) {
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

  // tileIndex のタイルを、今の抜き場所にはめようとする
  function attemptTile(tileIndex) {
    if (resolved) {
      return;
    }
    var tile = tiles[tileIndex];
    if (!tile || tile.used || currentBlank >= blanks.length) {
      return;
    }
    var expected = word.en.charAt(blanks[currentBlank]);
    if (tile.char.toLowerCase() === expected.toLowerCase()) {
      if (EG.sounds) {
        EG.sounds.play("type");
      }
      tile.used = true;
      filled[currentBlank] = expected; // 元の単語の大文字小文字で表示
      currentBlank++;
      render();
      if (currentBlank >= blanks.length) {
        finish("correct");
      }
    } else {
      if (EG.sounds) {
        EG.sounds.play("miss");
      }
      flashEl(bodyEl.querySelectorAll(".tile")[tileIndex]);
      registerMiss();
    }
  }

  // 失敗・PASSのとき、まだ埋まっていない所に正解を（オレンジで）見せる
  function reveal() {
    for (var bi = currentBlank; bi < blanks.length; bi++) {
      var el = bodyEl.querySelector('.slot[data-pos="' + blanks[bi] + '"]');
      if (el) {
        el.textContent = word.en.charAt(blanks[bi]);
        el.classList.remove("current");
        el.classList.add("revealed");
      }
    }
  }

  function finish(result) {
    resolved = true;
    if (result !== "correct") {
      reveal();
    }
    render();
    onDone(result, { misses: misses });
  }

  // 英字1文字キー: 今の抜き場所に合う未使用のタイルを自動で選んで置く。合わない文字はミス1回。
  // 数字などの文字以外のキーは、ミス上限が少ない（2回）ので無視する
  function handleKey(e) {
    if (resolved) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    var key = e.key;
    if (key === " ") {
      e.preventDefault(); // スペースはボム専用（battle.js側が扱う）。ミスに数えない
      return;
    }
    if (!key || key.length !== 1 || !/[A-Za-z]/.test(key)) {
      return;
    }
    e.preventDefault();
    if (currentBlank >= blanks.length) {
      return;
    }
    var expected = word.en.charAt(blanks[currentBlank]).toLowerCase();
    if (key.toLowerCase() === expected) {
      for (var i = 0; i < tiles.length; i++) {
        if (!tiles[i].used && tiles[i].char.toLowerCase() === expected) {
          attemptTile(i);
          return;
        }
      }
    } else {
      if (EG.sounds) {
        EG.sounds.play("miss");
      }
      flashEl(bodyEl.querySelector('.slot[data-pos="' + blanks[currentBlank] + '"]'));
      registerMiss();
    }
  }

  function attachEvents() {
    bodyEl.querySelectorAll(".tile").forEach(function (el, i) {
      EG.util.onTap(el, function () { attemptTile(i); }); // 指が触れた瞬間に反応（Step21）
    });
  }

  function start(w, body, callbacks) {
    word = w;
    bodyEl = body;
    onDone = callbacks.onDone;
    missLimit = EG.balance.fill.missLimit;
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

  return {
    start: start,
    handleKey: handleKey,
    pass: pass,
    // テスト・確認用の読み口
    blankCountFor: blankCountFor,
    chooseBlanks: chooseBlanks,
    tierOf: tierOf,
    buildTileChars: buildTileChars,
    getDebugState: function () {
      return { en: word && word.en, blanks: blanks.slice(), tiles: tiles.map(function (t) { return t.char; }), misses: misses };
    },
  };
})();
