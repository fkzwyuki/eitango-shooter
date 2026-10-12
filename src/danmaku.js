// danmaku.js — 東方Project風の飾りの弾幕（Step11。DESIGN.md §5.1 v0.7）。
//
// ここで出す弾は「見た目だけ」。画面の混み具合（EG.battle.congestionCount。＝ライフの減る速さ）には数えない。
// Step12（DESIGN.md §5.1 v0.7.1）: 飾りの弾は自機にぶつかる（円の当たり判定。当たった弾は消える）。
// ただしぶつかっても、ライフ・ショット・点数・混み具合は一切変えない。当たったことは onHit（battle.js）へ知らせ、
// 弾の大きさに合った火花・点滅・揺れ・音を出すのは battle.js の役目（ここは「当たったか」の判定だけ）。
// ライフが減るのは今までどおり、被弾タイマーが鳴ったときの赤い弾だけ。
// だから弾をどれだけ派手に増やしても、放置でライフが尽きるまでの時間は変わらない。
//
// 重くならないよう、弾の見た目（形×色）は小さなcanvasへ最初に1回だけ描いておき（buildSprites）、
// 毎フレームはdrawImageで貼るだけにする（毎フレームshadowBlurなどの重い処理は使わない）。
// 光って見せるため、弾はまとめて加算合成（'lighter'）で描く。
//
// 撃ち方は「部品（emitter）」の組み合わせ: aimed（自機狙いの扇）・ring（円形）・spiral（渦巻き）・scatter（ばらまき）。
// ザコは種類（balance.danmaku.kinds）ごとに、中ボスは花の弾幕（balance.danmaku.boss.phases）を撃つ。
// 数字はすべて balance.js の danmaku にある。

window.EG = window.EG || {};

