// layout.js — 画面の向きに合わせた配置と、ブラウザの大きさに合わせた拡大・縮小（Phase 3 Step17。DESIGN.md §3.3）。
//
// ・横長（幅 >= 高さ）: 今までどおり 1280x720（16:9）を基準に、はみ出さないよう縮小・拡大して中央に置く。
// ・縦長（高さ > 幅）: 幅 720 を基準に拡大・縮小し、画面いっぱい（縦に長い端末なら縦にも伸ばす）に使う。
//   body に "portrait" クラスを付けて CSS（style.css）で配置を切り替え、シューティング（Canvas）の大きさも変える。
// ・タッチの機械かどうか: matchMedia('(pointer: coarse)') か URL の ?touch=1。body に "touch" クラスを付ける。
// 向きが変わったら（resize / orientationchange）その場で切り替わる。ゲーム中なら敵や弾の位置も新しい大きさに合わせ直す。

window.EG = window.EG || {};

EG.layout = (function () {
  var L = null;
  var container = null;
  var topEl = null;
  var canvasEl = null;
  var portrait = false;
  var touch = false;
  var coarseQuery = null;

  function detectTouch() {
    if (/[?&]touch=1(&|$)/.test(window.location.search)) {
      return true;
    }
    try {
      return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    } catch (e) {
      return false;
    }
  }

  // タッチ判定を反映する（body のクラス・出題の重みの組）
  function applyTouch() {
    touch = detectTouch();
    document.body.classList.toggle("touch", touch);
    if (EG.commands && EG.commands.setInputKind) {
      EG.commands.setInputKind(touch ? "touch" : "pc");
    }
  }

  function applySize(canvasW, canvasH, topH) {
    topEl.style.height = topH + "px";
    var changed = canvasEl.width !== canvasW || canvasEl.height !== canvasH;
    if (changed) {
      var oldW = canvasEl.width;
      var oldH = canvasEl.height;
      canvasEl.width = canvasW;
      canvasEl.height = canvasH;
      // 実行中の部品に新しい大きさを伝える（敵・弾・自機の位置を割合で移し替える）
      if (EG.canvas && EG.canvas.onResize) {
        EG.canvas.onResize(canvasW, canvasH);
      }
      if (EG.battle && EG.battle.onResize) {
        EG.battle.onResize(canvasW, canvasH, oldW, oldH);
      }
    }
  }

  function resize() {
    var iw = window.innerWidth;
    var ih = window.innerHeight;
    portrait = ih > iw;
    document.body.classList.toggle("portrait", portrait);

    var scale;
    var w;
    var h;
    var canvasW;
    var canvasH;
    var topH;
    if (portrait) {
      // 幅 720 を基準に、縦横どちらも画面にぴったり合わせる（縦に長い端末では縦にも伸ばす）
      scale = Math.min(iw / L.portraitWidth, ih / L.portraitHeight);
      w = Math.round(iw / scale);
      h = Math.round(ih / scale);
      topH = Math.round(h * L.portraitTopRatio);
      canvasW = w;
      canvasH = topH;
    } else {
      scale = Math.min(iw / L.landscapeWidth, ih / L.landscapeHeight);
      w = L.landscapeWidth;
      h = L.landscapeHeight;
      topH = L.landscapeCanvasHeight;
      canvasW = w;
      canvasH = topH;
    }
    container.style.width = w + "px";
    container.style.height = h + "px";
    container.style.transform = "scale(" + scale + ")";
    applySize(canvasW, canvasH, topH);
  }

  function init(containerEl) {
    L = EG.balance.layout;
    container = containerEl;
    topEl = document.getElementById("screen-top");
    canvasEl = document.getElementById("game-canvas");
    applyTouch();
    try {
      coarseQuery = window.matchMedia("(pointer: coarse)");
      if (coarseQuery.addEventListener) {
        coarseQuery.addEventListener("change", applyTouch);
      }
    } catch (e) {
      // 古いブラウザでは変化を見張らない（起動時の判定だけ）
    }
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    // 長押しのメニュー（コンテキストメニュー）はタッチの機械では出さない
    document.addEventListener("contextmenu", function (e) {
      if (touch) {
        e.preventDefault();
      }
    });
    resize();
  }

  return {
    init: init,
    resize: resize,
    isPortrait: function () { return portrait; },
    isTouch: function () { return touch; },
    BASE_WIDTH: 1280,
    BASE_HEIGHT: 720,
  };
})();
