// events.js — 「正解した／間違えた／PASSした」などを他の部分に知らせるための、
// 小さなイベントの仕組み（購読と発行だけのシンプルなもの）。
//
// Step3では commands.js が「問題に答えた結果」を "eg:answer" という名前で発行する。
// Step4（間違えたら敵が2体増える）・Step5（正解で中ボスにダメージ）は、
// EG.events.on("eg:answer", function (detail) { ... }) で受け取って使う想定。
// detail の形は commands.js のコメントを参照。

window.EG = window.EG || {};

EG.events = (function () {
  var listeners = {};

  function on(name, fn) {
    if (!listeners[name]) {
      listeners[name] = [];
    }
    listeners[name].push(fn);
  }

  function off(name, fn) {
    var list = listeners[name];
    if (!list) {
      return;
    }
    var i = list.indexOf(fn);
    if (i >= 0) {
      list.splice(i, 1);
    }
  }

  function emit(name, detail) {
    var list = listeners[name];
    if (!list) {
      return;
    }
    // 発行中にリスナーが増減しても影響が出ないよう、コピーしてから呼ぶ
    list.slice().forEach(function (fn) {
      fn(detail);
    });
  }

  return { on: on, off: off, emit: emit };
})();
