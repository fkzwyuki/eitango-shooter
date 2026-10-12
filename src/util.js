// util.js — 複数のファイルから使う小さな共通処理（シャッフル・HTMLエスケープなど）。

window.EG = window.EG || {};

EG.util = (function () {
  // 配列をシャッフルした新しい配列を返す（元の配列は変えない）
  function shuffle(list) {
    var arr = list.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  // 文字列をHTMLとして安全に埋め込めるようにエスケープする
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      switch (ch) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        case "'": return "&#39;";
        default: return ch;
      }
    });
  }

  // value を min〜max の範囲に収める
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // 押されたキーが数字 digit（"7"など。文字列）か。テンキーも同じ扱い。
  // e.codeも見るのは、日本語入力オンでe.keyが"Process"などになる場合の保険（Step11）
  function isDigitKey(e, digit) {
    return e.key === digit || e.code === "Digit" + digit || e.code === "Numpad" + digit;
  }

  // タップ（指が触れた瞬間 = pointerdown）に反応させる（Step21。DESIGN.md §3.3「入力のもっさり感をなくす」）。
  // 指を離したときの click を待たないので、反応が1拍速い。そのあとに来る click は二重反応にならないよう無視する。
  // キーボード操作（Enter でボタンを押す）やテストの el.click() のように pointerdown なしの click は、そのまま反応する。
  //   opts.touchOnly: true ならマウスは従来どおり click で反応する（並べ替えのタイルのドラッグ操作を壊さないため）
  //   opts.capture:   true なら捕捉フェーズで受ける（中の要素より先に呼びたいとき）
  var TAP_CLICK_GUARD_MS = 1500; // pointerdown から、この時間内に来た click を「同じタップの続き」とみなす

  // 「ゴーストクリック」対策: 指で触れた瞬間に画面が切り替わる（カードを押すと問題が出る、など）と、
  // 指を離したあとのタッチ由来の click が、新しく出た要素（指の真下の選択肢など）に届いてしまい、勝手に答えてしまう。
  // そこで、指が触れた瞬間に反応した場所（onTap）の近くで、そのすぐあとに来るタッチ由来の click は、まとめて捨てる。
  // マウスは押した場所と離した場所の共通の要素に click が届くので起きない（対象外）
  var GHOST_CLICK_MS = 1000;  // 指が触れてから、この時間内の click を捨てる
  var GHOST_CLICK_PX = 60;    // 触れた場所からこの距離内の click だけ捨てる
  var lastTouchTap = { t: -1e9, x: 0, y: 0 };
  document.addEventListener("click", function (e) {
    var pt = e.pointerType;
    if (!pt || pt === "mouse") {
      return; // el.click() など（pointerType なし）やマウスはそのまま通す
    }
    if (Date.now() - lastTouchTap.t < GHOST_CLICK_MS &&
        Math.abs(e.clientX - lastTouchTap.x) <= GHOST_CLICK_PX && Math.abs(e.clientY - lastTouchTap.y) <= GHOST_CLICK_PX) {
      lastTouchTap.t = -1e9;
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

  function onTap(el, handler, opts) {
    opts = opts || {};
    var downAt = -1e9;
    el.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && (opts.touchOnly || e.button !== 0)) {
        return;
      }
      downAt = Date.now();
      if (e.pointerType !== "mouse") {
        lastTouchTap = { t: downAt, x: e.clientX, y: e.clientY }; // このタップの click は捨てる（上のゴーストクリック対策）
      }
      handler(e);
    }, !!opts.capture);
    el.addEventListener("click", function (e) {
      if (Date.now() - downAt < TAP_CLICK_GUARD_MS) {
        downAt = -1e9; // 同じタップの click は1回だけ無視する
        return;
      }
      handler(e);
    }, !!opts.capture);
  }

  return { shuffle: shuffle, escapeHtml: escapeHtml, clamp: clamp, isDigitKey: isDigitKey, onTap: onTap };
})();
