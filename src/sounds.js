// sounds.js — 音まわり（Step9。DESIGN.md §10）。
// BGM（タイトル→通常ウェーブ→中ボス戦→クリア/ゲームオーバーのジングル）と効果音を鳴らす。
// どの場面でどの魔王魂のファイルを鳴らすかは sound/README.md の対応表のとおり（下のBGM_FILES/SE_FILESに書く）。
// 見つかっていない音（warning・banner・pause・boss_down）は、Web Audioで合成した音や、他の音を加工した音で代わりに鳴らす。
//
// file:// で動かすため、読み込みは <audio>（new Audio(...)）だけを使う。fetch・decodeAudioDataは使わない
// （Web Audioの合成音は、外部ファイルを読まずにその場で波形を作るので問題ない）。
// ファイルが無い・読めない音は、鳴らさないだけでエラーにしない（見つからなければ"error"イベントで諦める、
// play()が失敗（Promiseがreject）してもcatchして無視する。ヘッドレスブラウザでのテストでも通るようにするため）。
//
// ブラウザの自動再生の制限: 最初のユーザー操作（クリック・キー）より前はBGMを鳴らさない。
// playBgmは操作前に呼ばれても「あとで鳴らす曲」として覚えておくだけにし、最初の操作があった瞬間に鳴らす。
//
// 一時停止（EG.pause）: 一時停止中はBGMを止め（pause、位置は残す）、効果音も新しく鳴らさない
// （pause.js側で、一時停止・再開そのものの音だけは例外的なタイミングで鳴らす）。
// 読み上げ中（speechSynthesis）はBGMを小さくする（duckBgm。speech.jsから呼ぶ）。

window.EG = window.EG || {};

