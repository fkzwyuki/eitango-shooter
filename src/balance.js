// balance.js — 調整用の数字をぜんぶここに集める場所。
// ここを書き換えるだけで、ゲームの中身（プログラム）を読まなくても難しさを変えられる（DESIGN.md §2.3）。
// 先のStepで出てくる数字も、このファイルに追加していく。
//
// ── よく触りそうな数字（目印）────────────────────────────────
//   life.healOnCorrect        … ①正解でライフが回復する量
//   life.hitIntervalSec       … 被弾する間隔（画面がふつうの混み具合のときの目安。秒）
//   shot.consumeIntervalSec   … ショットが1発分減る間隔。Step8で大きく短縮した
//   battle.shotEmptyHitIntervalMultiplier … 弾切れの間、被弾間隔に掛ける倍率（Step8）
//   typing.exampleRevealSec   … タイピングのお手本が見えている時間（Step8）
//   question.correctResultMs / wrongResultMs … 答えたあと、カード選択に戻るまでの待ち時間（Step7で短縮）
//   mass.easy.waveTimeSec     … 通常ウェーブ（易しい道）の制限時間（WAVE1・WAVE2とも同じ）
//   wave.wave2SpawnRateMultiplier … WAVE2の敵の出現ペースの倍率（Step14）
//   mass.easy.minibossHp      … 中ボスの体力（易しい道）
//   battle.normalCongestion   … 通常ウェーブの「画面の混み具合」の基準値。被弾間隔の計算の元になる
//   battle.player*            … 自機の自由な動き回り（Step7）
//   battle.miniboss 以下      … 中ボス戦のザコの出方・弾・体力バーまわり
//   banner 以下                … STAGE/WAVE/WARNING などスライド演出の長さ・派手さ（Step7、Step8で強化）
//   screens 以下              … クリア／ゲームオーバー画面を出すまでの間
//   sound 以下                … BGM・効果音の音量、フェード秒数、鳴らしすぎない間引き（Step9）
// ─────────────────────────────────────────────────────────

window.EG = window.EG || {};

