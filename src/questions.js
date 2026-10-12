// questions.js — 出題する単語・熟語を選ぶ処理。
// DESIGN.md §8.1: 単語はタイピング（①）と並べ替え（②）に、熟語は③に使う。単語と熟語は別々に出題する。
// Step3の範囲: そのステージ（words の stage 列）の語だけからランダムに選ぶ（Phase2 Step14でStage1固定から変更）。
//   同じウェーブの中で、直近に出た単語・熟語が続けて出ないようにする
//   （直近いくつ避けるかは balance.js の question.recentAvoidCount）。
// 苦手な単語の優先出題・出た単語の記録（DESIGN.md §6.2〜§6.4）は Phase 3 の範囲なのでここでは扱わない。

window.EG = window.EG || {};

EG.questions = (function () {
  var wordPool = [];     // ①②で使う「単語」（type === "word"）
  var rearrangePool = []; // ②で使える単語（記号・スペースを含まない1語だけ。DESIGN.md §8.1）
  var idiomPool = [];    // ③で使う「熟語」（type === "idiom"）
  var fillPool = [];     // 穴埋めで使える単語（1語のつづりで、2文字以上。頭文字は抜かないので1文字語は使えない）
  var talkPool = [];     // 会話（window.TALKS）のうち、今のステージ以下のもの（DESIGN.md §4.7・§8.3）
  var orderPool = [];    // 語順で使える会話の文（talkPool のうち、単語数が balance.order.maxWords 以下のもの。DESIGN.md §4.8）
  var recentIds = [];    // 直近に出題したid（新しい方が末尾）
  var currentStage = 1;  // 今のステージ（意味4択で「近いステージ」を探すのに使う）

  // stage: 出題に使うステージ（省略したら1）。ステージを始めるたびに screens.js から呼び直す（Step14）。
  // 直近に出た問題の記録もここで空にする
  function init(stage) {
    var st = stage || 1;
    var all = window.WORDS || [];
    wordPool = all.filter(function (w) { return w.type === "word" && w.stage === st; });
    rearrangePool = wordPool.filter(function (w) { return /^[A-Za-z]+$/.test(w.en); });
    idiomPool = all.filter(function (w) { return w.type === "idiom" && w.stage === st; });
    fillPool = rearrangePool.filter(function (w) { return w.en.length >= 2; });
    // 会話は、今のステージ以下のものから出す（Stage3・4 でも Stage1・2 の会話が出る）。データが無ければ空
    talkPool = (window.TALKS || []).filter(function (t) { return t.stage <= st && t.answer; });
    orderPool = talkPool.filter(function (t) { return splitWords(t.answer).length <= EG.balance.order.maxWords; });
    recentIds = [];
    currentStage = st;
  }

  // そのステージが遊べるだけの語があるか（タイトル画面でStage2を選べるかどうかの判定。Step14）。
  // 単語はタイピングと並べ替え（1語のつづり）に使うので1語以上、熟語は3択（正解＋紛らわしくない2つ）を作るので3個以上いる。
  // 足りないときは「準備中」として灰色にするだけで、エラーにはしない
  // 英文をスペースで区切った単語に分ける（句読点・大文字はそのまま）
  function splitWords(sentence) {
    return String(sentence).split(/\s+/).filter(function (w) { return w.length > 0; });
  }

  function isStagePlayable(stage) {
    var all = window.WORDS || [];
    var words = 0;
    var idioms = 0;
    for (var i = 0; i < all.length; i++) {
      var w = all[i];
      if (w.stage !== stage) {
        continue;
      }
      if (w.type === "word" && /^[A-Za-z]+$/.test(w.en)) {
        words++;
      } else if (w.type === "idiom") {
        idioms++;
      }
    }
    return words >= 1 && idioms >= 3;
  }

  function pushRecent(id) {
    recentIds.push(id);
    var limit = EG.balance.question.recentAvoidCount;
    while (recentIds.length > limit) {
      recentIds.shift();
    }
  }

  // pool の中から、直近に出題していないものをランダムに1つ選ぶ
  // （避けた結果候補が0件になったら、直近避けを諦めてpool全体から選ぶ）
  function pickFrom(pool) {
    var candidates = pool.filter(function (w) { return recentIds.indexOf(w.id) === -1; });
    if (candidates.length === 0) {
      candidates = pool;
    }
    var picked = candidates[Math.floor(Math.random() * candidates.length)];
    pushRecent(picked.id);
    return picked;
  }

  // ① ライフ＝タイピング用の単語
  function pickWordForTyping() {
    return pickFrom(wordPool);
  }

  // ② ショット＝並べ替え用の単語
  function pickWordForRearrange() {
    return pickFrom(rearrangePool);
  }

  // ③ ボム＝熟語3択の問題一式（出題する熟語・向き・選択肢）を作る
  function pickIdiomQuestion() {
    var idiom = pickFrom(idiomPool);
    // 向き: 英→日 or 日→英 をランダムに決める（DESIGN.md §4.4）
    var direction = Math.random() < 0.5 ? "en2ja" : "ja2en";
    var field = direction === "en2ja" ? "ja" : "en"; // 選択肢に使う列

    var correctText = idiom[field];
    var distractors = [];
    var seen = {};
    seen[correctText] = true;

    // 同じStageの別の熟語から、同じ意味（同じ表示文言）が並ばないように2つ選ぶ
    EG.util.shuffle(idiomPool).forEach(function (w) {
      if (distractors.length >= 2 || w.id === idiom.id) {
        return;
      }
      var text = w[field];
      if (seen[text]) {
        return;
      }
      seen[text] = true;
      distractors.push(text);
    });
    // 理論上ここには来ないはず（熟語72個・重複ja/enなし）だが、念のためのフォールバック
    if (distractors.length < 2) {
      idiomPool.forEach(function (w) {
        if (distractors.length >= 2 || w.id === idiom.id) {
          return;
        }
        var text = w[field];
        if (text === correctText || distractors.indexOf(text) !== -1) {
          return;
        }
        distractors.push(text);
      });
    }

    var options = EG.util.shuffle([
      { text: correctText, correct: true },
      { text: distractors[0], correct: false },
      { text: distractors[1], correct: false },
    ]);

    return { idiom: idiom, direction: direction, options: options };
  }


  // 穴埋め用の単語
  function pickWordForFill() {
    return pickFrom(fillPool);
  }

  // 問題の種類 mode が今のステージで出せるか（commands.js がカードに割り当てる前に聞く）。
  // 足りないときはエラーにせず「出せない」と答えるだけ（DESIGN.md §4.0）。会話(talk)はデータができるまで常に false
  function canPick(mode) {
    switch (mode) {
      case "typing": return wordPool.length >= 1;
      case "arrange": return rearrangePool.length >= 1;
      case "fill": return fillPool.length >= 1;
      case "meaning": return wordPool.length >= 4;
      case "idiom": return idiomPool.length >= 3;
      case "talk": return talkPool.length >= 1;
      case "order": return orderPool.length >= 1;
      default: return false;
    }
  }

  // ---- 意味4択（DESIGN.md §4.6）----

  // 編集距離（a を b にするのに、1文字の入れ替え・足し・引きを何回するか）
  function editDistance(a, b) {
    var prev = [];
    var i;
    var j;
    for (j = 0; j <= b.length; j++) {
      prev[j] = j;
    }
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // つづりの近さの点数（大きいほど似ている）。頭の文字が同じ・最後の文字が同じ・編集距離が小さい・長さが近い、で決める
  function spellingScore(a, b) {
    var M = EG.balance.meaning;
    a = a.toLowerCase();
    b = b.toLowerCase();
    var score = 0;
    if (a.charAt(0) === b.charAt(0)) {
      score += M.sameFirstBonus;
    }
    if (a.charAt(a.length - 1) === b.charAt(b.length - 1)) {
      score += M.sameLastBonus;
    }
    score -= editDistance(a, b) * M.editDistancePenalty;
    score -= Math.abs(a.length - b.length) * M.lengthDiffPenalty;
    return score;
  }

  // 間違いの選択肢の候補にする単語（今のステージ → 近いステージの順に集める。足りないときだけ次のステージへ）
  function distractorCandidates(correct, need) {
    var all = (window.WORDS || []).filter(function (w) {
      return w.type === "word" && w.id !== correct.id && w.ja !== correct.ja && w.en.toLowerCase() !== correct.en.toLowerCase();
    });
    var same = all.filter(function (w) { return w.stage === currentStage; });
    if (same.length >= need) {
      return same;
    }
    // 足りない: 近いステージの語を足していく
    var rest = all.filter(function (w) { return w.stage !== currentStage; });
    rest.sort(function (a, b) { return Math.abs(a.stage - currentStage) - Math.abs(b.stage - currentStage); });
    return same.concat(rest);
  }

  // ⑤意味4択の問題一式（出題する単語・向き・選択肢）を作る。options は [{text, correct}]（熟語3択と同じ形）
  function pickMeaningQuestion() {
    var M = EG.balance.meaning;
    var word = pickFrom(wordPool);
    var direction = Math.random() < 0.5 ? "en2ja" : "ja2en";
    var field = direction === "en2ja" ? "ja" : "en";
    var wrongCount = M.optionCount - 1;
    var candidates = distractorCandidates(word, wrongCount * 2);
    var picked = [];
    var seen = {};
    seen[word[field]] = true;

    function take(list) {
      list.forEach(function (w) {
        if (picked.length >= wrongCount || seen[w[field]]) {
          return;
        }
        seen[w[field]] = true;
        picked.push(w);
      });
    }

    if (direction === "ja2en") {
      // つづりが近い順に並べ、上位 similarPoolSize 語の中からランダムに選ぶ（頭の文字・長さが近い語が混ざる。DESIGN.md §2.4・§4.6）
      var scored = candidates.map(function (w) { return { w: w, score: spellingScore(word.en, w.en) + Math.random() * 0.01 }; });
      scored.sort(function (a, b) { return b.score - a.score; });
      var top = scored.slice(0, Math.max(M.similarPoolSize, wrongCount)).map(function (x) { return x.w; });
      take(EG.util.shuffle(top));
      take(scored.map(function (x) { return x.w; })); // 重複で足りなければ次点から
    } else {
      take(EG.util.shuffle(candidates));
    }

    var options = [{ text: word[field], correct: true }];
    picked.forEach(function (w) {
      options.push({ text: w[field], correct: false });
    });
    return { word: word, direction: direction, options: EG.util.shuffle(options) };
  }

  // ⑥会話の問題一式を作る。options は [{text, correct, why}]（正解1つ＋間違い。why は間違いの理由）。
  // 選択肢の数は balance.talk.optionCount（3つ。v0.11）。間違いは wrong1〜3 から毎回ランダムに選び、全体をシャッフルする
  function pickTalkQuestion() {
    var talk = pickFrom(talkPool);
    var wrongs = [];
    var seen = {};
    seen[talk.answer] = true;
    [1, 2, 3].forEach(function (n) {
      var text = talk["wrong" + n];
      if (text && !seen[text]) {
        seen[text] = true;
        wrongs.push({ text: text, correct: false, why: talk["why" + n] || "" });
      }
    });
    var wrongCount = Math.max(1, EG.balance.talk.optionCount - 1);
    var options = [{ text: talk.answer, correct: true, why: "" }].concat(EG.util.shuffle(wrongs).slice(0, wrongCount));
    return { talk: talk, options: EG.util.shuffle(options) };
  }

  // ⑦語順の問題。会話のデータの正解の文（answer）を単語に分け、シャッフルしたタイルを返す。
  // words=正しい順、tiles=シャッフル済み（元の順と同じ並びになったら混ぜ直す）。直近に出した文は避ける
  function pickOrderQuestion() {
    var talk = pickFrom(orderPool);
    var words = splitWords(talk.answer);
    var tiles = EG.util.shuffle(words);
    for (var i = 0; i < EG.balance.order.shuffleRetry && tiles.join(" ") === words.join(" ") && words.length > 1; i++) {
      tiles = EG.util.shuffle(words);
    }
    return { talk: talk, words: words, tiles: tiles };
  }

  return {
    init: init,
    pickOrderQuestion: pickOrderQuestion,
    pickTalkQuestion: pickTalkQuestion,
    pickWordForFill: pickWordForFill,
    pickMeaningQuestion: pickMeaningQuestion,
    canPick: canPick,
    spellingScore: spellingScore,
    editDistance: editDistance,
    isStagePlayable: isStagePlayable,
    pickWordForTyping: pickWordForTyping,
    pickWordForRearrange: pickWordForRearrange,
    pickIdiomQuestion: pickIdiomQuestion,
  };
})();
