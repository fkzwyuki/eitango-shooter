// speech.js — ブラウザの読み上げ機能（Web Speech API の speechSynthesis）をラップする。
// DESIGN.md §4.1・§10.3: 出題時に自動で1回読む。英語の声（en-US）を優先して選ぶ。

window.EG = window.EG || {};

EG.speech = (function () {
  var supported = !!window.speechSynthesis;
  var voice = null;

  // 使える声の一覧から、英語の声（en-US優先、なければ en-* ）を選ぶ
  function pickVoice() {
    if (!supported) {
      return;
    }
    var voices = window.speechSynthesis.getVoices() || [];
    if (voices.length === 0) {
      return;
    }
    var usVoice = null;
    var enVoice = null;
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      if (!usVoice && v.lang === "en-US") {
        usVoice = v;
      }
      if (!enVoice && /^en/i.test(v.lang)) {
        enVoice = v;
      }
    }
    voice = usVoice || enVoice || null;
  }

  function init() {
    if (!supported) {
      console.warn("このブラウザは読み上げ（speechSynthesis）に対応していません");
      return;
    }
    pickVoice();
    // 声の一覧は非同期に読み込まれることがあるため、読み込み完了時にも選び直す
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }

  // 最初のタップのときに呼ぶ（Phase 3 Step17）。Android Chromeは、タップのあとでないと読み上げが鳴らず、
  // 声の一覧もあとから読み込まれることがあるので、声の一覧を取りに行き、音量0の空の読み上げを1回してしまう。
  // 英語の声が見つからなくても（voiceがnullのまま）エラーにしない（lang=en-US のまま端末の標準の声で読む）
  var primed = false;
  function prime() {
    if (!supported || primed) {
      return;
    }
    primed = true;
    try {
      pickVoice();
      var u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      u.lang = "en-US";
      window.speechSynthesis.speak(u);
    } catch (e) {
      // 失敗しても遊べる（読み上げなしになるだけ）
    }
  }

  // text を英語として読み上げる
  function speak(text) {
    if (!supported || !text) {
      return;
    }
    try {
      // 前の読み上げが残っていたら止めてから読む（出題連打・PASS連打での重なり防止）
      window.speechSynthesis.cancel();
      // 前のutteranceのonendが呼ばれないブラウザ対策で、ここでもいったんダッキングを戻しておく
      // （Step10。新しいutteranceのonstartですぐにtrueへ戻るので、正しく読み上げ中ならほぼ気にならない）
      if (EG.sounds) {
        EG.sounds.duckBgm(false);
      }
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.rate = EG.balance.speech.rate;
      utter.pitch = EG.balance.speech.pitch;
      if (voice) {
        utter.voice = voice;
      }
      // 読み上げている間はBGMを小さくする（Step9。DESIGN.md §10.3）
      utter.onstart = function () {
        if (EG.sounds) {
          EG.sounds.duckBgm(true);
        }
      };
      utter.onend = function () {
        if (EG.sounds) {
          EG.sounds.duckBgm(false);
        }
      };
      utter.onerror = function () {
        if (EG.sounds) {
          EG.sounds.duckBgm(false);
        }
      };
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn("読み上げに失敗しました", e);
    }
  }

  // 読み上げを止める（Step7: 一時停止したとき、読み上げ中なら止めるために使う）
  function stop() {
    if (!supported) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      // 対応していないブラウザでも無視してよい
    }
    // cancel()ではonendが呼ばれないブラウザもあるため、ここでも明示的にBGMの音量を戻す（Step9）
    if (EG.sounds) {
      EG.sounds.duckBgm(false);
    }
  }

  return { init: init, speak: speak, stop: stop, prime: prime, isSupported: function () { return supported; } };
})();