EG.balance = {
  // ライフ（① タイピングで回復。DESIGN.md §5.2）
  life: {
    max: 20,            // ライフの最大目盛り数
    initial: 20,         // ウェーブ開始時のライフ（満タンから始める）
    hitDamage: 1,         // 被弾1回で減る目盛り数
    hitIntervalSec: 3.5,  // 被弾する間隔（秒）。画面の混み具合が「ふつう」のときの目安。
                           // Phase3 v0.12.1: 3→3.5（Androidで遊んで「ちょっと余裕がなくてつらい」。約17%ゆるく）
                           // Step7: 5→4（1回目のプレイで「ライフに余裕があって危機感がない」）。
                           // Step8: 4→3（2回目のプレイで「もっと急激でいい」。DESIGN.md §5.2・§5.3）
    healOnCorrect: 3,     // ①ライフの問題に正解したときに回復する目盛り数。Step7: 4→3（同上。Step8も3のまま）
    missLimit: 5,         // ①タイピングで何回ミスしたら不正解になるか（DESIGN.md §4.2）。Phase2: 3→5（プレイで「キーボードのずれでタタタッと打ってしまう」）
  },

  // ショット（② 並べ替えで回復。DESIGN.md §5.2）
  shot: {
    max: 30,             // ショットの最大発数
    initial: 30,          // ウェーブ開始時のショット（満タンから始める）
    consumeIntervalSec: 1.5, // 撃っている間、何秒で1発分減るか。Step8: 4→1.5（約45秒で空になる。
                              // 2回目のプレイで「ショットを選ぶ理由がない」。DESIGN.md §5.2・§5.3）
    healOnCorrect: 8,     // ②ショットの問題に正解したときに増える発数。Step8: 5→8（同上）
    missLimit: 5,         // ②並べ替えで何回ミスしたら不正解になるか（DESIGN.md §4.3）。Phase2: 3→5（①と揃える）
  },

  // ボム（③ 熟語で回復。DESIGN.md §4.4、§5.2）
  bomb: {
    max: 5,              // ボムの最大個数
    initial: 2,           // ウェーブ開始時のボム個数
    healOnCorrect: 1,     // ③ボムの問題に正解したときに増える個数
    cardLimitPerWave: 2,  // ③ボムのカードは1ウェーブに何回まで選べるか
  },

  // 出題まわり共通の数字（DESIGN.md §4.1、§6.3）
  question: {
    recentAvoidCount: 6,   // 直近何問ぶんは同じ単語・熟語を出題しないか
    correctResultMs: 600,  // 正解したとき、結果を見せてからカード選択に戻るまでの時間（ミリ秒）。
                            // Step7: 「もっさりする」ため短縮（DESIGN.md §4.1）。待っている間に数字キーを押すと、
                            // 待たずにそのカードの次の問題へ進める（src/commands.js）
    wrongResultMs: 1400,   // 間違い・PASSのとき、正解を見せてからカード選択に戻るまでの時間（ミリ秒）。
                            // 正解を見て覚えられるよう、正解のときより長めにしてある
    wrongFlashMs: 220,     // タイピング・並べ替えで違うキーを押したときの赤い光の表示時間（ミリ秒）

    // 問題の種類ごとの「カードへの入りやすさ」（重み。大きいほど入りやすい。DESIGN.md §4.0 の表。Phase3 Step16）。
    // 3枚のカードには、この重みで重なりなく3種類を選んで割り当てる。pc=キーボードの機械、touch=スマホ・タブレット
    // （タッチかどうかの判定は layout.js）。0にすると、その機械では出ない。
    // Step21（v0.11）: 穴埋め(fill)は難しすぎるので0（コードは残す）
    // Step22（v0.12）: スマホはタイピング(typing)を0にした（ゲーム内キーボードは難しかった。コードは残す）。
    //   スマホのつづりの練習は並べ替え(arrange)だけなので重み2。語順(order)は PC・スマホとも1
    modeWeights: {
      pc:    { typing: 2, arrange: 1, fill: 0, meaning: 1, idiom: 1, talk: 1, order: 1 },
      touch: { typing: 0, arrange: 2, fill: 0, meaning: 1, idiom: 1, talk: 1, order: 1 },
    },

    // 答えたあとの結果表示中、すぐ次へ飛ばすタップ（問題の欄をタップ）を無視する時間（ミリ秒）。
    // 答えを押した指の「続けてもう1回」で結果を見ずに飛ばしてしまうのを防ぐ（Step21）
    resultSkipGuardMs: 150,

    // 正解したときの補充量を、問題の種類ごとに変えたいときだけ書く（書いていない種類は
    // life/shot/bomb の healOnCorrect を使う。DESIGN.md §4.0 の表）。
    // 意味4択は見て選ぶだけなので少なめ、会話は読む量が多いので多め
    rewardByMode: {
      meaning: { life: 2, shot: 5, bomb: 1 },
      talk:    { life: 3, shot: 8, bomb: 1 },  // v0.11.1: 2択にしたので多めをやめた
      order:   { life: 3, shot: 8, bomb: 1 },  // v0.12: 語順。ふつうの量
    },
  },

  // ④穴埋めモード（DESIGN.md §4.5、Phase3 Step16）
  fill: {
    missLimit: 2,         // 何回ミスしたら不正解になるか（タイルが少ないので当てずっぽう防止に少なめ）
    tileCount: 6,         // 文字タイルの数（正解の文字＋まぎらわしい文字）
    shortMaxLen: 4,       // この文字数以下の単語は
    shortBlanks: 1,       //   抜く文字が1つ
    midMaxLen: 7,         // この文字数以下（shortMaxLenより長い）の単語は
    midBlanks: 2,         //   抜く文字が2つ
    longBlanks: 3,        // それより長い単語は抜く文字が3つ（頭文字は抜かない）
  },

  // ⑤意味4択モード（DESIGN.md §4.6、Phase3 Step16）
  meaning: {
    optionCount: 4,       // 選択肢の数
    similarPoolSize: 6,   // 和→英で、つづりが近い順の上位何語から間違いの選択肢を選ぶか（毎回同じ語にならないよう幅を持たせる）
    sameFirstBonus: 3,    // つづりの近さの点数: 頭の文字が同じなら加点
    sameLastBonus: 1,     // 最後の文字が同じなら加点
    editDistancePenalty: 1, // 編集距離（文字を入れ替え・足し引きする回数）1回につき減点
    lengthDiffPenalty: 0.5, // 文字数の差1つにつき減点
  },

  // ⑥会話モード（DESIGN.md §4.7、Phase3 Step20）
  talk: {
    // Step21（v0.11）: 選択肢は最初から出す（待ち時間・早出しはやめた）。選択肢は3つ（正解＋間違い3つからランダムに2つ）
    correctResultMs: 1200,  // 正解したあと、訳を読んでからカード選択に戻るまでの時間（ミリ秒）。文が長いので単語（600）より長め
    wrongResultMs: 2600,    // 間違い・PASSのあと、正解・訳・「なぜ合わないか」を読んでから戻るまでの時間（ミリ秒）。単語（1400）より長め
    optionCount: 2,         // 選択肢の数（正解1つ＋間違い optionCount-1 個。間違いは wrong1〜3 からランダムに選ぶ）。
                            // v0.11.1: 3→2（Androidで遊んで「2択で十分」。補充も +4/+11 → ふつうの +3/+8 に下げた）
  },

  // ⑦語順モード（DESIGN.md §4.8、Phase3 Step22）。会話のデータの正解の文を、単語のタイルに分けて並べさせる
  order: {
    maxWords: 8,            // この語数までの文だけ使う（9語以上は長すぎるので除く）
    missLimit: 3,           // 何回ミスしたら不正解になるか（違う単語のタイルを押すと1回）
    correctResultMs: 1200,  // 正解したあと、英文を見てからカード選択に戻るまでの時間（ミリ秒）。会話と同じ
    wrongResultMs: 2600,    // 間違い・PASSのあと、正解の英文を見てから戻るまでの時間（ミリ秒）。会話と同じ
    shuffleRetry: 20,       // 並べ替えた結果が元の順と同じだったとき、混ぜ直す最大回数
  },

  // ①タイピングモード（DESIGN.md §4.2、Step8で追加）
  typing: {
    exampleRevealSec: 2.2, // お手本（つづり）が見えている時間（秒）。過ぎると文字数ぶんの"_"だけになる。
                            // Step10: 1.5→2.2（3回目のプレイで「2.0〜2.5秒くらい」。DESIGN.md §4.2 v0.6）
                            // 一時停止中は進まない（canvas.jsが一時停止中はupdate自体を呼ばないため自然に止まる）
  },

  // 読み上げ（DESIGN.md §4.1、§10.3）
  speech: {
    rate: 0.95, // 読み上げの速さ（1.0が標準速）
    pitch: 1.0, // 読み上げの声の高さ（1.0が標準）
  },

  // 音（DESIGN.md §10、Step9で追加）。BGM・効果音の音量、フェードの長さ、鳴らしすぎない間引きの数字はぜんぶここ。
  // ファイルとの対応表（どの場面でどの魔王魂の音源ファイルを鳴らすか）は sound/README.md が正で、
  // 実際の一覧は src/sounds.js に書く（balance.jsには「量」の数字だけを置く）
  sound: {
    bgmMasterVolume: 0.5, // BGM全体の音量（0〜1）
    seMasterVolume: 0.8,  // 効果音全体の音量（0〜1）
    bgmFadeSec: 0.6,       // BGMを切り替える（フェードアウト→フェードイン）ときの長さ（秒）
    speechDuckMultiplier: 1.0, // 読み上げている間、BGMの音量に掛ける倍率（小さいほど静かになる。1.0＝下げない。DESIGN.md §10.3）
                               // v0.6.1: 0.2だと読み上げのたびにBGMが「いったん落ち着く」のが心地よくない（4回目のプレイ動画で確認）ので、BGMは下げない。
                               // 聞き取りにくければ 0.7 くらいまでで試す（効果音は下の speechSeDuckMultiplier で下げたまま）
                                // Step10: 0.35→0.2（3回目のプレイで「発音が聞き取りにくい」。もっと下げる）
    duckWatchdogMs: 6000, // 読み上げ中のダッキングを強制的に元に戻す保険の時間（ミリ秒。Step10）。
                           // ブラウザによってはspeechSynthesisのonstart/onendが正しく呼ばれないことがあり、
                           // そのままだとBGMが小さいまま（聞こえないまま）固まってしまうのを防ぐ
    speechSeDuckMultiplier: 0.5, // 読み上げている間、効果音全体の音量に掛ける倍率（Step10で新設。DESIGN.md §10.3 v0.6）
    speechDelayAfterSelectSec: 0.3, // カードを選ぶ音（select）が鳴ってから、自動の読み上げを始めるまでの遅れ（秒）。
                                     // Step10: 選択音と読み上げの出だしが重なって聞き取りにくいのを防ぐ（DESIGN.md §10.3 v0.6）
    seStopFadeSec: 0.12, // 新しい問題が始まるとき、まだ鳴っている正解/不正解/PASSの音を止める短いフェードの長さ（秒。Step10）

    // 曲ごとの音量の倍率（原曲の大きさの違いをならすための微調整。1が基準）
    bgmSceneVolume: {
      title: 1, stage: 1, boss: 1, clear: 1, gameover: 1,
    },
    // 効果音ごとの音量の倍率（1が基準。うるさく感じるものは小さめにしてある）
    seVolume: {
      correct: 1, wrong: 1, pass: 0.8, select: 0.7, type: 0.5, miss: 0.6,
      explosion: 0.55, hit: 1, bomb: 1,
    },
    // よく鳴る効果音（敵の撃破・被弾・正しい文字など）は、これより短い間隔では重ねて鳴らさない（間引き。ミリ秒）
    seMinIntervalMs: {
      type: 40, miss: 80, explosion: 60, hit: 150, correct: 100, wrong: 100,
      select: 80, pass: 100, bomb: 200,
      deco_hit_small: 120, deco_hit_medium: 200, deco_hit_large: 400, // 弾幕に当たった音（Step12）
    },
    // 長すぎる効果音は、この長さ（秒）で強制的に止める（フェードアウトして切る。Step10。
    // DESIGN.md §10.3 v0.6「長すぎる効果音（文字を打つ音など）は短く切って鳴らす」）。書いていない音は切らない
    seMaxDurationSec: {
      type: 0.15,
      miss: 0.35,
    },

    // 見つかっていない音の代わりに、プログラムで合成する音（Web Audio。fetchを使わないのでfile://でも動く）
    synthVolume: 0.5,             // 合成音（サイレン・風切り音・ポーズ音）の基準音量
    warningSirenSec: 1.6,         // WARNINGのサイレン: 1回ぶんの長さ（秒）
    warningSirenCycles: 3,        // サイレンが高低を繰り返す回数
    warningSirenFreqLow: 340,     // サイレンの低い方の周波数（Hz）
    warningSirenFreqHigh: 760,    // サイレンの高い方の周波数（Hz）
    bannerSwooshSec: 0.4,         // WAVEの文字が入ってくるときの風切り音の長さ（秒）
    bannerSwooshFreqStart: 1800,  // 風切り音のフィルター周波数（開始。Hz。高い方）
    bannerSwooshFreqEnd: 300,     // 同（終了。Hz。低い方）
    pauseBlipSec: 0.12,           // 一時停止・再開の短い音の長さ（秒）
    pauseBlipFreq: 880,           // 同、音の高さ（Hz）
    bossDownPlaybackRate: 0.55,   // 中ボス撃破音: bomb.mp3を低く・長く鳴らすための再生速度（1が原速。低いほど低く長くなる）
    bossDownVolumeMultiplier: 1.15, // 同、bombより少し大きめに鳴らす

    // 被弾音に重ねる、プログラムで合成した低い衝撃音「ドンッ」（Step10。DESIGN.md §5.1 v0.6
    // 「被弾音は重い『ドンッ』（今の音にプログラムで作った低い衝撃音を重ねる）」）
    hitThudSec: 0.28,             // 衝撃音の長さ（秒）
    hitThudFreqStart: 150,        // 鳴り始めの周波数（Hz）
    hitThudFreqEnd: 40,           // 鳴り終わりの周波数（Hz。低いほど「ドンッ」と沈む）
    hitThudVolumeMultiplier: 1.3, // 合成音の基準音量（synthVolume）に掛ける倍率

    // 弾幕（飾りの弾）に当たったときの合成音（Step12。DESIGN.md §5.1 v0.7.1）。本当の被弾の「ドンッ」より軽くする。
    // 読み上げ中は効果音全体と同じく speechSeDuckMultiplier 倍に下がる
    decoHitSmallSec: 0.05,        // 小: 「チッ」の長さ（秒）
    decoHitSmallFreq: 2600,       // 小: 音の高さ（Hz。高くて短い）
    decoHitSmallVolume: 0.3,      // 小: 音量（synthVolumeに掛ける倍率。小さめ）
    decoHitMediumSec: 0.1,        // 中: 長さ（秒）
    decoHitMediumFreqStart: 1000, // 中: 鳴り始めの高さ（Hz）
    decoHitMediumFreqEnd: 350,    // 中: 鳴り終わりの高さ（Hz。下がっていく「ボッ」）
    decoHitMediumVolume: 0.55,    // 中: 音量（synthVolumeに掛ける倍率）
    decoHitLargeSec: 0.22,        // 大: 長さ（秒）
    decoHitLargeFreqStart: 130,   // 大: 鳴り始めの高さ（Hz）
    decoHitLargeFreqEnd: 45,      // 大: 鳴り終わりの高さ（Hz。重く沈む。本当の被弾より軽い）
    decoHitLargeVolume: 0.85,     // 大: 音量（synthVolumeに掛ける倍率。本当の被弾は1.3）
  },

  // マップのマス（道の難しさごとの設定。DESIGN.md §7.3）
  mass: {
    // Step11: 1ウェーブを短くした（4回目のプレイで「1マス6〜7分は長い」。DESIGN.md §7.3 v0.7）。中ボスの体力は変えない
    easy:  { waveTimeSec: 90,  minibossHp: 15 }, // 易（1分30秒）
    hard1: { waveTimeSec: 105, minibossHp: 15 }, // 難1（1分45秒）
    hard2: { waveTimeSec: 120, minibossHp: 15 }, // 難2（2分）
    hard3: { waveTimeSec: 135, minibossHp: 20 }, // 難3（2分15秒）
  },

  // ステージ（ルートステージ。DESIGN.md §7.2・§12 Phase2）。Phase 2 は Stage1〜Stage4 まで（Step15）
  stage: {
    count: 4,                          // 遊べるステージの数（タイトルに出すボタンの数。Step14）
    levelLabels: ["英検4級", "英検3級", "英検準2級", "英検準2級プラス"], // 各ステージの級（タイトル画面のボタンに小さく添える）
  },

  // ウェーブの構成（DESIGN.md §7.4）
  wave: {
    wavesPerMass: 3,       // 1マス＝3ウェーブ（ウェーブ1・2は生き延びる、ウェーブ3は中ボス戦）
    survivalWaveCount: 2,  // 「生き延びる」ウェーブの数（WAVE1・WAVE2。そのあとWAVE3が中ボス戦。Phase2 Step14）
    wave2SpawnRateMultiplier: 1.25, // WAVE2は敵の編隊が出てくるペースを何倍にするか（1.0=WAVE1と同じ。少しだけ混ませる。Step14。1.0〜1.3で放置の秒数は約52→50秒とほぼ変わらない）
    clearMessageSec: 2.2,  // 通常ウェーブをクリアしたあと、WARNINGに移るまで足止めする時間（秒）
    warningMessageSec: 2.4,// 続けてWARNINGの状態でいる時間（秒）。この間も問題には答えられる
    // ↑この2つは「次のモードに進むまでの間」を決める数字（ゲームの進行）。
    //   画面に出す文字の動き（スライドの長さなど）は下の banner を使う（Step7で分離）
  },

  // ウェーブ切り替えの文字演出（DESIGN.md §3.1、Step7で追加、Step8で派手にした）。
  // 「STAGE 1」「WAVE 1」「WAVE 2」「WAVE CLEAR」「WARNING」「WAVE 3 — BOSS」「CLEAR」などの文字に共通で使う。
  // 右からスライドして入り→中央で少し止まり→左へスライドして抜ける。演出中もゲームと解答は止めない
  banner: {
    slideInSec: 0.32,     // 右から中央へスライドインする時間（秒）
    holdSec: 1.1,          // 中央で止まっている時間（秒）
    slideOutSec: 0.32,     // 中央から左へスライドアウトする時間（秒）
    warningPulseSpeed: 6,  // WARNINGの文字がちかちか明滅する速さ（大きいほど速い）

    // ここから下はStep8で追加（2回目のプレイ「もっと激しく」。DESIGN.md §3.1 v0.5）
    fontSize: 88,          // 文字の大きさ（px）。48→80〜96の目安
    bandHeight: 130,       // 画面横幅いっぱいの帯の高さ（px）
    bandAlpha: 0.55,       // 帯の暗さ（半透明の濃さ。0〜1）
    bandLineHeight: 4,     // 帯の上下に走るネオン線の太さ（px）
    afterimageCount: 4,    // 文字の残像の枚数
    afterimageOffset: 10,  // 残像1枚ごとに右へずらす幅（px）
    speedLineCount: 10,    // 帯の中を走る横向きスピード線の本数
    speedLineSpeed: 900,   // スピード線が流れる速さ（px/秒）
    flashSec: 0.18,        // 文字が出現した瞬間、画面が白く光っている時間（秒）
    flashPeakAlpha: 0.85,  // 白いフラッシュの最大の明るさ（0〜1）
    shakeSec: 0.3,         // 文字が出現した瞬間、画面が揺れる時間（秒）
    shakeAmplitude: 14,    // 画面が揺れる振れ幅（px）

    // WARNING専用（画面全体が赤く点滅＋黄色と黒の警告テープ。DESIGN.md「WARNINGは画面全体が赤く点滅」）
    warningFlashAlpha: 0.28, // 画面全体を赤く点滅させる最大の濃さ（0〜1）
    tapeHeight: 26,          // 警告テープの帯の高さ（px。画面の上と下それぞれ）
    tapeStripeWidth: 34,     // 警告テープの斜めしま1本分の幅（px）
    tapeScrollSpeed: 120,    // 警告テープが横に流れる速さ（px/秒）

    // CLEAR専用（光の粒が飛び散る。DESIGN.md「CLEARは光の粒が飛び散る」）
    clearParticleCount: 60,     // 飛び散る光の粒の数
    clearParticleSpeedMin: 60,  // 粒が飛び散る速さの最小（px/秒）
    clearParticleSpeedMax: 260, // 同、最大（px/秒）
    clearParticleLifeSec: 1.1,  // 粒が消えるまでの時間（秒）
  },

  // 点数（DESIGN.md §7.6）。配分・区切りは仮の値で、遊びながら調整する
  score: {
    enemyKillPoint: 15,         // ザコを1体倒したときの点数
    bombKillMultiplier: 2,      // ボムで倒したときは1体あたり何倍になるか（まとめて倒すと点が大きく入る）
    correctBonus: 80,           // 正解したときの正解ボーナス
    comboStep: 20,              // 連続正解ボーナス: 連続正解1回ごとに増える点数
    comboCap: 8,                 // 連続正解ボーナスが頭打ちになる連続数（これ以上連続しても増えない）
    minibossDefeatBonus: 1500,  // 中ボスを倒したときのボーナス
  },

  // HUD（上半分に重ねる表示）の見た目の数字
  hud: {
    gaugeSegments: 10, // LIFE・SHOTの縦ゲージを何段の目盛りで表示するか（最大値に関わらず段数は固定）

    // 危機感の演出（Step10。DESIGN.md §5.1 v0.6「ライフ・ショットが残り1/3以下で危機感の演出」）
    criticalLifeRatio: 1 / 3,          // ライフがこの割合以下になったら危機感の演出を出す
    lifeCriticalPulseMaxAlpha: 0.6,    // 画面のふちが赤く脈打つ、最大の濃さ（0〜1）。Opus: 0.35では薄くて見えなかったので上げた
    lifeCriticalPulseMinRatio: 0.35,   // 脈の谷での濃さ（最大に対する割合）。0だと谷で消えてしまう
    lifeCriticalEdgeWidthRatio: 0.28,  // 赤が内側へ伸びる幅（画面の短い辺に対する割合）
    lifeCriticalPulseSpeedMin: 1.0,    // 脈打つ速さ（Hz目安）。ライフがちょうど閾値のとき（遅い）
    lifeCriticalPulseSpeedMax: 3.2,    // 同、ライフ0に近いとき（速い。「少ないほど速く」）
    lifeGaugeBlinkDurationMaxSec: 0.9, // LIFEゲージが赤く点滅する間隔（秒）。ライフがちょうど閾値のとき（遅い）
    lifeGaugeBlinkDurationMinSec: 0.25,// 同、ライフ0に近いとき（速い）

    lowShotRatio: 1 / 3,       // ショットがこの割合以下で「LOW AMMO」（SHOTゲージがオレンジに点滅）
    shotGaugeBlinkDurationSec: 0.5, // SHOTゲージの点滅間隔（秒。LOW AMMO・NO AMMOとも共通）
  },

  // 画面（Canvas）の見た目まわり。数値・速さの調整用
  visual: {
    // 星空を2〜3層に分けて、奥行きが出るようにする（Step7。DESIGN.md §5.1「奥行きのある2〜3層のスクロール」）。
    // 配列の先頭ほど奥（遅い・小さい・薄い）、末尾ほど手前（速い・大きい・濃い）
    starLayers: [
      { count: 45, speedMin: 15, speedMax: 35, sizeMin: 1, sizeMax: 1.4, alpha: 0.35 },  // 奥
      { count: 35, speedMin: 45, speedMax: 80, sizeMin: 1.2, sizeMax: 2, alpha: 0.6 },   // 中間
      { count: 22, speedMin: 90, speedMax: 150, sizeMin: 1.6, sizeMax: 3, alpha: 0.9 },  // 手前
    ],
  },

  // シューティング演出と「画面の混み具合」（DESIGN.md §2.2・§5.1・§5.2）。Step4で追加
  battle: {
    // 自機（Step7: 画面いっぱいを自由に動き回るように変更。DESIGN.md §5.1）。
    // 当たる・当たらないは今までどおり被弾タイマーだけで決まる（自機の動きは見た目だけ）
    playerMoveMarginX: 60,        // 自機が動ける横方向の余白（px。HUDのゲージ・右端バーを避ける）
    playerMoveMinY: 50,           // 自機が動ける上端（px）
    playerMoveMaxY: 420,          // 自機が動ける下端（px。Canvasの高さは440px）
    playerMoveSpeed: 220,         // 自機のふだんの移動速度（px/秒）
    playerSteerRate: 3.2,         // 今の速度を目標の速度に近づける強さ（大きいほど機敏に曲がる）
    playerRetargetMinSec: 1.0,    // 次に動く先を選び直すまでの間隔（最小・秒）
    playerRetargetMaxSec: 2.4,    // 同（最大・秒）
    playerApproachEnemyChance: 0.5, // 動く先を選ぶとき、敵に寄っていく確率（それ以外はランダムな場所へ）
    playerDashChancePerSec: 0.28, // 1秒あたり、すばやい切り返し（ダッシュ）が起きる確率
    playerDashMultiplier: 2.2,    // ダッシュ中、ふだんの速度の何倍で動くか
    playerDashDurationSec: 0.35,  // ダッシュが続く時間（秒）
    playerDashCooldownSec: 1.4,   // ダッシュのあと、次にダッシュできるようになるまでの時間（秒）
    playerTiltMax: 0.5,           // 自機が左右に傾く見た目の最大角度（ラジアン）
    muzzleFlashSec: 0.08,         // 自機が発砲した瞬間、砲口が光る時間（秒）
    engineFlickerSpeed: 16,       // 自機のエンジンの炎がゆらめく速さ

    // 自機の動きをもっと派手に（Step10。DESIGN.md §5.1 v0.6「すばやい切り返し・宙返り・残像・大きなエンジン炎」）
    playerRollChancePerSec: 0.05, // 1秒あたり、宙返り（ロール）が起きる確率
    playerRollDurationSec: 0.6,   // ロールが続く時間（秒）。この間は自機がくるっと1回転する
    playerRollCooldownSec: 3.0,   // ロールのあと、次にロールできるようになるまでの時間（秒）
    playerRollSpeedPerSec: 7.3,   // ロール中、1秒あたりに回転する角度（ラジアン。2πでちょうど1回転）
    playerTrailLength: 5,         // 残像として覚えておく直近の位置の数
    playerTrailIntervalSec: 0.035,// 残像用に位置を記録する間隔（秒。短いほど残像がなめらかにつながる）
    playerTrailMaxAlpha: 0.35,    // 残像のいちばん濃い（最新の）部分の不透明度
    engineFlameBaseLen: 24,       // エンジンの炎のふだんの長さ（px）。Step10で16→24に拡大
    engineFlameBoostMultiplier: 1.7, // ダッシュ・ロール中、炎の長さに掛ける倍率（もっと大きく見せる）

    // 機体の大きさ（Step11。DESIGN.md §5.1 v0.7「機体を少し大きく（今の約1.3倍）」）。見た目だけで当たり判定・被弾には無関係
    playerScale: 1.3,           // 自機の大きさの倍率（1.0が従来の大きさ）
    enemyScale: 1.3,            // ザコ敵の大きさの倍率（1.0が従来の大きさ）。中ボスは下のminiboss.width/heightを直接1.3倍にしてある

    playerBulletSpeed: 700,     // 自機の弾が敵に向かって飛ぶ速さ（px/秒）
    playerBulletHitRadius: 10,  // 自機の弾が敵に届いた（命中した）とみなす距離（px）
    fireIntervalSec: 0.7,       // 自機が何秒おきに1発撃つか（見た目の連射。ショットの消費ペースとは別）
    // ↑ spawnIntervalSec/formationSizeとこの値は「敵の出てくる速さ」と「自機が倒す速さ」が
    //   釣り合うように選んである（IMPLEMENTATION_NOTES.md Step4・Step5参照）。balance.jsで変える場合は
    //   spawn側とセットで見直すこと

    // 敵の出現（編隊を組んで降りてくる）。Step5で「画面をにぎやかに」するため数を増やした
    initialEnemyCount: 10,      // ウェーブ開始時、最初からいる敵の数
    spawnIntervalSec: 2.1,      // 何秒おきに新しい編隊が出てくるか
    formationSize: 3,           // 1回の編隊で出てくる敵の数
    formationSpawnMarginPx: 220,// 編隊が現れる横位置の、画面の左右端からの余白（px）
    formationSpacingPx: 70,     // 同じ編隊の中で、敵と敵の間隔（px）
    enemySpeed: 55,             // 敵が降りてくる速さ（px/秒）
    enemyDespawnMargin: 10,     // 画面下からこの距離まで来たら、倒されなくても画面外扱いで消える（px）
    enemyWobbleAmplitude: 26,   // 敵編隊（line）の左右の揺れ幅（px）
    enemyWobbleSpeed: 1.4,      // 同、揺れの速さ
    wrongAnswerEnemyBonus: 2,   // 問題を間違えたときに追加で出てくる敵の数（DESIGN.md §2.2・§4.1）

    // 敵の出方の種類（Step7。DESIGN.md §5.1「編隊・横から回り込む・波打つ など」）。
    // spawnFormationのたびにこの中から1つをランダムに選ぶ（等確率）
    enemyFormationTypes: ["line", "vshape", "flank", "wave", "cross"],
    vshapeStepY: 26,     // vshape（V字編隊）: 中心からの距離1体あたりの縦方向のずれ（px）
    waveAmplitude: 78,   // wave（波打ちながら降りる）: 横の振れ幅（px。line用のenemyWobbleAmplitudeより大きい）
    waveSpeed: 1.0,      // 同、揺れの速さ
    flankSpeedX: 130,    // flank（横から回り込む）: 画面中央へ寄っていく横方向の速さ（px/秒）
    crossSpeedX: 150,    // cross（左右から横切る）: 横に移動する速さ（px/秒）
    crossYMin: 70,       // cross が通る高さの範囲（最小・px）
    crossYMax: 190,      // 同（最大・px）

    // 敵の弾（見た目だけ。これ自体には当たり判定がない。DESIGN.md §5.2）。
    // Step5で「1回のタイマーで1発だけ」から「敵1体ずつが自分のタイマーで撃つ」方式に変え、
    // 敵の数が増えるほど弾の数も自然に増えるようにした（画面をにぎやかにするため）
    enemyBulletIntervalMin: 0.35, // 敵1体が次の弾を撃つまでの間隔（秒）の最小値
    enemyBulletIntervalMax: 0.65, // 同、最大値（min〜maxでばらつかせて一斉射撃に見えないようにする）
    enemyBulletSpeed: 220,        // 敵弾が降りてくる速さ（px/秒）
    enemyBulletPassMargin: 20,    // 敵弾が自機のそばを「通り過ぎた」とみなす余白（px）。これを超えると見た目上消える
    enemyBulletFanChance: 0.16,   // 敵が弾を撃つとき、1発だけでなく扇状にまとめて撃つ確率（Step7。DESIGN.md §5.1）
    enemyBulletFanCount: 3,       // 扇状に撃つときの弾数
    enemyBulletFanSpreadDeg: 34,  // 扇の開き角度（度）。まん中の弾の左右にこの半分ずつ広がる

    // 画面の混み具合とダメージ（DESIGN.md §2.2・§5.2・§5.3）
    congestionEnemyWeight: 1,     // 混み具合の計算で、敵1体を何ポイントとして数えるか
    congestionBulletWeight: 0.25, // 同、弾1発（ザコの弾）を何ポイントとして数えるか。
                                   // Step5で敵・弾の見た目の数を増やしたので、弾は敵より軽く数えて
                                   // 「危険度」の感覚（被弾間隔）が変わりすぎないようにした
    congestionBossBulletWeight: 0.6, // 同、中ボスの弾1発を何ポイントとして数えるか（ザコの弾より重い。
                                   // Step6: 中ボス戦はザコが控えめだったぶん被弾がゆるくなっていたので、
                                   // 中ボスの弾を重めに数えて「ザコ戦とだいたい同じ強さ」に揃えた）
    normalCongestion: 10.0,       // 「ふつうの混み具合」の基準値（敵の数×congestionEnemyWeight＋弾の数×congestionBulletWeight）。
                                   // この値のとき被弾間隔がlife.hitIntervalSec（Step7で4秒）ちょうどになる。
                                   // 実測（何も答えない場合の到達時間）で調整した数字。Step7で敵の出方を複数種類にしたぶん
                                   // 画面上の平均の混み具合が下がったため、13.5から下げ直した（IMPLEMENTATION_NOTES.md Step5・Step7参照）
    shotEmptyHitIntervalMultiplier: 0.5, // 弾切れ（ショット0）の間、被弾間隔にこれを掛ける（Step8。
                                   // DESIGN.md §2.2・§5.2「弾切れの間は被弾の間隔が半分になる」）
    hitIntervalMinSec: 1.5,       // 被弾間隔の下限（どんなに混んでもこれより短くはならない）。
                                   // Step8: 弾切れ時（3秒×0.5＝1.5秒）はこの下限にちょうど収まる想定
    hitIntervalMaxSec: 12,        // 被弾間隔の上限（どんなに空いていてもこれより長くはならない）
    hitBulletSpeed: 520,          // 「本当に当たる弾」（被弾タイマーが鳴ったときの弾）が自機に向かって飛ぶ速さ（px/秒）
    hitBulletHitRadius: 14,       // その弾が自機に当たったとみなす距離（px）

    // ボム（スペースキー。DESIGN.md §5.1・§5.2）
    bombInvulnSec: 2.5,          // ボムを撃った後、被弾しない時間（秒）
    bombFlashSec: 0.35,          // ボムを撃ったときに画面が白く光る時間（秒）

    // 被弾・爆発の演出。Step10で「もっと派手に」（DESIGN.md §5.1 v0.6）大きくした
    hitFlashSec: 0.5,            // 被弾したときに自機が点滅する時間（秒）
    hitBlinkIntervalSec: 0.08,   // 被弾したときに自機が点滅する間隔（秒。小さいほど速く点滅する）
    shakeSec: 0.55,              // 被弾したときに画面が揺れる時間（秒）。Step10: 0.35→0.55（もっと強く）
    shakeAmplitude: 22,          // 画面が揺れる振れ幅（px）。Step10: 10→22
    explosionParticleCount: 20,  // 敵を倒したときに散る破片の数。Step10: 14→20
    explosionLifeSec: 0.5,       // 破片が消えるまでの時間（秒）
    explosionSpeedMin: 40,       // 敵を倒したときの破片が飛び散る速さの最小（px/秒）
    explosionSpeedMax: 190,      // 同、最大（px/秒）。Step10: 160→190
    explosionShockwaveMaxRadius: 46,  // 敵を倒したときの衝撃の輪の、いちばん広がったときの半径（px。Step10で新設）
    explosionShockwaveLifeSec: 0.32,  // 同、輪が消えるまでの時間（秒）

    // 被弾したときの追加演出（Step10。DESIGN.md §5.1 v0.6「画面を強く揺らす、ふちを赤く光らせる、
    // 自機から火花、『-1』の表示」）
    hitEdgeFlashSec: 0.45,        // 画面のふちが赤く光る時間（秒）
    hitEdgeFlashAlpha: 0.4,       // 同、いちばん濃いときの不透明度
    hitSparkCount: 12,            // 被弾したときに自機から散る火花の数
    hitSparkSpeedMin: 60,         // 火花が飛び散る速さの最小（px/秒）
    hitSparkSpeedMax: 220,        // 同、最大（px/秒）
    hitSparkLifeSec: 0.35,        // 火花が消えるまでの時間（秒）
    hitDamageTextLifeSec: 0.75,   // 「-1」の表示が消えるまでの時間（秒）
    hitDamageTextRiseSpeed: 34,   // 「-1」の表示が上へ浮き上がる速さ（px/秒）

    // 描画が重くならないための上限（同時に存在できる数）。Step5で敵・弾を増やしたぶん上限も上げた
    maxEnemies: 40,
    maxEnemyBullets: 90,
    maxPlayerBullets: 20,
    maxParticles: 260,
    maxShockwaves: 24,  // 同時に存在できる衝撃の輪の数（Step10で新設）
    maxSparks: 200,     // 同時に存在できる火花の数（Step10で新設。Step12で弾幕に当たった火花も使うため120→200）

    // 中ボス（DESIGN.md §3.1・§7.4。体力そのものは mass.easy.minibossHp 等マス側の数字を使う）。Step5で追加
    miniboss: {
      width: 117,                // 見た目の横幅（ザコより大きい。px）。Step11: 90→117（約1.3倍）
      height: 91,                // 見た目の高さ（px）。Step11: 70→91（約1.3倍）
      yPos: 100,                 // 画面上部からの固定Y座標（px）。ザコと違って下に落ちてこない
      moveRangeX: 260,           // 画面中央からどれだけ左右に動くか（px）
      moveSpeed: 70,             // 左右に動く速さ（px/秒。ゆっくり）
      hitFlashSec: 0.25,         // 正解でダメージを受けたとき、ボスが光る時間（秒）
      bulletIntervalSec: 0.68,   // 何秒おきに弾を撃つか（見た目。画面の混み具合に入る）。
                                  // Step6: 0.9→0.5→0.55に調整。Step7: life.hitIntervalSecを4秒・normalCongestionを
                                  // 10.0に変えたところ、中ボス戦だけ通常ウェーブより速くライフが尽きたため、0.55→0.68に
                                  // 緩めて「通常ウェーブ・中ボス戦とも放置で約80秒」にそろえ直した（IMPLEMENTATION_NOTES.md参照）
      bulletSpeed: 240,          // 弾が降りてくる速さ（px/秒）
      zakoSpawnIntervalSec: 2.1, // 中ボス戦の間、ザコの編隊が出る間隔。Step6で通常ウェーブのspawnIntervalSecと
                                  // 同じ値にし、「ザコ戦とだいたい同じにぎやかさ」にした（旧: 3.4秒）
      zakoFormationSize: 3,      // 中ボス戦の間、1回の編隊で出てくるザコの数。Step6で通常ウェーブのformationSizeと
                                  // 同じ値にした（旧: 1体）
      defeatParticleCount: 70,   // 撃破時「大きな爆発」の破片の数（ザコのexplosionParticleCountより多い）
      defeatParticleSpeedMin: 60, // 同、破片が飛び散る速さの最小（px/秒。通常の爆発より広く飛び散らせる）
      defeatParticleSpeedMax: 260,// 同、最大（px/秒）
      defeatParticleLifeMultiplier: 1.6, // 同、破片が消えるまでの時間（explosionLifeSecの何倍か。通常より長く残す）
      defeatParticleJitterPx: 20, // 同、破片の出始めの位置を中心からどれだけずらすか（px）
      defeatShockwaveMaxRadius: 150, // 撃破時の衝撃の輪の最大半径（px。Step10で新設。ザコより大きく広がる）
      defeatShockwaveLifeSec: 0.55,  // 同、輪が消えるまでの時間（秒）
    },
  },

  // 弾幕（東方Project風の飾りの弾。DESIGN.md §5.1 v0.7、Step11で追加。src/danmaku.js）。
  // ここで出す弾は見た目だけで、画面の混み具合（＝ライフの減る速さ）には数えない。
  // ライフが減るのは今までどおり「被弾タイマー」が鳴ったときの赤い弾（本当に当たる弾）だけ
  danmaku: {
    maxBullets: 360,            // 飾りの弾が同時に存在できる数の上限（重くならないための歯止め）
    // 縦の画面（スマホ）では飾りの弾を減らして軽くする（Step21。ライフの減り方は変わらない。見た目だけの弾のため）
    maxBulletsPortrait: 180,    // 縦の画面での飾りの弾の上限（横の約半分）
    portraitFireScale: 0.5,     // 縦の画面でザコ・中ボスが飾りの弾を撃つ頻度の倍率（小さいほど少ない）

    // 弾幕に当たったときの反応（Step12。DESIGN.md §5.1 v0.7.1）。飾りの弾は自機にぶつかって消える。
    // 見た目と音だけで、ライフ・ショット・点数・混み具合は一切変わらない（ライフが減るのは被弾タイマーのときだけ）
    hit: {
      playerRadius: 13,         // 自機の当たり判定の半径（px。機体の見た目の半分より少し小さめ）
      // 弾の種類ごとの当たり判定の半径（px。見た目の大きさより少し小さめ）
      bulletRadius: { pellet: 4, orb: 6, rice: 4, kunai: 6, star: 7, big: 14 },
      // 弾の種類ごとの反応の大きさ（small=小 / medium=中 / large=大）
      tier: { pellet: "small", rice: "small", kunai: "small", star: "small", orb: "medium", big: "large" },

      // 当たって消える弾の「消滅エフェクト」（どの大きさでも毎回出る。弾の色の小さな火花）
      vanishSparkCount: 3,      // 消えるときの小さな火花の数
      vanishSparkLifeSec: 0.2,  // 同、消えるまでの時間（秒）
      vanishSparkSpeed: 60,     // 同、飛び散る速さ（px/秒）

      // 大きさごとの反応。うるさくならないよう minIntervalSec より短い間隔では反応を出さない（弾は消える。間引き）
      //   sparkCount: 自機から散る火花の数 / sparkSpeedMin・Max: 火花の速さ（px/秒） / sparkLifeSec: 火花が消えるまで（秒）
      //   sparkSizeMin・Max: 火花の大きさ（px。大は破片のように大きい） / whiteFlashSec: 自機が白く光る時間（秒）
      //   kickPx: 自機が当たった向きへはじかれる大きさ（px。すぐ元に戻る） / shakeAmp・shakeSec: 画面の揺れの振れ幅（px）と時間（秒）
      //   edgeFlashAlpha・edgeFlashSec: 画面のふちが赤く光る濃さと時間（0なら光らない） / ringRadius: 衝撃の輪の大きさ（px。0なら出さない）
      react: {
        small:  { sparkCount: 4,  sparkSpeedMin: 50, sparkSpeedMax: 150, sparkLifeSec: 0.22, sparkSizeMin: 1.5, sparkSizeMax: 2.5,
                  whiteFlashSec: 0.09, kickPx: 3,  shakeAmp: 0, shakeSec: 0,    edgeFlashAlpha: 0,    edgeFlashSec: 0,   ringRadius: 0,  minIntervalSec: 1.5 },
        medium: { sparkCount: 9,  sparkSpeedMin: 70, sparkSpeedMax: 190, sparkLifeSec: 0.3,  sparkSizeMin: 2,   sparkSizeMax: 3.5,
                  whiteFlashSec: 0.16, kickPx: 6,  shakeAmp: 4, shakeSec: 0.18, edgeFlashAlpha: 0,    edgeFlashSec: 0,   ringRadius: 0,  minIntervalSec: 2.5 },
        large:  { sparkCount: 18, sparkSpeedMin: 80, sparkSpeedMax: 260, sparkLifeSec: 0.45, sparkSizeMin: 3,   sparkSizeMax: 6,
                  whiteFlashSec: 0.24, kickPx: 12, shakeAmp: 9, shakeSec: 0.3,  edgeFlashAlpha: 0.22, edgeFlashSec: 0.3, ringRadius: 40, minIntervalSec: 4.0 },
      },
      shakeMaxAmp: 12,          // 弾幕に当たった揺れを重ねたときの上限（px。被弾タイマーの本当の被弾の揺れ shakeAmplitude より小さく）
      whiteFlashMaxSec: 0.3,    // 自機が白く光る時間の上限（秒）
      kickDecaySec: 0.18,       // はじかれた自機が元の位置に戻るまでの時間（秒）
    },

    // 自機のよけ方（Step12。DESIGN.md §5.1 v0.7.1「自機は大玉を中心にある程度よける」）。見た目だけの動きで、被弾には関係しない。
    // 近くの弾から離れる向きに、自機の速度を足す。小さい弾は弱くしかよけないので、ときどき当たる
    dodge: {
      radius: 120,              // この距離より近い弾をよける（px）
      lookaheadSec: 0.3,        // 弾がこれだけ先に進んだ位置も見てよける（秒）
      strength: 360,            // よける強さ（px/秒。自機の速度に足す）
      weight: { large: 1.0, medium: 0.8, small: 0.5 }, // 弾の大きさごとの「よけたい度」（大玉を中心によける）
    },
    glowScale: 1.9,             // 弾のにじみ（光）の大きさ（弾の半径に対する倍率）
    starSpinSpeed: 4.5,         // 星弾がくるくる回る速さ（ラジアン/秒）
    enemyFireMinY: 4,           // ザコがこの高さより下に来たら飾りの弾を撃ち始める（px。画面の上端より上では撃たない）
    enemyFireMaxYFromBottom: 60,// ザコが画面下端からこの距離より下に来たら撃たない（px）
    zakoFireScaleDuringBoss: 0.35, // 中ボス戦のあいだ、ザコが弾幕を撃つ頻度の倍率（小さいほど控えめ。中ボスの花の弾幕を見やすくする）

    // 弾の大きさ（半径・半幅・半長。px）
    sizes: {
      pelletRadius: 4,          // 小玉の半径
      orbRadius: 7,             // 光る丸弾の半径
      riceHalfWidth: 3.2,       // 米粒弾の半幅
      riceHalfLength: 7.5,      // 米粒弾の半長
      kunaiHalfWidth: 4.5,      // クナイ弾の半幅
      kunaiHalfLength: 10,      // クナイ弾の半長
      starRadius: 9,            // 星弾の外側の半径
      bigRadius: 16,            // 大玉の半径
    },

    // ザコの種類ごとの撃ち方（spawnFormationのたびにこの中から1つを選ぶ。編隊はみな同じ種類）。
    //   hull: 機体の色 / bulletColor: 従来からある「混み具合に数える弾」の色
    //   emitters: 撃ち方の部品。kind は
    //     aimed  … 自機狙いの扇（count発、spreadDegの広がり。偶数発だと自機が弾と弾の間にくる）
    //     ring   … 円形にばらまく（count発。撃つたびに半歩ずつずらし、turnDegずつ回す）
    //     spiral … 渦巻き（arms本の腕を、撃つたびにturnDegずつ回しながら連射。負の値で逆回り）
    //     scatter… ばらまき（下向きにランダム、spreadDegの範囲）
    //   intervalSec: 撃つ間隔（秒） / speed: 弾の速さ（px/秒） / type: 弾の形 / colors: 色（順番に使う）
    //   activeSec・restSec: 撃ち続ける秒数と、休む秒数（渦巻きなど）
    kinds: {
      fan: {
        hull: "#5fd4ff", bulletColor: "cyan",
        emitters: [
          { kind: "aimed", intervalSec: 1.9, count: 6, spreadDeg: 44, speed: 200, type: "kunai", colors: ["blue", "cyan"] },
        ],
      },
      ring: {
        hull: "#ff6b8f", bulletColor: "pink",
        emitters: [
          { kind: "ring", intervalSec: 2.5, count: 14, turnDeg: 9, speed: 105, type: "orb", colors: ["red", "pink"] },
          { kind: "ring", intervalSec: 5.5, count: 8, turnDeg: 0, speed: 82, type: "big", colors: ["purple", "pink"] }, // ときどき大玉のリング（Step12。通常ウェーブにも大玉を出す）
        ],
      },
      spiral: {
        hull: "#7dff9b", bulletColor: "green",
        emitters: [
          { kind: "spiral", intervalSec: 0.12, arms: 2, turnDeg: 23, speed: 125, type: "rice", colors: ["green", "yellow"], activeSec: 1.6, restSec: 1.9 },
        ],
      },
      scatter: {
        hull: "#c890ff", bulletColor: "purple",
        emitters: [
          { kind: "scatter", intervalSec: 0.3, count: 2, spreadDeg: 150, speed: 125, speedJitter: 0.4, type: "star", colors: ["purple", "orange", "pink", "yellow"] },
        ],
      },
    },

    // 中ボスの「花」の弾幕。phasesを順番に繰り返す（各フェーズの長さsecと撃ち方の部品。部品の意味は上のkindsと同じ）
    boss: {
      originOffsetY: 10,        // 弾が出る位置（中ボスの中心から下へずらす。px）
      phases: [
        { sec: 4.2, emitters: [   // 花1: 5本腕の渦巻き（右回り）＋ゆっくりの大きなリング
          { kind: "spiral", intervalSec: 0.11, arms: 5, turnDeg: 11, speed: 125, type: "orb", colors: ["red", "orange", "yellow", "green", "cyan"] },
          { kind: "ring", intervalSec: 1.05, count: 16, turnDeg: 0, speed: 92, type: "big", colors: ["purple", "pink"] },
        ] },
        { sec: 2.6, emitters: [   // 自機狙いのクナイの扇＋小玉のリング
          { kind: "aimed", intervalSec: 0.6, count: 8, spreadDeg: 56, speed: 215, type: "kunai", colors: ["red", "blue"] },
          { kind: "ring", intervalSec: 0.85, count: 20, turnDeg: 5, speed: 140, type: "pellet", colors: ["yellow", "cyan"] },
        ] },
        { sec: 4.2, emitters: [   // 花2: 7本腕の渦巻き（左回り）＋星のリング
          { kind: "spiral", intervalSec: 0.13, arms: 7, turnDeg: -9, speed: 118, type: "rice", colors: ["blue", "purple", "pink", "red", "orange", "yellow", "green"] },
          { kind: "ring", intervalSec: 1.3, count: 12, turnDeg: 7, speed: 100, type: "star", colors: ["yellow", "orange"] },
        ] },
        { sec: 1.6, emitters: [   // ひと息: 大玉のリングだけ
          { kind: "ring", intervalSec: 0.7, count: 10, turnDeg: 0, speed: 85, type: "big", colors: ["cyan", "blue"] },
        ] },
      ],
    },
  },

  // クリア・ゲームオーバー画面（DESIGN.md §3.2、Step6で追加）
  screens: {
    clearOverlayDelaySec: 1.3,    // 中ボスを倒して「CLEAR」の文字が少し見えたあと、クリア画面を出すまでの時間（秒）
    gameOverOverlayDelaySec: 1.0, // ライフが0になって「GAME OVER」の文字が少し見えたあと、ゲームオーバー画面を出すまでの時間（秒）
  },
  // 画面の向きと、タップ操作（Phase 3 Step17。DESIGN.md §3.3）
  layout: {
    landscapeWidth: 1280,        // 横長の画面の基準の幅（px）
    landscapeHeight: 720,        // 同、高さ（px）
    landscapeCanvasHeight: 440,  // 横長のときのシューティング（Canvas）の高さ（px）
    portraitWidth: 720,          // 縦長の画面の基準の幅（px）
    portraitHeight: 1280,        // 同、高さ（px）
    portraitTopRatio: 0.45,      // 縦長のとき、シューティングが画面の高さに占める割合
    // 敵の出る位置・動く範囲・速さは、この大きさ（横の画面のCanvas）に対する割合で扱う。
    // 縦の画面でも「敵が画面を横切る・降りてくるのにかかる時間」を変えないための基準（被弾の混み具合を保つ）
    refCanvasWidth: 1280,
    refCanvasHeight: 440,
    minTouchTargetCssPx: 44,     // 指で押すものの最小の大きさ（実際の画面上のpx。テストで確かめる）
    keyMinWidthCssPx: 32,        // ゲーム内キーボードのキーの最小の幅（実際の画面上のpx。テストで確かめる。Step21）
    keyMinHeightCssPx: 44,       // 同、高さ
    keyFlashMs: 140,             // 押したキーが光っている時間（ミリ秒。Step21）
  },

  // 性能の確認用（Phase 3 Step21）
  perf: {
    fpsSampleSec: 0.5,           // URLに ?fps=1 を付けたときの fps 表示を、何秒ごとに更新するか（秒）
  },

  // タッチ操作の機械向けの数字（Phase 3 Step17）
  touch: {
    silentAudioSec: 0.1,         // スタートのタップで鳴らす「無音の短い再生」の長さ（秒。音を解禁するため）
  },
};