EG.sounds = (function () {
  var B = null; // EG.balance.sound のキャッシュ（init時に取得）

  // ===== 場面の名前 → ファイルの対応表（sound/README.mdの「使った音源のメモ」のとおり） =====
  var BGM_FILES = {
    title: "sound/bgm/maou_game_theme15.mp3",
    stage: "sound/bgm/maou_game_medley02.mp3",
    boss: "sound/bgm/maou_game_boss03.mp3",
    clear: "sound/bgm/maou_game_jingle05.mp3",
    gameover: "sound/bgm/maou_game_jingle10.mp3",
  };
  var BGM_LOOP = { title: true, stage: true, boss: true, clear: false, gameover: false };

  var SE_FILES = {
    correct: "sound/se/maou_se_onepoint15.mp3",
    wrong: "sound/se/maou_se_onepoint33.mp3",
    pass: "sound/se/maou_se_onepoint26.mp3",
    select: "sound/se/maou_se_sound_ignition01.mp3",
    type: "sound/se/maou_se_system47.mp3",
    miss: "sound/se/maou_se_system35.mp3",
    explosion: "sound/se/maou_se_battle18.mp3",
    hit: "sound/se/maou_se_sound_pc03.mp3",
    bomb: "sound/se/maou_se_battle09.mp3",
    // warning / banner / pause は合成音、boss_down は bomb を加工して使う（下のplay()参照）
  };

  var muted = false;
  var unlocked = false;      // 最初のユーザー操作があったか
  var pendingBgmName = null; // 操作前にplayBgmが呼ばれたら、操作後に鳴らす曲名を覚えておく
  var audioCtx = null;       // 合成音・読み上げダッキング用のWeb Audio（外部ファイルは読まない）

  var bgmEls = {};        // name -> HTMLAudioElement（一度作ったら使い回す）
  var currentBgmName = null;
  var currentBgmEl = null;
  var duckActive = false; // 読み上げ中の減音フラグ

  var seBaseEls = {};      // name -> HTMLAudioElement（cloneNodeの元。読み込めるかの確認も兼ねる）
  var seUnavailable = {};  // name -> true（ファイルが無い・読めない）
  var lastSePlayedAt = {}; // name -> 直近に鳴らした時刻（ms）。間引きに使う
  var activeSeNodes = {};  // name -> 今鳴っているcloneNodeの配列（Step10。stopSeで途中で止めるために覚えておく）

  var playLog = [];    // 直近に鳴らした音の名前の記録（テストからの確認用。DESIGN.md/PHASE_GUIDE Step9）
  var playLogMax = 30;

  var els = {}; // ミュートボタンなどのDOM

  function logPlay(name) {
    playLog.push({ name: name, at: Date.now() });
    if (playLog.length > playLogMax) {
      playLog.shift();
    }
  }

  // ===== 音量の計算 =====

  function effectiveBgmVolume(name) {
    if (muted) {
      return 0;
    }
    var sceneVol = (B.bgmSceneVolume && B.bgmSceneVolume[name] != null) ? B.bgmSceneVolume[name] : 1;
    var vol = B.bgmMasterVolume * sceneVol;
    if (duckActive) {
      vol *= B.speechDuckMultiplier;
    }
    return EG.util.clamp(vol, 0, 1);
  }

  function effectiveSeVolume(name) {
    var sceneVol = (B.seVolume && B.seVolume[name] != null) ? B.seVolume[name] : 1;
    var vol = B.seMasterVolume * sceneVol;
    if (duckActive) {
      // 読み上げ中は効果音全体も小さくする（Step10。DESIGN.md §10.3 v0.6「読み上げ中は…効果音も小さくする」）
      vol *= B.speechSeDuckMultiplier;
    }
    return EG.util.clamp(vol, 0, 1);
  }

  function applyCurrentBgmVolume() {
    if (!currentBgmEl) {
      return;
    }
    currentBgmEl.volume = effectiveBgmVolume(currentBgmName);
  }

  // ===== BGM =====

  function getBgmEl(name) {
    if (bgmEls[name]) {
      return bgmEls[name];
    }
    var src = BGM_FILES[name];
    if (!src) {
      return null;
    }
    var el = new Audio(src);
    el.preload = "auto";
    el.loop = !!BGM_LOOP[name];
    bgmEls[name] = el;
    return el;
  }

  // el の音量を from → to へ durationSec かけて少しずつ変える（フェード）
  function fadeElementVolume(el, from, to, durationSec, onDone) {
    if (durationSec <= 0) {
      el.volume = to;
      if (onDone) {
        onDone();
      }
      return;
    }
    var start = null;
    function step(ts) {
      if (start === null) {
        start = ts;
      }
      var t = Math.min(1, (ts - start) / (durationSec * 1000));
      el.volume = from + (to - from) * t;
      if (t < 1) {
        requestAnimationFrame(step);
      } else if (onDone) {
        onDone();
      }
    }
    requestAnimationFrame(step);
  }

  // BGMを切り替える（同じ曲が既に鳴っていれば何もしない）。最初の操作より前なら、あとで鳴らす曲として覚えておくだけ
  function playBgm(name) {
    if (!unlocked) {
      pendingBgmName = name;
      return;
    }
    if (currentBgmName === name) {
      // 既に同じ曲が選ばれている。ただし一時停止中に「最初から」を選んだ場合はここに来て、
      // BGMが止まったままになってしまうので、その場合だけ曲の先頭から鳴らし直す
      // （DESIGN.md「『最初から』ではBGMをstageに戻す」。Step9）
      if (currentBgmEl && currentBgmEl.paused) {
        currentBgmEl.currentTime = 0;
        currentBgmEl.volume = effectiveBgmVolume(name);
        var resumeP = currentBgmEl.play();
        if (resumeP && resumeP.catch) {
          resumeP.catch(function () {});
        }
      }
      return;
    }
    var nextEl = getBgmEl(name);
    var prevEl = currentBgmEl;
    currentBgmName = name;
    currentBgmEl = nextEl;
    if (!nextEl) {
      // ファイルが無い場合は黙って何も鳴らさない（前の曲だけフェードアウトして止める）
      if (prevEl) {
        fadeElementVolume(prevEl, prevEl.volume, 0, B.bgmFadeSec, function () {
          prevEl.pause();
        });
      }
      return;
    }
    nextEl.currentTime = 0;
    nextEl.volume = 0;
    var playPromise = nextEl.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(function () {
        // 自動再生制限やヘッドレス環境でplay()が失敗しても、エラーにしない（DESIGN.md §10.1）
      });
    }
    fadeElementVolume(nextEl, 0, effectiveBgmVolume(name), B.bgmFadeSec);
    if (prevEl && prevEl !== nextEl) {
      fadeElementVolume(prevEl, prevEl.volume, 0, B.bgmFadeSec, function () {
        prevEl.pause();
      });
    }
  }

  // 一時停止に入るとき（pause.jsから呼ぶ）。BGMは止めるが位置は残す
  function pauseBgm() {
    if (currentBgmEl) {
      currentBgmEl.pause();
    }
  }

  // 一時停止から再開するとき（pause.jsから呼ぶ）。止めた位置から続きを鳴らす
  function resumeBgm() {
    if (!currentBgmEl || !unlocked || muted) {
      return;
    }
    var p = currentBgmEl.play();
    if (p && p.catch) {
      p.catch(function () {});
    }
  }

  var duckWatchdogTimer = null; // Step10: ダッキングが戻らないまま固まるのを防ぐ保険（下記duckBgm参照）

  // 読み上げ中はBGM・効果音を小さくする（speech.jsから呼ぶ。DESIGN.md §10.3）。
  // Step10: 読み上げのonstart/onendが正しく呼ばれないブラウザがあると、duckActiveがtrueのまま戻らず
  // BGMが小さいまま（＝止まっているように聞こえる）固まってしまう可能性があったため、
  // 保険としてdWatchdogMs後に強制的に元へ戻すタイマーを必ず仕掛ける（IMPLEMENTATION_NOTES.md Step10参照）
  function duckBgm(active) {
    duckActive = !!active;
    applyCurrentBgmVolume();
    if (duckWatchdogTimer) {
      clearTimeout(duckWatchdogTimer);
      duckWatchdogTimer = null;
    }
    if (duckActive) {
      duckWatchdogTimer = setTimeout(function () {
        duckWatchdogTimer = null;
        duckActive = false;
        applyCurrentBgmVolume();
      }, B.duckWatchdogMs);
    }
  }

  // ===== 効果音（<audio>のcloneNodeで重ねて鳴らせるようにする） =====

  function getSeBaseEl(name) {
    if (seBaseEls[name]) {
      return seBaseEls[name];
    }
    var src = SE_FILES[name];
    if (!src) {
      return null;
    }
    var el = new Audio(src);
    el.preload = "auto";
    el.addEventListener("error", function () {
      seUnavailable[name] = true; // 読み込めない音は、以降そっと諦める（鳴らさないだけ）
    });
    seBaseEls[name] = el;
    return el;
  }

  // 鳴らし始めたcloneNodeを覚えておき、あとでstopSe()から途中で止められるようにする（Step10）。
  // 自然に鳴り終わった（ended）・すでに止められた（pause）ときは、覚えている配列から取り除く
  function trackSeNode(name, node) {
    if (!activeSeNodes[name]) {
      activeSeNodes[name] = [];
    }
    activeSeNodes[name].push(node);
    function untrack() {
      var list = activeSeNodes[name];
      if (!list) {
        return;
      }
      var idx = list.indexOf(node);
      if (idx !== -1) {
        list.splice(idx, 1);
      }
    }
    node.addEventListener("ended", untrack);
    node.addEventListener("pause", untrack);
  }

  // nodeの音量をだんだん下げてから止める（短いフェード。0秒なら即座に止める）
  function fadeOutAndPause(node, fadeSec) {
    if (node.paused) {
      return;
    }
    var from = node.volume;
    if (!fadeSec || fadeSec <= 0 || from <= 0) {
      node.pause();
      return;
    }
    var start = null;
    function step(ts) {
      if (node.paused) {
        return; // 途中で別の理由（自然終了など）で止まっていたら何もしない
      }
      if (start === null) {
        start = ts;
      }
      var t = Math.min(1, (ts - start) / (fadeSec * 1000));
      node.volume = from * (1 - t);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        node.pause();
      }
    }
    requestAnimationFrame(step);
  }

  // 今鳴っている効果音（correct/wrong/passなど）を途中で止める（Step10。DESIGN.md §10.3 v0.6
  // 「問題が始まるとき、まだ鳴っている正解・不正解などの効果音は止める」）。namesは名前の配列
  function stopSe(names) {
    var fadeSec = B ? B.seStopFadeSec : 0;
    (names || []).forEach(function (name) {
      var list = activeSeNodes[name];
      if (!list || list.length === 0) {
        return;
      }
      list.slice().forEach(function (node) {
        fadeOutAndPause(node, fadeSec);
      });
    });
  }

  // name: SE_FILESのキー。opts.logName で記録上の名前を差し替えられる（boss_downなど）
  function playSe(name, opts) {
    if (muted || !unlocked) {
      return;
    }
    if (EG.pause && EG.pause.isPaused()) {
      return; // 一時停止中は新しく鳴らさない（pause自身の音はpause.js側で別に呼ぶ）
    }
    if (seUnavailable[name]) {
      return;
    }
    var logName = (opts && opts.logName) || name;
    var minInterval = (B.seMinIntervalMs && B.seMinIntervalMs[name]) || 0;
    var now = Date.now();
    if (minInterval > 0 && lastSePlayedAt[name] && now - lastSePlayedAt[name] < minInterval) {
      return; // 短い間隔で重なりすぎないよう間引く
    }
    lastSePlayedAt[name] = now;

    var base = getSeBaseEl(name);
    if (!base) {
      return;
    }
    var node = base.cloneNode(true); // 複製して重ねて鳴らせるようにする（同時に何度も鳴る音のため）
    node.volume = (opts && opts.volume != null) ? opts.volume : effectiveSeVolume(name);
    if (opts && opts.playbackRate) {
      node.playbackRate = opts.playbackRate;
    }
    var p = node.play();
    if (p && p.catch) {
      p.catch(function () {
        // ヘッドレス環境・自動再生制限でplay()が失敗してもエラーにしない
      });
    }
    logPlay(logName);
    trackSeNode(name, node); // stopSe()から途中で止められるように覚えておく（Step10）

    // 長すぎる効果音は、この長さで強制的に切る（フェードして止める。Step10。DESIGN.md §10.3 v0.6）
    var maxDur = B.seMaxDurationSec && B.seMaxDurationSec[name];
    if (maxDur) {
      setTimeout(function () {
        fadeOutAndPause(node, B.seStopFadeSec);
      }, maxDur * 1000);
    }
  }

  // 中ボス撃破音: bomb.mp3を低く・長く鳴らして代わりにする（sound/README.md「探し中」の代替案）
  function playBossDown() {
    playSe("bomb", {
      logName: "boss_down",
      playbackRate: B.bossDownPlaybackRate,
      volume: effectiveSeVolume("bomb") * B.bossDownVolumeMultiplier,
    });
  }

  // ===== 合成音（Web Audio。見つかっていない音の代わり） =====

  function getAudioCtx() {
    if (audioCtx) {
      return audioCtx;
    }
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    try {
      audioCtx = new Ctor();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function synthAllowed() {
    if (muted || !unlocked) {
      return false;
    }
    if (EG.pause && EG.pause.isPaused()) {
      return false;
    }
    return true;
  }

  // WARNING: サイレン（周波数を高低に繰り返しスイープするオシレーター）
  function playWarningSiren() {
    if (!synthAllowed()) {
      return;
    }
    var ctx = getAudioCtx();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    var dur = B.warningSirenSec;
    var osc = ctx.createOscillator();
    osc.type = "sawtooth";
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    var cycles = Math.max(1, B.warningSirenCycles);
    var cycleLen = dur / cycles;
    osc.frequency.setValueAtTime(B.warningSirenFreqLow, now);
    for (var i = 0; i < cycles; i++) {
      var t0 = now + cycleLen * i;
      var tMid = t0 + cycleLen / 2;
      var t1 = t0 + cycleLen;
      osc.frequency.linearRampToValueAtTime(B.warningSirenFreqHigh, tMid);
      osc.frequency.linearRampToValueAtTime(B.warningSirenFreqLow, t1);
    }

    var vol = B.synthVolume;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.05);
    gain.gain.setValueAtTime(vol, Math.max(now + 0.05, now + dur - 0.12));
    gain.gain.linearRampToValueAtTime(0, now + dur);

    osc.start(now);
    osc.stop(now + dur);
    logPlay("warning");
  }

  // WAVEの文字が入ってくるときの風切り音（ノイズをバンドパスフィルターでスイープさせる）
  function playBannerSwoosh() {
    if (!synthAllowed()) {
      return;
    }
    var ctx = getAudioCtx();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    var dur = B.bannerSwooshSec;
    var bufferSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1; // ホワイトノイズ（外部ファイルは読まず、その場で波形を作る）
    }
    var noise = ctx.createBufferSource();
    noise.buffer = buffer;

    var filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(B.bannerSwooshFreqStart, now);
    filter.frequency.linearRampToValueAtTime(B.bannerSwooshFreqEnd, now + dur);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(B.synthVolume * 0.7, now + dur * 0.2);
    gain.gain.linearRampToValueAtTime(0, now + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);
    logPlay("banner");
  }

  // 被弾音に重ねる、低い衝撃音「ドンッ」（Step10。DESIGN.md §5.1 v0.6「被弾音は重い『ドンッ』
  // （今の音にプログラムで作った低い衝撃音を重ねる）」）。周波数を高→低へ一気に落として沈むような音にする
  function playHitThud() {
    if (!synthAllowed()) {
      return;
    }
    var ctx = getAudioCtx();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    var dur = B.hitThudSec;
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(B.hitThudFreqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, B.hitThudFreqEnd), now + dur);
    var gain = ctx.createGain();
    var vol = B.synthVolume * B.hitThudVolumeMultiplier;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  // 弾幕（飾りの弾）に当たったときの音（Step12。DESIGN.md §5.1 v0.7.1）。大きさ（small/medium/large）で音を変える。
  // どれも本当の被弾の「ドンッ」より軽い合成音。読み上げ中は効果音全体と同じ倍率で小さくする（speechSeDuckMultiplier）。
  // 鳴らしすぎないよう、同じ大きさの音は seMinIntervalMs より短い間隔では鳴らさない
  function playDecoHit(tier) {
    if (!synthAllowed()) {
      return;
    }
    var name = "deco_hit_" + tier;
    var minInterval = (B.seMinIntervalMs && B.seMinIntervalMs[name]) || 0;
    var nowMs = Date.now();
    if (minInterval > 0 && lastSePlayedAt[name] && nowMs - lastSePlayedAt[name] < minInterval) {
      return;
    }
    lastSePlayedAt[name] = nowMs;
    var ctx = getAudioCtx();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    var duck = duckActive ? B.speechSeDuckMultiplier : 1;
    var dur;
    var vol;
    var freqStart;
    var freqEnd;
    var type;
    var noiseAmount; // 音にまぜるノイズ（ザッという成分）の量（0〜1）
    if (tier === "large") {
      dur = B.decoHitLargeSec;
      vol = B.decoHitLargeVolume;
      freqStart = B.decoHitLargeFreqStart;
      freqEnd = B.decoHitLargeFreqEnd;
      type = "sine";
      noiseAmount = 0.5;
    } else if (tier === "medium") {
      dur = B.decoHitMediumSec;
      vol = B.decoHitMediumVolume;
      freqStart = B.decoHitMediumFreqStart;
      freqEnd = B.decoHitMediumFreqEnd;
      type = "triangle";
      noiseAmount = 0.3;
    } else {
      dur = B.decoHitSmallSec;
      vol = B.decoHitSmallVolume;
      freqStart = B.decoHitSmallFreq;
      freqEnd = B.decoHitSmallFreq * 0.6;
      type = "square";
      noiseAmount = 0.2;
    }
    var peak = B.synthVolume * vol * duck;

    var osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + dur);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(peak * (1 - noiseAmount), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);

    // ザッというノイズを短く重ねる（火花が散る感じ）
    var bufferSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    var noise = ctx.createBufferSource();
    noise.buffer = buffer;
    var ngain = ctx.createGain();
    ngain.gain.setValueAtTime(peak * noiseAmount, now);
    ngain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(ngain);
    ngain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);
    logPlay(name);
  }

  // 一時停止・再開の短い音（ビープ）
  function playPauseBlip() {
    if (muted || !unlocked) {
      return; // これ自体が一時停止の合図の音なので、isPaused()では止めない（pause.js側で呼ぶタイミングを調整している）
    }
    var ctx = getAudioCtx();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    var dur = B.pauseBlipSec;
    var osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = B.pauseBlipFreq;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(B.synthVolume * 0.6, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
    logPlay("pause");
  }

  // ===== 呼び出し口（場面の名前だけ渡せば、SEでも合成音でも鳴らし分ける） =====

  function play(name) {
    if (name === "warning") {
      playWarningSiren();
      return;
    }
    if (name === "banner") {
      playBannerSwoosh();
      return;
    }
    if (name === "pause") {
      playPauseBlip();
      return;
    }
    if (name === "boss_down") {
      playBossDown();
      return;
    }
    if (name === "deco_hit_small" || name === "deco_hit_medium" || name === "deco_hit_large") {
      playDecoHit(name.slice("deco_hit_".length)); // 弾幕（飾りの弾）に当たった音（Step12）
      return;
    }
    if (name === "hit") {
      // 被弾音は今までのSEに加えて、プログラムで合成した低い衝撃音を重ねる（Step10）
      playSe("hit");
      playHitThud();
      return;
    }
    playSe(name);
  }

  // ===== ミュート（localStorageに覚える。Step9） =====

  var MUTE_STORAGE_KEY = "eitango_shooter_muted";

  function loadMutedFromStorage() {
    try {
      return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
    } catch (e) {
      return false; // 使えない環境（プライベートモード等）では無視してよい
    }
  }

  function saveMutedToStorage(v) {
    try {
      window.localStorage.setItem(MUTE_STORAGE_KEY, v ? "1" : "0");
    } catch (e) {
      // 無視してよい
    }
  }

  function updateMuteButton() {
    if (els.muteIcon) {
      els.muteIcon.textContent = muted ? "🔇" : "🔊"; // ボタンの中の絵文字だけ書き換える（右下の「7」のヒントは残す。Step11）
    }
    if (els.muteBtn) {
      els.muteBtn.setAttribute("aria-label", muted ? "ミュート解除" : "ミュート");
    }
    // タイトル画面の「今の音の状態」（Step11。前回ミュートにしたまま最初から音が出ない、に気づけるように）
    if (els.titleState) {
      var touchMode = document.body.classList.contains("touch"); // タッチの機械では「7キー」の案内を出さない（Step17）
      els.titleState.textContent = muted
        ? (touchMode ? "🔇 音：オフ（右上のボタンでオンにできます）" : "🔇 音：オフ（7 キーでオンにできます）")
        : (touchMode ? "🔊 音：オン（右上のボタンでオフにできます）" : "🔊 音：オン（7 キーでオフにできます）");
      els.titleState.classList.toggle("sound-off", muted);
    }
  }

  function setMuted(v) {
    muted = !!v;
    saveMutedToStorage(muted);
    applyCurrentBgmVolume();
    updateMuteButton();
  }

  function toggleMuted() {
    setMuted(!muted);
  }

  // ===== 最初のユーザー操作で音を解禁する（DESIGN.md §10「ブラウザの自動再生の制限」） =====

  // 無音の短いWAV（data URI）を作る。スマホ（Android Chrome）の自動再生の制限への対策で、最初のタップのときに
  // 1回鳴らしておく（Phase 3 Step17）。ファイルを読まないのでfile://でも動く
  function makeSilentWavUri(sec) {
    var rate = 8000;
    var n = Math.max(1, Math.round(rate * sec));
    var bytes = new Uint8Array(44 + n);
    function w32(o, v) { bytes[o] = v & 255; bytes[o + 1] = (v >> 8) & 255; bytes[o + 2] = (v >> 16) & 255; bytes[o + 3] = (v >> 24) & 255; }
    function w16(o, v) { bytes[o] = v & 255; bytes[o + 1] = (v >> 8) & 255; }
    function ws(o, str) { for (var i = 0; i < str.length; i++) { bytes[o + i] = str.charCodeAt(i); } }
    ws(0, "RIFF"); w32(4, 36 + n); ws(8, "WAVE"); ws(12, "fmt "); w32(16, 16); w16(20, 1); w16(22, 1);
    w32(24, rate); w32(28, rate); w16(32, 1); w16(34, 8); ws(36, "data"); w32(40, n);
    for (var i = 0; i < n; i++) { bytes[44 + i] = 128; } // 8bitの無音は128
    var bin = "";
    for (var j = 0; j < bytes.length; j++) { bin += String.fromCharCode(bytes[j]); }
    return "data:audio/wav;base64," + btoa(bin);
  }

  var silentPrimed = false;
  function primeSilentAudio() {
    if (silentPrimed) {
      return;
    }
    silentPrimed = true;
    try {
      var a = new Audio(makeSilentWavUri(EG.balance.touch.silentAudioSec));
      a.volume = 0;
      var p = a.play();
      if (p && p.catch) {
        p.catch(function () {});
      }
    } catch (e) {
      // 鳴らせなくても遊べる
    }
  }

  function unlock() {
    if (unlocked) {
      return;
    }
    unlocked = true;
    primeSilentAudio();
    if (EG.speech && EG.speech.prime) {
      EG.speech.prime(); // 読み上げも最初のタップで使える状態に
    }
    var ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(function () {});
    }
    if (pendingBgmName) {
      var name = pendingBgmName;
      pendingBgmName = null;
      playBgm(name);
    }
  }

  // ===== 音のオン・オフは「7」キー（Step11。DESIGN.md §3.1・§3.2 v0.7。Mキーは廃止） =====
  // 7 はタイピング・並べ替えの文字（英字）や、カード・熟語の選択（1〜3）、PASS（5）とぶつからないので、
  // 問題を解いている最中でも、タイトル・一時停止・結果画面でも効く。押しっぱなしで切り替わり続けないよう、repeatは無視する

  function onKeyDownMute(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) {
      return;
    }
    if (!EG.util.isDigitKey(e, "7")) {
      return;
    }
    toggleMuted();
  }

  // 最初のキー・クリックのあと、BGMが鳴るはずなのに止まっていたら、鳴らし直す。
  // ブラウザによっては、最初に押したキー（Escなど）が「ユーザー操作」と認められず、BGMのplay()が
  // 断られたまま黙り込むことがあるため（Step11: キーだけで始めても確実に音が鳴るように）
  function retryBgmIfStuck() {
    if (!unlocked || muted || !currentBgmEl) {
      return;
    }
    if (EG.pause && EG.pause.isPaused()) {
      return;
    }
    if (currentBgmEl.paused && !currentBgmEl.ended) {
      var p = currentBgmEl.play();
      if (p && p.catch) {
        p.catch(function () {});
      }
    }
  }

  function init() {
    B = EG.balance.sound;
    muted = loadMutedFromStorage();

    els = {
      muteBtn: document.getElementById("mute-button"),
      muteIcon: document.getElementById("mute-icon"),
      titleState: document.getElementById("title-sound-state"),
    };
    updateMuteButton();
    if (els.muteBtn) {
      EG.util.onTap(els.muteBtn, function () { // 指が触れた瞬間に切り替える（Step21）
        toggleMuted(); // ボタンは常に使える（問題に答えている最中でも）
      });
    }

    document.addEventListener("keydown", onKeyDownMute);
    // 最初のクリック・キー入力で音を解禁する（1回だけでよい）
    document.addEventListener("click", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
    // 解禁済みでもBGMが止まっていたら、次のキー・クリックで鳴らし直す（上のretryBgmIfStuck参照。Step11）
    document.addEventListener("click", retryBgmIfStuck, { capture: true });
    document.addEventListener("keydown", retryBgmIfStuck, { capture: true });
  }

  // ===== テスト（tools/test/bgm_test.js）専用の読み口・書き口（Step10） =====
  // BGMが実際に「鳴り続けているか」（pausedでないか・音量が0のまま固まっていないか・currentTimeが
  // 進んでいるか）を1秒ごとに記録して確かめるために使う。DESIGN.md §10.2「ゲーム中のBGMは、クリアか
  // ゲームオーバーまで途切れずに繰り返す」の実測用
  function getBgmDebugInfo() {
    if (!currentBgmEl) {
      return { name: currentBgmName, exists: false, paused: true, volume: 0, currentTime: 0, duration: 0, loop: false };
    }
    return {
      name: currentBgmName,
      exists: true,
      paused: currentBgmEl.paused,
      volume: currentBgmEl.volume,
      currentTime: currentBgmEl.currentTime,
      duration: currentBgmEl.duration || 0,
      loop: currentBgmEl.loop,
      readyState: currentBgmEl.readyState,
    };
  }

  // 今鳴っているBGMの再生位置を強制的に動かす（ループの継ぎ目のテスト用。曲の終わり近くまで早送りできる）
  function debugSetBgmTime(sec) {
    if (!currentBgmEl || isNaN(currentBgmEl.duration)) {
      return false;
    }
    currentBgmEl.currentTime = EG.util.clamp(sec, 0, Math.max(0, currentBgmEl.duration - 0.05));
    return true;
  }

  return {
    init: init,
    playBgm: playBgm,
    pauseBgm: pauseBgm,
    resumeBgm: resumeBgm,
    duckBgm: duckBgm,
    play: play,
    stopSe: stopSe,
    setMuted: setMuted,
    toggleMuted: toggleMuted,
    isMuted: function () { return muted; },
    isUnlocked: function () { return unlocked; },
    getCurrentBgm: function () { return currentBgmName; },
    isBgmPlaying: function () { return !!(currentBgmEl && !currentBgmEl.paused); },
    // テストから「直近に何の音が鳴ったか」を確認するための読み口（PHASE_GUIDE.md Step9）
    getLastPlayed: function () { return playLog.length ? playLog[playLog.length - 1].name : null; },
    getPlayLog: function () { return playLog.slice(); },
    // Step10: BGMが止まっていないかを詳しく確かめるための読み口・書き口（tools/test/bgm_test.js）
    getBgmDebugInfo: getBgmDebugInfo,
    debugSetBgmTime: debugSetBgmTime,
  };
})();