EG.danmaku = (function () {
  var D = null;          // EG.balance.danmaku のキャッシュ
  var W = 0;
  var H = 0;
  var TWO_PI = Math.PI * 2;

  var bullets = [];      // 飾りの弾 { x, y, vx, vy, spr, rot, spin, phase }
  var sprites = {};      // "type:color" -> { c(canvas), cx, cy, directional, spin }
  var built = false;
  var kindNames = [];
  var clock = 0;         // 星弾を回すための経過時間
  var bossState = null;  // 中ボスの弾幕の進み具合 { phase, t, states }
  var hitHandler = null; // 飾りの弾が自機に当たったときに呼ぶ関数 function (bullet, tier)（Step12。battle.jsが登録する）

  // 色（赤・青・紫・緑・黄・水色・橙・桃）。main=ふちの色、light=芯のまわり、rgb=にじみ用
  var PALETTE = {
    red:    { main: "#ff2f4d", light: "#ffc2cc", rgb: "255,47,77" },
    blue:   { main: "#3a7bff", light: "#c2d6ff", rgb: "58,123,255" },
    purple: { main: "#b24bff", light: "#e8c8ff", rgb: "178,75,255" },
    green:  { main: "#37e86a", light: "#c8ffd8", rgb: "55,232,106" },
    yellow: { main: "#ffdf30", light: "#fff8c4", rgb: "255,223,48" },
    cyan:   { main: "#30dfff", light: "#c4f6ff", rgb: "48,223,255" },
    orange: { main: "#ff8a2a", light: "#ffd9b0", rgb: "255,138,42" },
    pink:   { main: "#ff5cc8", light: "#ffcaee", rgb: "255,92,200" },
  };
  var COLOR_NAMES = Object.keys(PALETTE);
  var TYPE_NAMES = ["pellet", "orb", "rice", "kunai", "star", "big"];

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function makeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  // ===== 弾の絵を最初に描いておく（形×色。白い芯＋色のふち＋光のにじみ） =====

  // 丸い弾（小玉・光る丸弾）: 外側のにじみ → 色のふち → 白い芯
  function buildRound(r, col) {
    var glow = Math.ceil(r * D.glowScale);
    var S = glow * 2 + 2;
    var cv = makeCanvas(S, S);
    var g = cv.getContext("2d");
    var c = S / 2;
    var halo = g.createRadialGradient(c, c, r * 0.5, c, c, glow);
    halo.addColorStop(0, "rgba(" + col.rgb + ",0.75)");
    halo.addColorStop(1, "rgba(" + col.rgb + ",0)");
    g.fillStyle = halo;
    g.beginPath();
    g.arc(c, c, glow, 0, TWO_PI);
    g.fill();
    g.fillStyle = col.main;
    g.beginPath();
    g.arc(c, c, r, 0, TWO_PI);
    g.fill();
    var core = g.createRadialGradient(c, c, 0, c, c, r * 0.78);
    core.addColorStop(0, "#ffffff");
    core.addColorStop(0.65, "#ffffff");
    core.addColorStop(1, col.light);
    g.fillStyle = core;
    g.beginPath();
    g.arc(c, c, r * 0.76, 0, TWO_PI);
    g.fill();
    return { c: cv, cx: c, cy: c, directional: false, spin: false };
  }

  // 大玉: 半透明の大きな球（ふちが濃く、中は明るい）
  function buildBig(r, col) {
    var glow = Math.ceil(r * 1.5);
    var S = glow * 2 + 2;
    var cv = makeCanvas(S, S);
    var g = cv.getContext("2d");
    var c = S / 2;
    var halo = g.createRadialGradient(c, c, r * 0.6, c, c, glow);
    halo.addColorStop(0, "rgba(" + col.rgb + ",0.6)");
    halo.addColorStop(1, "rgba(" + col.rgb + ",0)");
    g.fillStyle = halo;
    g.beginPath();
    g.arc(c, c, glow, 0, TWO_PI);
    g.fill();
    var body = g.createRadialGradient(c, c, 0, c, c, r);
    body.addColorStop(0, "rgba(" + col.rgb + ",0.25)");
    body.addColorStop(0.6, "rgba(" + col.rgb + ",0.5)");
    body.addColorStop(0.9, col.main);
    body.addColorStop(1, col.light);
    g.fillStyle = body;
    g.beginPath();
    g.arc(c, c, r, 0, TWO_PI);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, r * 0.82, 0, TWO_PI);
    g.stroke();
    var spot = g.createRadialGradient(c, c, 0, c, c, r * 0.4);
    spot.addColorStop(0, "rgba(255,255,255,0.9)");
    spot.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = spot;
    g.beginPath();
    g.arc(c, c, r * 0.4, 0, TWO_PI);
    g.fill();
    return { c: cv, cx: c, cy: c, directional: false, spin: false };
  }

  // 米粒弾: 細長い楕円。進む向きに合わせて回して使う（絵は下向き＝+y方向が長い）
  function buildRice(hw, hl, col) {
    var pad = 7;
    var w = Math.ceil(hw + pad) * 2;
    var h = Math.ceil(hl + pad) * 2;
    var cv = makeCanvas(w, h);
    var g = cv.getContext("2d");
    var cx = w / 2;
    var cy = h / 2;
    g.shadowColor = col.main;
    g.shadowBlur = 8;
    g.fillStyle = col.main;
    for (var i = 0; i < 2; i++) { // 2回重ねて光を強くする（事前に描くだけなので重くない）
      g.beginPath();
      g.ellipse(cx, cy, hw, hl, 0, 0, TWO_PI);
      g.fill();
    }
    g.shadowBlur = 0;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(cx, cy, hw * 0.55, hl * 0.72, 0, 0, TWO_PI);
    g.fill();
    return { c: cv, cx: cx, cy: cy, directional: true, spin: false };
  }

  // クナイ弾: とがった先（下向き）と平らな後ろを持つ葉のような形
  function buildKunai(hw, hl, col) {
    var pad = 7;
    var w = Math.ceil(hw + pad) * 2;
    var h = Math.ceil(hl + pad) * 2;
    var cv = makeCanvas(w, h);
    var g = cv.getContext("2d");
    var cx = w / 2;
    var cy = h / 2;
    function shape(k) {
      g.beginPath();
      g.moveTo(cx, cy + hl * k);
      g.lineTo(cx + hw * k, cy + hl * 0.05 * k);
      g.lineTo(cx + hw * 0.55 * k, cy - hl * k);
      g.lineTo(cx - hw * 0.55 * k, cy - hl * k);
      g.lineTo(cx - hw * k, cy + hl * 0.05 * k);
      g.closePath();
    }
    g.shadowColor = col.main;
    g.shadowBlur = 8;
    g.fillStyle = col.main;
    shape(1);
    g.fill();
    shape(1);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#ffffff";
    shape(0.5);
    g.fill();
    return { c: cv, cx: cx, cy: cy, directional: true, spin: false };
  }

  // 星弾: 5つの角。くるくる回して使う
  function buildStar(r, col) {
    var pad = 7;
    var S = Math.ceil(r + pad) * 2;
    var cv = makeCanvas(S, S);
    var g = cv.getContext("2d");
    var c = S / 2;
    function shape(k) {
      g.beginPath();
      for (var i = 0; i < 10; i++) {
        var rr = (i % 2 === 0 ? r : r * 0.45) * k;
        var a = -Math.PI / 2 + (i * Math.PI) / 5;
        var x = c + Math.cos(a) * rr;
        var y = c + Math.sin(a) * rr;
        if (i === 0) {
          g.moveTo(x, y);
        } else {
          g.lineTo(x, y);
        }
      }
      g.closePath();
    }
    g.shadowColor = col.main;
    g.shadowBlur = 8;
    g.fillStyle = col.main;
    shape(1);
    g.fill();
    shape(1);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#ffffff";
    shape(0.5);
    g.fill();
    return { c: cv, cx: c, cy: c, directional: false, spin: true };
  }

  function buildSprite(type, colorName) {
    var col = PALETTE[colorName];
    var z = D.sizes;
    if (type === "pellet") { return buildRound(z.pelletRadius, col); }
    if (type === "orb") { return buildRound(z.orbRadius, col); }
    if (type === "rice") { return buildRice(z.riceHalfWidth, z.riceHalfLength, col); }
    if (type === "kunai") { return buildKunai(z.kunaiHalfWidth, z.kunaiHalfLength, col); }
    if (type === "star") { return buildStar(z.starRadius, col); }
    if (type === "big") { return buildBig(z.bigRadius, col); }
    return null;
  }

  function buildSprites() {
    if (built) {
      return;
    }
    sprites = {};
    for (var t = 0; t < TYPE_NAMES.length; t++) {
      for (var c = 0; c < COLOR_NAMES.length; c++) {
        sprites[TYPE_NAMES[t] + ":" + COLOR_NAMES[c]] = buildSprite(TYPE_NAMES[t], COLOR_NAMES[c]);
      }
    }
    built = true;
  }

  function getSprite(type, colorName) {
    return sprites[type + ":" + colorName] || sprites["orb:red"];
  }

  // ===== 弾を1発出す（angは進む向き。0＝右、π/2＝真下） =====

  // 縦の画面（スマホ）かどうか。縦のときは飾りの弾を減らして軽くする（Step21）
  function isPortrait() {
    return !!(EG.layout && EG.layout.isPortrait && EG.layout.isPortrait());
  }

  function spawn(x, y, ang, speed, type, colorName) {
    if (bullets.length >= (isPortrait() ? D.maxBulletsPortrait : D.maxBullets)) {
      return;
    }
    var spr = getSprite(type, colorName);
    bullets.push({
      x: x,
      y: y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      hr: D.hit.bulletRadius[type] || 6,   // 当たり判定の半径（Step12）
      tier: D.hit.tier[type] || "small",   // 当たったときの反応の大きさ small/medium/large（Step12）
      rgb: PALETTE[colorName] ? PALETTE[colorName].rgb : "255,255,255", // 消滅の火花の色（Step12）
      spr: spr,
      rot: spr.directional ? ang - Math.PI / 2 : 0,
      spin: spr.spin,
      phase: Math.random() * TWO_PI,
    });
  }

  // ===== 撃ち方の部品（emitter） =====

  function newEmitterState(em) {
    var period = em.activeSec ? em.activeSec + em.restSec : 0;
    return {
      t: rand(0, em.intervalSec),        // 次に撃つまでの残り（最初はばらつかせる）
      ang: rand(0, TWO_PI),               // 渦巻き・リングの今の向き
      n: 0,                                // 何回撃ったか（色を順番に選ぶのに使う）
      cycle: period ? rand(0, period) : 0, // 「撃つ／休む」の周期の中での位置
    };
  }

  function pickColor(em, index) {
    return em.colors[index % em.colors.length];
  }

  function fireOnce(em, st, x, y, px, py) {
    var i;
    var speed = em.speed;
    if (em.kind === "aimed") {
      // 自機狙いの扇。偶数発なら自機は弾と弾の間にくる
      var base = Math.atan2(py - y, px - x);
      var n = em.count;
      var spread = toRad(em.spreadDeg);
      var color = pickColor(em, st.n);
      for (i = 0; i < n; i++) {
        var a = base + (n <= 1 ? 0 : (i / (n - 1) - 0.5) * spread);
        spawn(x, y, a, speed, em.type, color);
      }
    } else if (em.kind === "ring") {
      // 円形にばらまく。撃つたびに半歩ずつずらして、隙間が交互になるようにする
      var cnt = em.count;
      var offset = (st.n % 2) * (Math.PI / cnt) + st.ang;
      var ringColor = pickColor(em, st.n);
      for (i = 0; i < cnt; i++) {
        spawn(x, y, offset + (i * TWO_PI) / cnt, speed, em.type, ringColor);
      }
      st.ang += toRad(em.turnDeg || 0);
    } else if (em.kind === "spiral") {
      // 渦巻き: 腕を等間隔に出し、撃つたびに向きを少しずつ回す
      for (i = 0; i < em.arms; i++) {
        spawn(x, y, st.ang + (i * TWO_PI) / em.arms, speed, em.type, pickColor(em, i));
      }
      st.ang += toRad(em.turnDeg);
    } else if (em.kind === "scatter") {
      // ばらまき: 下向きの範囲にランダムに
      for (i = 0; i < em.count; i++) {
        var sa = Math.PI / 2 + rand(-0.5, 0.5) * toRad(em.spreadDeg);
        var sp = speed * rand(1 - (em.speedJitter || 0), 1 + (em.speedJitter || 0));
        spawn(x, y, sa, sp, em.type, em.colors[Math.floor(Math.random() * em.colors.length)]);
      }
    }
    st.n++;
  }

  function stepEmitter(em, st, dtSec, x, y, px, py) {
    if (em.activeSec) {
      // 撃つ時間と休む時間を繰り返す（渦巻きなど）
      st.cycle += dtSec;
      var period = em.activeSec + em.restSec;
      if (st.cycle >= period) {
        st.cycle -= period;
      }
      if (st.cycle >= em.activeSec) {
        st.t = 0.05; // 休み中。撃ち始めるときにすぐ出せるようにしておく
        return;
      }
    }
    st.t -= dtSec;
    var guard = 0;
    while (st.t <= 0 && guard < 4) {
      st.t += em.intervalSec;
      guard++;
      fireOnce(em, st, x, y, px, py);
    }
  }

  // ===== ザコ =====

  function pickKind() {
    return kindNames[Math.floor(Math.random() * kindNames.length)];
  }

  function kindInfo(kind) {
    return D.kinds[kind] || D.kinds[kindNames[0]];
  }

  // ザコ1体ぶんの撃ち方の状態を作る（敵を出すとき1回だけ）
  function newShooter(kind) {
    var def = kindInfo(kind);
    return def.emitters.map(newEmitterState);
  }

  // ザコが画面内にいる間だけ、自分の種類の撃ち方で飾りの弾を出す。
  // rateScale: 撃つ頻度の倍率（中ボス戦のあいだは下げて、中ボスの花の弾幕を見やすくする。省略すると1）
  function updateShooter(enemy, dtSec, px, py, rateScale) {
    if (!enemy.shooter) {
      return;
    }
    if (rateScale != null) {
      dtSec *= rateScale;
    }
    if (isPortrait()) {
      dtSec *= D.portraitFireScale; // 縦の画面は撃つ頻度を下げる（Step21）
    }
    if (enemy.y < D.enemyFireMinY || enemy.y > H - D.enemyFireMaxYFromBottom || enemy.x < 0 || enemy.x > W) {
      return;
    }
    var def = kindInfo(enemy.kind);
    for (var i = 0; i < def.emitters.length; i++) {
      stepEmitter(def.emitters[i], enemy.shooter[i], dtSec, enemy.x, enemy.y, px, py);
    }
  }

  // ===== 中ボスの花の弾幕 =====

  function enterBossPhase(index) {
    var phases = D.boss.phases;
    bossState.phase = index % phases.length;
    bossState.t = 0;
    bossState.states = phases[bossState.phase].emitters.map(newEmitterState);
    // フェードインの直後にいきなり全方位が出ないよう、最初の弾は少し間を置く
    for (var i = 0; i < bossState.states.length; i++) {
      bossState.states[i].t = 0.15 + i * 0.1;
    }
  }

  function resetBoss() {
    bossState = { phase: 0, t: 0, states: [] };
    enterBossPhase(0);
  }

  function updateBoss(x, y, dtSec, px, py) {
    if (!bossState) {
      resetBoss();
    }
    var phases = D.boss.phases;
    bossState.t += dtSec;
    if (bossState.t >= phases[bossState.phase].sec) {
      enterBossPhase(bossState.phase + 1);
    }
    var ems = phases[bossState.phase].emitters;
    var fireDt = isPortrait() ? dtSec * D.portraitFireScale : dtSec; // 縦の画面は撃つ頻度を下げる（Step21。フェーズの切り替え時間は変えない）
    for (var i = 0; i < ems.length; i++) {
      stepEmitter(ems[i], bossState.states[i], fireDt, x, y + D.boss.originOffsetY, px, py);
    }
  }

  // ===== 更新と描画 =====

  function update(dtSec, px, py) {
    clock += dtSec;
    var pr = D.hit.playerRadius;
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      // 自機にぶつかったか（円と円の当たり判定）。ぶつかった弾は消える。ライフなどは変えず、反応は hitHandler へ任せる
      var dx = b.x - px;
      var dy = b.y - py;
      var rr = pr + b.hr;
      if (dx * dx + dy * dy < rr * rr) {
        if (hitHandler) {
          hitHandler(b, b.tier);
        }
        bullets[i] = bullets[bullets.length - 1];
        bullets.pop();
        continue;
      }
      if (b.y > H + 30 || b.y < -40 || b.x < -30 || b.x > W + 30) {
        bullets[i] = bullets[bullets.length - 1]; // 順番は関係ないので、末尾と入れ替えて消す
        bullets.pop();
      }
    }
  }

  // 自機がよける向きを求める（Step12。DESIGN.md §5.1 v0.7.1「自機は大玉を中心にある程度よける」）。
  // 近くの弾（と、少し先に進んだ位置）から離れる向きを、弾の大きさ別の重みで足し合わせて out.x/out.y に入れる。
  // 大玉は強く、小さい弾は弱くしか避けないので、小さい弾には「ときどき」当たる。見た目だけの動きで、被弾には関係しない
  function avoidVector(px, py, out, extra) {
    var A = D.dodge;
    var R = A.radius;
    var R2 = R * R;
    var look = A.lookaheadSec;
    var ax = 0;
    var ay = 0;
    var n = bullets.length;
    var total = n + (extra ? extra.length : 0);
    for (var i = 0; i < total; i++) {
      // 飾りの弾（bullets）のあとに、混み具合に数える従来の弾（extra。sp=弾の種類を持つ。当たって見えなくなった弾spentは除く）も見る
      var b = i < n ? bullets[i] : extra[i - n];
      if (b.spent) {
        continue;
      }
      var w = A.weight[i < n ? b.tier : D.hit.tier[b.sp || "rice"]];
      if (!w) {
        continue;
      }
      var vx = b.vx || 0;
      // 今の位置と少し先の位置のうち、自機に近い方から離れる
      var dx = b.x - px;
      var dy = b.y - py;
      var fx = dx + vx * look;
      var fy = dy + b.vy * look;
      var d2 = dx * dx + dy * dy;
      var f2 = fx * fx + fy * fy;
      if (f2 < d2) {
        dx = fx;
        dy = fy;
        d2 = f2;
      }
      if (d2 >= R2 || d2 < 0.0001) {
        continue;
      }
      var d = Math.sqrt(d2);
      var k = (w * (1 - d / R)) / d;
      ax -= dx * k;
      ay -= dy * k;
    }
    out.x = ax;
    out.y = ay;
  }

  // 混み具合に数える従来の弾（cb。x/y/spを持つ）が自機にぶつかっているか（Step12追加修正）。
  // ぶつかっていれば反応の大きさ（small/medium/large）を、そうでなければ null を返す。
  // 弾を消すかどうかはbattle.js側が決める（混み具合に数え続けるため、配列からは消さず spent にして見えなくする）
  function hitCounted(cb, px, py) {
    var sp = cb.sp || "rice";
    var rr = D.hit.playerRadius + (D.hit.bulletRadius[sp] || 6);
    var dx = cb.x - px;
    var dy = cb.y - py;
    if (dx * dx + dy * dy < rr * rr) {
      return D.hit.tier[sp] || "small";
    }
    return null;
  }

  // 弾の色の名前 → 火花に使う "r,g,b"
  function colorRgb(colorName) {
    return PALETTE[colorName] ? PALETTE[colorName].rgb : "255,255,255";
  }

  function drawOne(ctx, b, rot) {
    var spr = b.spr;
    if (rot === 0) {
      ctx.drawImage(spr.c, b.x - spr.cx, b.y - spr.cy);
    } else {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(rot);
      ctx.drawImage(spr.c, -spr.cx, -spr.cy);
      ctx.restore();
    }
  }

  // 飾りの弾と、混み具合に数える従来の弾（counted。sp・col・vx/vyを持つ）を、まとめて加算合成で描く
  function draw(ctx, counted) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var i;
    var b;
    for (i = 0; i < bullets.length; i++) {
      b = bullets[i];
      drawOne(ctx, b, b.spin ? clock * D.starSpinSpeed + b.phase : b.rot);
    }
    if (counted) {
      for (i = 0; i < counted.length; i++) {
        var cb = counted[i];
        if (cb.spent) {
          continue; // 自機に当たって消えた弾（混み具合には数え続けるが、もう描かない）
        }
        var spr = getSprite(cb.sp || "rice", cb.col || "yellow");
        var rot = 0;
        if (spr.directional) {
          rot = Math.atan2(cb.vy, cb.vx || 0) - Math.PI / 2;
        } else if (spr.spin) {
          rot = clock * D.starSpinSpeed;
        }
        drawOne(ctx, { x: cb.x, y: cb.y, spr: spr }, rot);
      }
    }
    ctx.restore();
  }

  function clear() {
    bullets.length = 0;
  }

  // Canvasの大きさが変わったとき（向きの切り替え）。飾りの弾の位置を割合で移し替える（Phase 3 Step17）
  function onResize(newW, newH, rx, ry) {
    W = newW;
    H = newH;
    for (var i = 0; i < bullets.length; i++) {
      bullets[i].x *= rx;
      bullets[i].y *= ry;
    }
  }

  function init(canvasW, canvasH) {
    D = EG.balance.danmaku;
    W = canvasW;
    H = canvasH;
    kindNames = Object.keys(D.kinds);
    buildSprites();
    bullets = [];
    clock = 0;
    resetBoss();
  }

  return {
    init: init,
    onResize: onResize,
    update: update,
    draw: draw,
    clear: clear,
    pickKind: pickKind,
    kindInfo: kindInfo,
    newShooter: newShooter,
    updateShooter: updateShooter,
    resetBoss: resetBoss,
    updateBoss: updateBoss,
    avoidVector: avoidVector,
    hitCounted: hitCounted,
    colorRgb: colorRgb,
    setHitHandler: function (fn) {
      hitHandler = fn;
    },
    count: function () {
      return bullets.length;
    },
    // 見た目の確認・テスト（tools/test/hit_test.js）専用: その場に止まった弾を1発置く（自機の位置に置けば、すぐ当たる）
    debugSpawn: function (x, y, type, colorName) {
      spawn(x, y, 0, 0, type, colorName);
    },
    // 性能テスト（tools/test/perf_test.js）専用: 画面いっぱいに飾りの弾をn発ばらまく
    debugFill: function (n) {
      for (var i = 0; i < n; i++) {
        spawn(rand(0, W), rand(0, H * 0.4), rand(0.3, Math.PI - 0.3), rand(20, 60), TYPE_NAMES[i % TYPE_NAMES.length], COLOR_NAMES[i % COLOR_NAMES.length]);
      }
    },
  };
})();
