// main.js — 起動処理。各部品（layout / canvas / hud / commands）を初期化して画面を組み立てる。

window.EG = window.EG || {};

(function () {
  function logWordCounts() {
    var words = window.WORDS || [];
    var wordCount = 0;
    var idiomCount = 0;
    for (var i = 0; i < words.length; i++) {
      if (words[i].type === "word") {
        wordCount++;
      } else if (words[i].type === "idiom") {
        idiomCount++;
      }
    }
    console.log(
      "単語データを読み込みました: 単語 " + wordCount +
      " / 熟語 " + idiomCount +
      " / 合計 " + words.length
    );
  }

  // ボタンをクリックすると、そのボタンにキーボードフォーカスが残る。すると、あとでスペースキー
  // （ボム。DESIGN.md §5.1）を押したとき、ブラウザの標準動作で「フォーカスの残ったボタンをもう一度
  // クリックしたことになる」ことがある（一時停止ボタンが典型: クリックして一時停止→スペースキーを
  // 押しただけのつもりが、ボタンが再クリックされて再開してしまう）。クリック直後にフォーカスを外して防ぐ（Step7）
  function preventStickyButtonFocus() {
    document.addEventListener("click", function (e) {
      // ボタンの中の絵文字・数字ヒント（span）をクリックした場合もボタン本体のフォーカスを外す（Step11）
      var btn = e.target && e.target.closest ? e.target.closest("button") : null;
      if (btn) {
        btn.blur();
      }
    });
  }

  // ホーム画面への追加用の最小の Service Worker（sw.js。何も保存しない）。http(s) で開いたときだけ（Phase 3 Step 18）
  function registerServiceWorker() {
    if (!/^https?:$/.test(location.protocol)) return;
    if (!navigator.serviceWorker || !navigator.serviceWorker.register) return;
    try {
      navigator.serviceWorker.register("sw.js").then(null, function () {});
    } catch (e) {}
  }

  function main() {
    logWordCounts();
    registerServiceWorker();

    // 画面の向き・タッチの判定を最初に（body のクラスを見る部品があるため。Phase 3 Step17）
    EG.layout.init(document.getElementById("game-container"));

    EG.questions.init();
    EG.speech.init();
    EG.sounds.init(); // 音（Step9）。ミュートボタン・7キー・最初の操作での解禁をここでセットアップする
    preventStickyButtonFocus();

    var canvasEl = document.getElementById("game-canvas");
    EG.canvas.init(canvasEl);
    EG.hud.init();
    EG.commands.init();
    // 「スタート」を押すまではゲームを動かさない（DESIGN.md §3.2、Step6）。
    // EG.battle.init() / EG.wave.init() / EG.canvas.start() は、タイトル画面の「スタート」または
    // 「もう一度」が押されたときにEG.screens.startGame()から呼ぶ（src/screens.js）
    EG.screens.init(canvasEl);
    EG.pause.init(); // 一時停止ボタン・Escキー（Step7）
  }

  document.addEventListener("DOMContentLoaded", main);
})();
