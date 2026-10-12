// battle.js — シューティング演出と「画面の混み具合」の本体（DESIGN.md §2.2・§5）。
// 敵（編隊）・弾（敵弾／自機弾）・自機・爆発パーティクルを持ち、canvas.jsの描画ループから
// update(dtSec) / draw(ctx) を呼んでもらう形（canvas.js側で星空を描いた後に重ねて描く）。
//
// 見た目の弾はたくさん飛んでいるが、実際にライフが減るのは「被弾タイマー」が鳴ったときだけ（§5.2）。
// 被弾タイマーの間隔は「画面の混み具合（敵の数＋弾の数）」から計算する（§2.2）。
// ボム（スペースキー）は、問題を解いている最中でもいつでも使える想定なので、
// document全体のkeydownを監視し、commands.js側の状態（cards/question/busy）を見ない。
//
// 間違えたら敵が2体増える: commands.jsが発行する "eg:answer" イベント（result==="incorrect"）を購読する。
// ライフ0になったら: このStepでは演出を止めて「GAME OVER」の文字をCanvasに出すだけでよい（Step6で正式な画面にする）。
//   → "eg:gameover" イベントを発行し、commands.js側でカード選択などの入力を止める。
//
// Step7: 自機が画面いっぱいを自由に動き回るようにした（DESIGN.md §5.1）。動きは見た目だけで、
// 当たる・当たらないは今までどおり被弾タイマー（下の「本当に当たる弾」まわり）だけで決まる。
// 敵の出方も編隊(line)だけでなく数種類（vshape/flank/wave/cross）を持つ。
// Step11: 弾幕（東方Project風の飾りの弾）はEG.danmaku（src/danmaku.js）が持つ。飾りの弾は混み具合に数えない
// （＝congestionCount()は今までどおり、下のenemyBulletsだけを数える。ライフの減る速さを変えないため）。
// 機体（自機・ザコ・中ボス）を約1.3倍に。
// Step12: 飾りの弾は自機にぶつかって消える。当たったら弾の大きさ（小・中・大）に合った反応（火花・白い点滅・
// はじかれ・画面の揺れ・ふちの赤い光・音）を出す（onDecoHit）。見た目と音だけで、ライフ・ショット・点数・混み具合は変えない。
// 自機は大玉を中心に弾をよける（updatePlayerMovement内のdodge）ので、当たるのは「ときどき」になる。
// 一時停止中はcanvas.js側がupdate()自体を呼ばないので、このファイルでは何もしなくてよい
// （被弾タイマー・演出タイマーもすべて止まる）。ボムのキー入力だけはdocument直下で見ているので、
// ここでEG.pause.isPaused()を確認して無効化する。

window.EG = window.EG || {};

EG.battle = (function () {
  var B = null; // EG.balance.battle のキャッシュ（init時に取得）
  var canvasW = 0;
  var canvasH = 0;
  // Canvasの大きさが基準（横の画面 1280x440）の何倍か（Phase 3 Step17）。縦の画面では横が縮み縦が伸びる。
  // 敵の出る位置・動く範囲・速さに掛けて、画面が変わっても「敵が降りてくる／横切るのにかかる時間」を同じに保つ
  // （＝画面の混み具合＝ライフの減る速さが変わらない）
  var sx = 1;
  var sy = 1;

  function updateScale() {
    var L = EG.balance.layout;
    sx = canvasW / L.refCanvasWidth;
    sy = canvasH / L.refCanvasHeight;
  }

  // 自機（Step7: 画面いっぱいを自由に動き回る。目標地点(targetX/Y)へなめらかに操舵する）
  var player = { x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0, tilt: 0 };
  var playerRetargetTimer = 0; // 次に動く先を選び直すまでの残り秒数
  var playerDashTimer = 0;     // すばやい切り返し（ダッシュ）が続いている残り秒数
  var playerDashCooldown = 0;  // 次にダッシュできるようになるまでの残り秒数
  var playerRollTimer = 0;     // 宙返り（ロール）が続いている残り秒数（Step10）
  var playerRollCooldown = 0;  // 次にロールできるようになるまでの残り秒数
  var playerTrail = [];        // 残像用に記録した直近の位置・傾き { x, y, tilt }（Step10）
  var playerTrailTimer = 0;    // 次に残像の位置を記録するまでの残り秒数

  var enemies = [];       // { pattern, baseX, x, y, phase, speed, amplitude, wobbleSpeed, easeX, bulletTimer, ... }
  var enemyBullets = [];  // 見た目だけの敵弾 { x, y, vx, vy, boss? }（boss:trueは中ボスが撃った弾）
  var playerBullets = []; // 自機の弾（狙った敵にホーミングする） { x, y, target }
  var particles = [];     // 爆発の破片 { x, y, vx, vy, life, maxLife }
  var shockwaves = [];    // 爆発の衝撃の輪 { x, y, radius, maxRadius, life, maxLife }（Step10）
  var sparks = [];        // 被弾したときに自機から散る火花 { x, y, vx, vy, life, maxLife }（Step10）
  var damageTexts = [];   // 被弾したときの「-1」表示 { x, y, life, maxLife, text }（Step10）
  var incomingRealBullet = null; // 被弾タイマーが鳴ったときだけ飛んでくる「本当に当たる弾」 { x, y }

  // 中ボス（Step5で追加。DESIGN.md §3.1・§7.4）。ザコと違って enemies 配列には入れない
  var miniboss = { active: false, x: 0, y: 0, hp: 0, hpMax: 0, vx: 0, hitFlashTimer: 0 };
  var minibossBulletTimer = 0;
  var minibossDefeated = false; // 中ボスを倒してゲームを止めた状態か

  var elapsed = 0;     // このバトルが始まってからの経過時間（秒、dtSec積算。タブが裏に回ると止まる）
  var spawnTimer = 0;  // 次の編隅が出るまでの残り秒数
  var fireTimer = 0;   // 自機が次に撃つまでの残り秒数
  var ammoTimer = 0;   // ショットが次に1発分減るまでの残り秒数
  var hitTimer = 0;    // 被弾タイマー：次に本当に被弾するまでの残り秒数

  var hitFlashTimer = 0;    // 被弾時の自機の点滅演出の残り時間
  var shakeTimer = 0;       // 画面が揺れる演出の残り時間
  var bombFlashTimer = 0;   // ボムのフラッシュ演出の残り時間
  var bombInvulnTimer = 0;  // ボム後、被弾しない残り時間
  var muzzleFlashTimer = 0; // 自機が撃った瞬間の砲口の光の残り時間
  var hitEdgeFlashTimer = 0;// 被弾時、画面のふちが赤く光る演出の残り時間（Step10）

  // 弾幕（飾りの弾）に当たったときの反応の状態（Step12）。本当の被弾の演出（上の hitFlashTimer など）とは別に持つ
  var playerWhiteTimer = 0;   // 自機が白く光る残り時間
  var playerWhiteMax = 0;     // 同、光り始めの長さ（だんだん薄くするための基準）
  var playerKick = { x: 0, y: 0 }; // 当たった向きにはじかれたぶんのずれ（px。見た目だけ。だんだん0に戻る）
  var decoShakeTimer = 0;     // 弾幕に当たった画面の揺れの残り時間
  var decoShakeDur = 0;       // 同、揺れ始めの長さ
  var decoShakeAmp = 0;       // 同、揺れ始めの振れ幅（px）
  var decoEdgeTimer = 0;      // 弾幕（大玉）に当たったときの、画面のふちの赤い光の残り時間
  var decoEdgeDur = 0;        // 同、光り始めの長さ
  var decoEdgeAlpha = 0;      // 同、いちばん濃いときの不透明度
  var decoLastAt = { small: -99, medium: -99, large: -99 }; // 大きさごとに、最後に反応を出した時刻（elapsed。間引きに使う）
  var decoStats = newDecoStats(); // 数える用（hit=当たった回数、react=反応を出した回数。調整・テスト用）
  var avoidOut = { x: 0, y: 0 }; // よける向きの計算結果の置き場（毎フレーム作り直さないため）

  var gameOver = false;

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  // ===== 画面の混み具合とダメージ（DESIGN.md §2.2・§5.2） =====

  // Step5で敵・弾の見た目の数を大きく増やしたため、弾は敵より軽く数える重み付けにした
  // （でないと弾の数だけで危険度が跳ね上がってしまう。balance.js battle.congestionEnemyWeight/congestionBulletWeight）
  function congestionCount() {
    // 中ボスの弾（boss:true）はザコの弾より重く数える（Step6。IMPLEMENTATION_NOTES.md Step6参照）
    var bulletWeightTotal = 0;
    for (var i = 0; i < enemyBullets.length; i++) {
      bulletWeightTotal += enemyBullets[i].boss ? B.congestionBossBulletWeight : B.congestionBulletWeight;
    }
    return enemies.length * B.congestionEnemyWeight + bulletWeightTotal;
  }

  // 混み具合から「次に被弾するまでの間隔」を計算する。
  // 混み具合がnormalCongestionのときlife.hitIntervalSec（Step8で3秒）ちょうどになり、
  // 混むほど短く・空くほど長く、上限下限でclampする。
  // Step8: ショットが0（弾切れ）の間は、この間隔にshotEmptyHitIntervalMultiplier（0.5）を掛けて半分にする
  // （DESIGN.md §2.2・§5.2「弾切れの間は被弾の間隔が半分になる」）
  function hitIntervalForCongestion() {
    var c = Math.max(1, congestionCount());
    var interval = EG.balance.life.hitIntervalSec * (B.normalCongestion / c);
    if (EG.state.data.shot <= 0) {
      interval *= B.shotEmptyHitIntervalMultiplier;
    }
    return EG.util.clamp(interval, B.hitIntervalMinSec, B.hitIntervalMaxSec);
  }

  // 火花を1つ足す（Step12で、大きさ・色を選べるようにまとめた）。rgb は "r,g,b" の文字列
  function pushSpark(x, y, ang, spd, life, size, rgb) {
    if (sparks.length >= B.maxSparks) {
      sparks.shift();
    }
    sparks.push({
      x: x,
      y: y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: life,
      maxLife: life,
      size: size,
      rgb: rgb,
    });
  }

  // 被弾したときに自機から散る火花（Step10。DESIGN.md §5.1 v0.6「自機から火花」）
  function spawnSparks(x, y) {
    for (var i = 0; i < B.hitSparkCount; i++) {
      pushSpark(x, y, Math.random() * Math.PI * 2, randRange(B.hitSparkSpeedMin, B.hitSparkSpeedMax), B.hitSparkLifeSec, 3, "255,255,200");
    }
  }

  function newDecoStats() {
    return { small: { hit: 0, react: 0 }, medium: { hit: 0, react: 0 }, large: { hit: 0, react: 0 } };
  }

  // ===== 弾幕（飾りの弾）に当たったときの反応（Step12。DESIGN.md §5.1 v0.7.1） =====
  // danmaku.js が「当たった」と知らせてくる。弾の大きさ（tier）で反応の強さが変わる。
  // ライフ・ショット・点数・混み具合・被弾タイマーには一切触らない（見た目と音だけ）。
  function onDecoHit(b, tier) {
    var H = EG.balance.danmaku.hit;
    var r = H.react[tier];
    var stat = decoStats[tier];
    if (!r || !stat) {
      return;
    }
    stat.hit++;
    // 当たった弾は消える。消えるところに、弾の色の小さな火花（毎回出す。数は少ないので間引かない）
    for (var v = 0; v < H.vanishSparkCount; v++) {
      pushSpark(b.x, b.y, Math.random() * Math.PI * 2, randRange(H.vanishSparkSpeed * 0.4, H.vanishSparkSpeed), H.vanishSparkLifeSec, 1.5, b.rgb);
    }
    // 同じ大きさの反応が続きすぎないよう間引く（うるさくならないように）
    if (elapsed - decoLastAt[tier] < r.minIntervalSec) {
      return;
    }
    decoLastAt[tier] = elapsed;
    stat.react++;

    // 火花・破片（弾の色と白を半分ずつ）。大は大きな破片になる
    for (var i = 0; i < r.sparkCount; i++) {
      pushSpark(b.x, b.y, Math.random() * Math.PI * 2, randRange(r.sparkSpeedMin, r.sparkSpeedMax), r.sparkLifeSec,
        randRange(r.sparkSizeMin, r.sparkSizeMax), i % 2 === 0 ? b.rgb : "255,255,255");
    }
    if (r.ringRadius > 0) {
      spawnShockwave(b.x, b.y, r.ringRadius, 0.25);
    }
    // 自機が一瞬白く光る
    playerWhiteMax = Math.min(H.whiteFlashMaxSec, Math.max(r.whiteFlashSec, playerWhiteTimer));
    playerWhiteTimer = playerWhiteMax;
    // 当たった向き（弾から自機へ向かう向き）に、自機が数pxはじかれる
    var dx = player.x - b.x;
    var dy = player.y - b.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.0001) {
      dx = 0;
      dy = 1;
      d = 1;
    }
    playerKick.x += (dx / d) * r.kickPx;
    playerKick.y += (dy / d) * r.kickPx;
    // 画面の揺れ（中・大）。重なっても shakeMaxAmp まで
    if (r.shakeAmp > 0) {
      var cur = decoShakeTimer > 0 ? decoShakeAmp * (decoShakeTimer / decoShakeDur) : 0;
      decoShakeAmp = Math.min(H.shakeMaxAmp, cur + r.shakeAmp);
      decoShakeDur = r.shakeSec;
      decoShakeTimer = r.shakeSec;
    }
    // 画面のふちが赤く光る（大）
    if (r.edgeFlashAlpha > 0) {
      decoEdgeAlpha = r.edgeFlashAlpha;
      decoEdgeDur = r.edgeFlashSec;
      decoEdgeTimer = r.edgeFlashSec;
    }
    if (EG.sounds) {
      EG.sounds.play("deco_hit_" + tier); // 大きさに合った軽い音（Step12。読み上げ中は小さくなる）
    }
  }

  function applyDamage() {
    var s = EG.state.data;
    var dmg = EG.balance.life.hitDamage;
    s.life = Math.max(0, s.life - dmg);
    EG.hud.render();
    hitFlashTimer = B.hitFlashSec;
    shakeTimer = B.shakeSec;
    // もっと派手に（Step10。DESIGN.md §5.1 v0.6「画面を強く揺らす、画面のふちを赤く光らせる、
    // 自機から火花、『-1』の表示などで派手に」）
    hitEdgeFlashTimer = B.hitEdgeFlashSec;
    spawnSparks(player.x, player.y);
    damageTexts.push({
      x: player.x,
      y: player.y - 18,
      life: B.hitDamageTextLifeSec,
      maxLife: B.hitDamageTextLifeSec,
      text: "-" + dmg,
    });
    if (EG.sounds) {
      EG.sounds.play("hit"); // 被弾（Step9。Step10で合成した低い衝撃音「ドンッ」も重ねて鳴る＝src/sounds.js側）
    }
  }

  function pickHitBulletSource() {
    if (enemies.length > 0) {
      var e = enemies[Math.floor(Math.random() * enemies.length)];
      return { x: e.x, y: e.y };
    }
    if (miniboss.active) {
      // 中ボス戦でザコが1体もいないときは、中ボスから飛んできたことにする
      return { x: miniboss.x, y: miniboss.y };
    }
    // 敵が1体もいない瞬間に被弾タイマーが鳴った場合の保険（画面上からまっすぐ落ちてくる扱い）
    return { x: player.x + randRange(-100, 100), y: 10 };
  }

  function triggerRealHit() {
    var src = pickHitBulletSource();
    incomingRealBullet = { x: src.x, y: src.y };
  }

  function updateRealBullet(dtSec) {
    if (!incomingRealBullet) {
      return;
    }
    var b = incomingRealBullet;
    // 自機の「今の」位置へ向けてホーミングする。自機が動き回っても、当たる・当たらないは
    // 今までどおり被弾タイマーだけで決まる（自機の動きは見た目だけ。DESIGN.md §5.1）
    var dx = player.x - b.x;
    var dy = player.y - b.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= B.hitBulletHitRadius) {
      incomingRealBullet = null;
      applyDamage();
      // 次の被弾までの間隔を、その時点の混み具合で計算し直す
      hitTimer = hitIntervalForCongestion();
      return;
    }
    if (dist < 0.0001) {
      dist = 0.0001;
    }
    var moveDist = Math.min(dist, B.hitBulletSpeed * dtSec);
    b.x += (dx / dist) * moveDist;
    b.y += (dy / dist) * moveDist;
  }

  // ===== 自機の自由な動き（Step7。DESIGN.md §5.1） =====

  // 次に動く先（targetX/Y）を選ぶ。「本当に当たる弾」が飛んできているときはそれを避ける向きへ、
  // それ以外はときどき敵に寄っていきつつ、基本はランダムな場所へ（見た目だけの動き）
  function pickPlayerTarget() {
    var minX = B.playerMoveMarginX;
    var maxX = canvasW - B.playerMoveMarginX;
    var minY = B.playerMoveMinY * sy;
    var maxY = B.playerMoveMaxY * sy;

    if (incomingRealBullet) {
      var away = player.x < incomingRealBullet.x ? -1 : 1;
      player.targetX = EG.util.clamp(player.x + away * randRange(80, 160), minX, maxX);
      player.targetY = EG.util.clamp(player.y + randRange(-60, 60), minY, maxY);
      return;
    }
    if (enemies.length > 0 && Math.random() < B.playerApproachEnemyChance) {
      var target = enemies[Math.floor(Math.random() * enemies.length)];
      player.targetX = EG.util.clamp(target.x + randRange(-50, 50), minX, maxX);
      player.targetY = EG.util.clamp(target.y + randRange(120, 220) * sy, minY, maxY);
      return;
    }
    player.targetX = randRange(minX, maxX);
    player.targetY = randRange(minY, maxY);
  }

  function updatePlayerMovement(dtSec) {
    playerRetargetTimer -= dtSec;
    if (playerRetargetTimer <= 0) {
      pickPlayerTarget();
      playerRetargetTimer = randRange(B.playerRetargetMinSec, B.playerRetargetMaxSec);
    }

    var speedCap = B.playerMoveSpeed;
    if (playerDashTimer > 0) {
      playerDashTimer -= dtSec;
      speedCap = B.playerMoveSpeed * B.playerDashMultiplier;
    } else {
      playerDashCooldown -= dtSec;
      if (playerDashCooldown <= 0 && Math.random() < B.playerDashChancePerSec * dtSec) {
        // ときどき素早く切り返す（ダッシュ）。新しい行き先を選び直して勢いよく向かう
        playerDashTimer = B.playerDashDurationSec;
        playerDashCooldown = B.playerDashCooldownSec;
        pickPlayerTarget();
      }
    }

    var dx = player.targetX - player.x;
    var dy = player.targetY - player.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var desiredVx = 0;
    var desiredVy = 0;
    if (dist > 1) {
      desiredVx = (dx / dist) * speedCap;
      desiredVy = (dy / dist) * speedCap;
    }
    // 近くの弾（大玉を中心に）から離れる向きの速度を足す（Step12。見た目だけの動き。小さい弾は弱くしかよけない）
    var dodge = EG.balance.danmaku.dodge;
    EG.danmaku.avoidVector(player.x, player.y, avoidOut, enemyBullets);
    var avoidMag = Math.sqrt(avoidOut.x * avoidOut.x + avoidOut.y * avoidOut.y);
    if (avoidMag > 1) {
      avoidOut.x /= avoidMag; // 弾が多くてもよける強さは上限までにする
      avoidOut.y /= avoidMag;
    }
    desiredVx += avoidOut.x * dodge.strength;
    desiredVy += avoidOut.y * dodge.strength;
    // なめらかに目標の速度へ近づける（steering）。急に向きが変わらないようにする
    player.vx += (desiredVx - player.vx) * B.playerSteerRate * dtSec;
    player.vy += (desiredVy - player.vy) * B.playerSteerRate * dtSec;

    player.x = EG.util.clamp(player.x + player.vx * dtSec, B.playerMoveMarginX, canvasW - B.playerMoveMarginX);
    player.y = EG.util.clamp(player.y + player.vy * dtSec, B.playerMoveMinY * sy, B.playerMoveMaxY * sy);

    // ときどき宙返り（ロール）する（Step10。DESIGN.md §5.1 v0.6「ときどき宙返り（ロール）」）。
    // ロール中は自機がくるっと1回転し続け、終わったら通常の傾き（バンク）に戻す
    if (playerRollTimer > 0) {
      playerRollTimer -= dtSec;
      player.tilt += B.playerRollSpeedPerSec * dtSec;
    } else {
      playerRollCooldown -= dtSec;
      if (playerRollCooldown <= 0 && Math.random() < B.playerRollChancePerSec * dtSec) {
        playerRollTimer = B.playerRollDurationSec;
        playerRollCooldown = B.playerRollCooldownSec;
      }
      // 見た目の傾き（横に速く動くほど傾く。急な切り返しがバンクして見える）
      var targetTilt = EG.util.clamp(player.vx / B.playerMoveSpeed, -1, 1) * B.playerTiltMax;
      player.tilt += (targetTilt - player.tilt) * Math.min(1, dtSec * 8);
    }

    // 残像用に、直近の位置・傾きを一定間隔で記録しておく（Step10。DESIGN.md §5.1 v0.6「残像」）
    playerTrailTimer -= dtSec;
    if (playerTrailTimer <= 0) {
      playerTrail.push({ x: player.x, y: player.y, tilt: player.tilt });
      if (playerTrail.length > B.playerTrailLength) {
        playerTrail.shift();
      }
      playerTrailTimer = B.playerTrailIntervalSec;
    }
  }

  // ===== 敵の出現・移動・撃破 =====

  function pickFormationPattern() {
    var types = B.enemyFormationTypes;
    return types[Math.floor(Math.random() * types.length)];
  }

  // 左右から横切る編隊（cross）。descend系（line/vshape/wave/flank）とは動き方が別なので、
  // updateEnemies側でもpattern==="cross"のときだけ別ルートで動かす
  function spawnCrossFormation(count, kind) {
    var side = Math.random() < 0.5 ? -1 : 1;
    var y0 = randRange(B.crossYMin * sy, B.crossYMax * sy);
    var spacing = B.formationSpacingPx * 0.6;
    for (var i = 0; i < count; i++) {
      var yy = EG.util.clamp(y0 + (i - (count - 1) / 2) * spacing, B.crossYMin * sy - 20, B.crossYMax * sy + 40);
      // x方向はi(番目)でずらさない（stagger分だけ「画面の外の、もう画面外扱いで消える位置」から
      // 生まれてしまい、生成直後に消える不具合になるため。横一列で入場し、yのずれで編隊に見せる）
      enemies.push({
        pattern: "cross",
        baseY: yy,
        x: side < 0 ? -30 : canvasW + 30,
        y: yy,
        phase: elapsed + i * 0.15,
        vx: (side < 0 ? B.crossSpeedX : -B.crossSpeedX) * sx,
        bulletTimer: randRange(B.enemyBulletIntervalMin, B.enemyBulletIntervalMax),
        kind: kind,
        shooter: EG.danmaku.newShooter(kind), // 種類ごとの弾幕の撃ち方（Step11）
      });
    }
  }

  function spawnFormation(n) {
    var room = B.maxEnemies - enemies.length;
    if (room <= 0 || n <= 0) {
      return;
    }
    var count = Math.min(n, room);
    var pattern = pickFormationPattern();
    var kind = EG.danmaku.pickKind(); // 編隊はみな同じ種類（撃ち方・色が同じ。Step11）

    if (pattern === "cross") {
      spawnCrossFormation(count, kind);
      return;
    }

    var isFlank = pattern === "flank";
    var centerX = isFlank
      ? randRange(canvasW * 0.32, canvasW * 0.68) // 横から寄ってくる先（画面中央寄り）
      : randRange(B.formationSpawnMarginPx * sx, canvasW - B.formationSpawnMarginPx * sx);
    var entrySide = isFlank ? (Math.random() < 0.5 ? -1 : 1) : 0;
    var spacing = B.formationSpacingPx;
    var phase = elapsed; // 編隊内で位相を共有し、まとまって揺れて見えるようにする

    for (var i = 0; i < count; i++) {
      var offset = (i - (count - 1) / 2) * spacing;
      var bx = EG.util.clamp(centerX + offset, 40, canvasW - 40);
      var spawnY = -30 - Math.random() * 20;
      if (pattern === "vshape") {
        // V字編隊: 中心が前（下）に、両脇が後ろ（上）になるよう初期位置をずらす
        spawnY -= Math.abs(i - (count - 1) / 2) * B.vshapeStepY;
      }
      var startX = bx;
      if (isFlank) {
        // 横から回り込む: 画面の外側からスタートし、baseXへ向けて寄っていく（easeXで滑らかに近づける）
        startX = entrySide < 0 ? -40 - i * 20 : canvasW + 40 + i * 20;
      }
      enemies.push({
        pattern: pattern,
        baseX: bx,
        x: startX,
        y: spawnY,
        phase: phase,
        speed: B.enemySpeed * sy * randRange(0.9, 1.1),
        amplitude: pattern === "wave" ? B.waveAmplitude * sx : B.enemyWobbleAmplitude,
        wobbleSpeed: pattern === "wave" ? B.waveSpeed : B.enemyWobbleSpeed,
        easeX: isFlank,
        bulletTimer: randRange(B.enemyBulletIntervalMin, B.enemyBulletIntervalMax), // 敵1体ずつが自分のタイマーで弾を撃つ（Step5）
        kind: kind,
        shooter: EG.danmaku.newShooter(kind), // 種類ごとの弾幕の撃ち方（Step11）
      });
    }
  }

  // ザコの弾幕を撃つ頻度の倍率。中ボス戦のあいだは下げて、中ボスの花の弾幕が見えなくならないようにする（Step11）
  function zakoFireScale() {
    return miniboss.active ? EG.balance.danmaku.zakoFireScaleDuringBoss : 1;
  }

  function updateEnemies(dtSec) {
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];

      if (e.pattern === "cross") {
        // 左右から横切る: 横方向へ一定速度で移動しつつ、上下にゆるく揺れる
        e.x += e.vx * dtSec;
        e.y = e.baseY + Math.sin((elapsed - e.phase) * B.enemyWobbleSpeed) * (B.enemyWobbleAmplitude * 0.5);
        e.bulletTimer -= dtSec;
        if (e.bulletTimer <= 0) {
          fireEnemyBulletFrom(e);
          e.bulletTimer = randRange(B.enemyBulletIntervalMin, B.enemyBulletIntervalMax);
        }
        EG.danmaku.updateShooter(e, dtSec, player.x, player.y, zakoFireScale()); // 飾りの弾幕（Step11。混み具合には数えない）
        if (e.x < -60 || e.x > canvasW + 60) {
          enemies.splice(i, 1); // 画面の反対側まで抜けて消える
        }
        continue;
      }

      e.y += e.speed * dtSec;
      var targetX = e.baseX + Math.sin((elapsed - e.phase) * e.wobbleSpeed) * e.amplitude;
      if (e.easeX) {
        // flank: 目標のx（targetX）へ一定速度で近づく（遠いうちは横から寄ってくる動きに見える）
        var dx = targetX - e.x;
        var maxStep = B.flankSpeedX * sx * dtSec;
        e.x = Math.abs(dx) <= maxStep ? targetX : e.x + (dx > 0 ? maxStep : -maxStep);
      } else {
        e.x = targetX;
      }

      e.bulletTimer -= dtSec;
      if (e.bulletTimer <= 0) {
        fireEnemyBulletFrom(e);
        e.bulletTimer = randRange(B.enemyBulletIntervalMin, B.enemyBulletIntervalMax);
      }
      EG.danmaku.updateShooter(e, dtSec, player.x, player.y, zakoFireScale()); // 飾りの弾幕（Step11。混み具合には数えない）

      if (e.y > canvasH - B.enemyDespawnMargin) {
        // 倒されないまま画面外へ抜けた（ペナルティなし。見逃した扱い）
        enemies.splice(i, 1);
      }
    }
  }

  function spawnExplosion(x, y) {
    for (var i = 0; i < B.explosionParticleCount; i++) {
      if (particles.length >= B.maxParticles) {
        particles.shift(); // 古いものから間引く
      }
      var ang = Math.random() * Math.PI * 2;
      var spd = randRange(B.explosionSpeedMin, B.explosionSpeedMax);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: B.explosionLifeSec,
        maxLife: B.explosionLifeSec,
      });
    }
  }

  // 爆発の「衝撃の輪」（Step10。DESIGN.md §5.1 v0.6「敵の爆発：破片と衝撃の輪で大きく」）
  function spawnShockwave(x, y, maxRadius, life) {
    if (shockwaves.length >= B.maxShockwaves) {
      shockwaves.shift();
    }
    shockwaves.push({ x: x, y: y, radius: 0, maxRadius: maxRadius, life: life, maxLife: life });
  }

  function killEnemyAt(index) {
    var e = enemies[index];
    if (!e) {
      return;
    }
    spawnExplosion(e.x, e.y);
    spawnShockwave(e.x, e.y, B.explosionShockwaveMaxRadius, B.explosionShockwaveLifeSec);
    enemies.splice(index, 1);
    EG.state.data.score += EG.balance.score.enemyKillPoint; // 敵を倒した点（DESIGN.md §7.6）
    EG.hud.render();
    if (EG.sounds) {
      EG.sounds.play("explosion"); // 敵を倒す（Step9。何度も鳴るので間引かれる）
    }
  }

  // 中ボス撃破時の「大きな爆発」（DESIGN.md §7.4「体力0で撃破（大きな爆発）」）
  function spawnBigExplosion(x, y) {
    var mb = B.miniboss;
    var count = mb.defeatParticleCount;
    for (var i = 0; i < count; i++) {
      if (particles.length >= B.maxParticles) {
        particles.shift();
      }
      var ang = Math.random() * Math.PI * 2;
      var spd = randRange(mb.defeatParticleSpeedMin, mb.defeatParticleSpeedMax); // 通常の爆発より広く・速く飛び散らせる
      var life = B.explosionLifeSec * mb.defeatParticleLifeMultiplier; // 通常より長く残す
      var jitter = mb.defeatParticleJitterPx;
      particles.push({
        x: x + randRange(-jitter, jitter),
        y: y + randRange(-jitter, jitter),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: life,
        maxLife: life,
      });
    }
    // 撃破時は衝撃の輪もザコより大きく広げる（Step10）
    spawnShockwave(x, y, mb.defeatShockwaveMaxRadius, mb.defeatShockwaveLifeSec);
  }

  function updateParticles(dtSec) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dtSec;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
  }

  // 爆発の衝撃の輪（Step10）。半径0から少しずつ広がりながら消えていく
  function updateShockwaves(dtSec) {
    for (var i = shockwaves.length - 1; i >= 0; i--) {
      var s = shockwaves[i];
      s.life -= dtSec;
      if (s.life <= 0) {
        shockwaves.splice(i, 1);
        continue;
      }
      var t = 1 - s.life / s.maxLife;
      s.radius = s.maxRadius * t;
    }
  }

  // 被弾したときに自機から散る火花（Step10）
  function updateSparks(dtSec) {
    for (var i = sparks.length - 1; i >= 0; i--) {
      var sp = sparks[i];
      sp.life -= dtSec;
      if (sp.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      sp.x += sp.vx * dtSec;
      sp.y += sp.vy * dtSec;
      sp.vx *= 0.92;
      sp.vy *= 0.92;
    }
  }

  // 被弾したときの「-1」表示。上へ浮き上がりながら消えていく（Step10）
  function updateDamageTexts(dtSec) {
    for (var i = damageTexts.length - 1; i >= 0; i--) {
      var d = damageTexts[i];
      d.life -= dtSec;
      if (d.life <= 0) {
        damageTexts.splice(i, 1);
        continue;
      }
      d.y -= B.hitDamageTextRiseSpeed * dtSec;
    }
  }

  // ===== 自機（自動で狙って撃つ） =====

  function pickTargetEnemy() {
    var best = null;
    for (var i = 0; i < enemies.length; i++) {
      if (!best || enemies[i].y > best.y) {
        best = enemies[i];
      }
    }
    return best;
  }

  function firePlayerBullet() {
    if (playerBullets.length >= B.maxPlayerBullets) {
      return;
    }
    var target = pickTargetEnemy();
    if (!target) {
      return;
    }
    playerBullets.push({ x: player.x, y: player.y, target: target });
    muzzleFlashTimer = B.muzzleFlashSec; // 撃った瞬間、砲口を光らせる（DESIGN.md §5.1）
  }

  function updatePlayerBullets(dtSec) {
    for (var i = playerBullets.length - 1; i >= 0; i--) {
      var b = playerBullets[i];
      var idx = enemies.indexOf(b.target);
      if (idx === -1) {
        // 狙っていた敵が既にいない（他の弾に倒された／ボムで消えた等）→ この弾も消える
        playerBullets.splice(i, 1);
        continue;
      }
      var target = enemies[idx];
      var dx = target.x - b.x;
      var dy = target.y - b.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= B.playerBulletHitRadius) {
        killEnemyAt(idx);
        playerBullets.splice(i, 1);
        continue;
      }
      if (dist < 0.0001) {
        dist = 0.0001;
      }
      var moveDist = Math.min(dist, B.playerBulletSpeed * dtSec);
      b.x += (dx / dist) * moveDist;
      b.y += (dy / dist) * moveDist;
    }
  }

  // ===== 敵弾（見た目だけ。当たり判定はない） =====
  // Step5で「タイマー1本で毎回1発」から「敵1体ずつが自分のタイマーで撃つ」方式に変えた
  // （updateEnemies内でe.bulletTimerを見て呼ぶ。呼び出し元はfireEnemyBulletFrom）
  // Step7: ときどき1発ではなく扇状にまとめて撃つ（fireFan）バリエーションを追加した

  function fireFan(e) {
    var n = B.enemyBulletFanCount;
    var spreadRad = (B.enemyBulletFanSpreadDeg * Math.PI) / 180;
    for (var i = 0; i < n; i++) {
      if (enemyBullets.length >= B.maxEnemyBullets) {
        return;
      }
      var t = n <= 1 ? 0 : i / (n - 1) - 0.5; // -0.5〜0.5
      var angle = t * spreadRad;
      enemyBullets.push({
        x: e.x,
        y: e.y,
        vx: Math.sin(angle) * B.enemyBulletSpeed * sx,
        vy: Math.cos(angle) * B.enemyBulletSpeed * sy,
        sp: "rice",                                  // 見た目（Step11）。米粒弾、色は敵の種類の色
        col: EG.danmaku.kindInfo(e.kind).bulletColor,
      });
    }
  }

  function fireEnemyBulletFrom(e) {
    if (Math.random() < B.enemyBulletFanChance) {
      fireFan(e);
      return;
    }
    if (enemyBullets.length >= B.maxEnemyBullets) {
      return;
    }
    enemyBullets.push({ x: e.x, y: e.y, vx: 0, vy: B.enemyBulletSpeed * sy, sp: "rice", col: EG.danmaku.kindInfo(e.kind).bulletColor });
  }

  function updateEnemyBullets(dtSec) {
    for (var i = enemyBullets.length - 1; i >= 0; i--) {
      var b = enemyBullets[i];
      b.x += (b.vx || 0) * dtSec;
      b.y += b.vy * dtSec;
      // 自機にぶつかったら、飾りの弾と同じく大きさに合った反応を出す（Step12の追加修正。DESIGN.md §5.1 v0.7.1）。
      // ただしこの弾は混み具合に数えているので配列からは消さず、spent（見えない・もう当たらない）にして、
      // これまでどおり画面外へ出る時点（下の判定）まで数え続ける。だから被弾間隔は変わらない
      if (!b.spent) {
        var hitTier = EG.danmaku.hitCounted(b, player.x, player.y);
        if (hitTier) {
          b.spent = true;
          onDecoHit({ x: b.x, y: b.y, rgb: EG.danmaku.colorRgb(b.col) }, hitTier);
        }
      }
      if (b.y > player.y + B.enemyBulletPassMargin) {
        enemyBullets.splice(i, 1); // 自機のそばを通り過ぎて消える（見た目上のニアミス）
      }
    }
  }

  // ===== ボム（スペースキー。いつでも使える） =====

  function tryBomb() {
    var s = EG.state.data;
    if (s.bomb <= 0) {
      return;
    }
    s.bomb -= 1;

    if (enemies.length > 0) {
      // ボムでまとめて倒すと点が大きく入る（DESIGN.md §7.6）。1体あたりscore.bombKillMultiplier倍
      s.score += enemies.length * EG.balance.score.enemyKillPoint * EG.balance.score.bombKillMultiplier;
    }
    for (var i = 0; i < enemies.length; i++) {
      spawnExplosion(enemies[i].x, enemies[i].y); // 倒した扱いで爆発を見せる（DESIGN.md §5.1）
      spawnShockwave(enemies[i].x, enemies[i].y, B.explosionShockwaveMaxRadius, B.explosionShockwaveLifeSec); // Step10
    }
    enemies.length = 0;
    enemyBullets.length = 0; // 中ボスの弾もここに入っているので一緒に消える（中ボス本体は別管理なので無傷）
    EG.danmaku.clear();      // 飾りの弾（弾幕）も全部消える（Step11）
    playerBullets.length = 0; // 狙っていた敵がいなくなるので自機の弾も消す
    incomingRealBullet = null;

    bombFlashTimer = B.bombFlashSec;
    bombInvulnTimer = B.bombInvulnSec;
    hitTimer = hitIntervalForCongestion(); // 混み具合0からの間隔で仕切り直す
    EG.hud.render();
    if (EG.sounds) {
      EG.sounds.play("bomb"); // ボム（Step9）
    }
  }

  function onKeyDown(e) {
    if (EG.pause && EG.pause.isPaused()) {
      // 一時停止中はボムも受け付けない（Step7）
      return;
    }
    if (gameOver || minibossDefeated) {
      // ライフ0後、または中ボス撃破後（ゲームを止めてCLEARの文字を出している間）はボムを無効にする（Step6）
      return;
    }
    var isSpace = e.key === " " || e.code === "Space" || e.key === "Spacebar";
    if (!isSpace) {
      return;
    }
    e.preventDefault();
    if (e.repeat) {
      return; // 押しっぱなしで連続発動しないようにする
    }
    tryBomb();
  }

  // ===== 間違えたら敵が2体増える（Step3の "eg:answer" イベントを購読） =====

  function onAnswerEvent(detail) {
    if (gameOver || !detail) {
      return;
    }
    if (detail.result === "incorrect") {
      spawnFormation(B.wrongAnswerEnemyBonus);
    }
  }

  // ===== ゲームオーバー =====

  function triggerGameOver() {
    gameOver = true;
    enemies.length = 0;
    enemyBullets.length = 0;
    EG.danmaku.clear();
    playerBullets.length = 0;
    particles.length = 0;
    incomingRealBullet = null;
    console.log("GAME OVER: ライフが0になりました（バトル内時間 約" + elapsed.toFixed(1) + "秒）");
    EG.events.emit("eg:gameover", {});
  }

  // ===== 中ボス（Step5。DESIGN.md §3.1・§7.4） =====
  // 体力・登場のタイミングはEG.wave（wave.js）が決める。ここでは「動く・弾を撃つ・ダメージを受ける・
  // 0で撃破して大きな爆発を出す」という中ボス自身の振る舞いだけを持つ。

  function startMiniboss(hp) {
    var mb = B.miniboss;
    miniboss.active = true;
    miniboss.x = canvasW / 2;
    miniboss.y = mb.yPos * sy;
    miniboss.vx = mb.moveSpeed * sx;
    miniboss.hp = hp;
    miniboss.hpMax = hp;
    miniboss.hitFlashTimer = 0;
    minibossBulletTimer = mb.bulletIntervalSec;
    minibossDefeated = false;
    EG.danmaku.resetBoss(); // 花の弾幕を最初のフェーズから
  }

  // 正解するたびに1ダメージ（PASS・間違いはダメージなし。呼び出す側=wave.jsで判定済み）
  function damageMiniboss(amount) {
    if (!miniboss.active || minibossDefeated) {
      return;
    }
    miniboss.hp = Math.max(0, miniboss.hp - amount);
    miniboss.hitFlashTimer = B.miniboss.hitFlashSec; // 当たったことが分かる演出（光る）
    if (miniboss.hp <= 0) {
      defeatMiniboss();
    }
  }

  function defeatMiniboss() {
    minibossDefeated = true;
    miniboss.active = false;
    spawnBigExplosion(miniboss.x, miniboss.y); // 大きな爆発（DESIGN.md §7.4）
    if (EG.sounds) {
      EG.sounds.play("boss_down"); // 中ボス撃破（Step9。bomb音を低く・長く鳴らして代用）
    }
    // 残っていたザコ・弾も一緒に片づけて画面を止める（このStepは「ゲームを止めてCLEARの文字」だけでよい）
    enemies.length = 0;
    enemyBullets.length = 0;
    EG.danmaku.clear();
    playerBullets.length = 0;
    incomingRealBullet = null;
    console.log("中ボス撃破（バトル内時間 約" + elapsed.toFixed(1) + "秒）");
  }

  function updateMiniboss(dtSec) {
    if (!miniboss.active) {
      return;
    }
    var mb = B.miniboss;
    miniboss.x += miniboss.vx * dtSec;
    var minX = canvasW / 2 - mb.moveRangeX * sx;
    var maxX = canvasW / 2 + mb.moveRangeX * sx;
    if (miniboss.x < minX) {
      miniboss.x = minX;
      miniboss.vx = Math.abs(miniboss.vx);
    } else if (miniboss.x > maxX) {
      miniboss.x = maxX;
      miniboss.vx = -Math.abs(miniboss.vx);
    }
    if (miniboss.hitFlashTimer > 0) {
      miniboss.hitFlashTimer -= dtSec;
    }
    EG.danmaku.updateBoss(miniboss.x, miniboss.y, dtSec, player.x, player.y); // 花の弾幕（Step11。混み具合には数えない）
    minibossBulletTimer -= dtSec;
    if (minibossBulletTimer <= 0) {
      if (enemyBullets.length < B.maxEnemyBullets) {
        // 混み具合に数える中ボスの弾は、見た目は大玉（Step11）
        enemyBullets.push({ x: miniboss.x, y: miniboss.y + mb.height / 2, vx: 0, vy: mb.bulletSpeed * sy, boss: true, sp: "big", col: "purple" });
      }
      minibossBulletTimer += mb.bulletIntervalSec;
    }
  }

  function drawMiniboss(ctx) {
    if (!miniboss.active) {
      return;
    }
    var mb = B.miniboss;
    var flashOn = miniboss.hitFlashTimer > 0;
    ctx.save();
    ctx.shadowColor = flashOn ? "#ffffff" : "#c04cff";
    ctx.shadowBlur = flashOn ? 26 : 14;
    ctx.fillStyle = flashOn ? "#ffffff" : "#a13dff";
    ctx.beginPath();
    ctx.moveTo(miniboss.x, miniboss.y - mb.height / 2);
    ctx.lineTo(miniboss.x - mb.width / 2, miniboss.y);
    ctx.lineTo(miniboss.x, miniboss.y + mb.height / 2);
    ctx.lineTo(miniboss.x + mb.width / 2, miniboss.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ===== 全体の更新 =====

  function update(dtSec) {
    if (gameOver) {
      return;
    }
    elapsed += dtSec;

    // 自機は画面いっぱいを自由に動き回る（Step7。見た目だけで、当たり判定には関係しない）
    updatePlayerMovement(dtSec);

    // 中ボスを倒した後は、ここから下を止めて「ゲームを止める」（DESIGN.md §7.4。Step5はCLEARの文字を出すだけでよい）。
    // ただしupdateParticles等は下で引き続き呼ぶので、撃破時の「大きな爆発」は止めずに最後まで再生される
    if (!minibossDefeated) {
      // 敵の出現（中ボス戦の間はザコを控えめに出す。「ザコ敵は中ボス戦でも少し出てよい」）
      spawnTimer -= dtSec;
      if (spawnTimer <= 0) {
        // WAVE2は編隊の出るペースを少しだけ上げる（balance.wave.wave2SpawnRateMultiplier。Phase2 Step14）
        var spawnRate = EG.wave && EG.wave.getSpawnRateMultiplier ? EG.wave.getSpawnRateMultiplier() : 1;
        var spawnInterval = miniboss.active ? B.miniboss.zakoSpawnIntervalSec : B.spawnIntervalSec / spawnRate;
        var spawnCount = miniboss.active ? B.miniboss.zakoFormationSize : B.formationSize;
        spawnFormation(spawnCount);
        spawnTimer += spawnInterval;
      }

      updateMiniboss(dtSec);

      // 自機の攻撃（ショットが残っていて、狙える敵がいる間だけ。中ボス自身は狙わない＝正解でしか倒せない）
      var canFire = EG.state.data.shot > 0 && enemies.length > 0;
      if (canFire) {
        fireTimer -= dtSec;
        if (fireTimer <= 0) {
          firePlayerBullet();
          fireTimer += B.fireIntervalSec;
        }
        // ショットの消費（見た目の連射とは別に、4秒に1発分ずつ減る。DESIGN.md §5.2）
        ammoTimer -= dtSec;
        if (ammoTimer <= 0) {
          var s = EG.state.data;
          s.shot = Math.max(0, s.shot - 1);
          EG.hud.render();
          ammoTimer += EG.balance.shot.consumeIntervalSec;
        }
      }

      // 被弾タイマー（ボムの無敵中は数えない。本当に当たる弾が飛んでいる間は次のタイマーを動かさない）
      if (bombInvulnTimer > 0) {
        bombInvulnTimer -= dtSec;
      } else if (!incomingRealBullet) {
        hitTimer -= dtSec;
        if (hitTimer <= 0) {
          triggerRealHit();
        }
      }
    }

    updateEnemies(dtSec);
    EG.danmaku.update(dtSec, player.x, player.y); // 飾りの弾を動かす（Step11）
    updatePlayerBullets(dtSec);
    updateEnemyBullets(dtSec);
    updateRealBullet(dtSec);
    updateParticles(dtSec);
    updateShockwaves(dtSec);
    updateSparks(dtSec);
    updateDamageTexts(dtSec);

    if (hitFlashTimer > 0) {
      hitFlashTimer -= dtSec;
    }
    if (shakeTimer > 0) {
      shakeTimer -= dtSec;
    }
    if (bombFlashTimer > 0) {
      bombFlashTimer -= dtSec;
    }
    if (muzzleFlashTimer > 0) {
      muzzleFlashTimer -= dtSec;
    }
    if (hitEdgeFlashTimer > 0) {
      hitEdgeFlashTimer -= dtSec;
    }
    // 弾幕に当たった反応の後片づけ（Step12）
    if (playerWhiteTimer > 0) {
      playerWhiteTimer -= dtSec;
    }
    if (decoShakeTimer > 0) {
      decoShakeTimer -= dtSec;
    }
    if (decoEdgeTimer > 0) {
      decoEdgeTimer -= dtSec;
    }
    var kickKeep = Math.max(0, 1 - dtSec / EG.balance.danmaku.hit.kickDecaySec);
    playerKick.x *= kickKeep; // はじかれたぶんが、すぐ元に戻っていく
    playerKick.y *= kickKeep;

    if (EG.state.data.life <= 0) {
      triggerGameOver();
    }
  }

  // ===== 描画（canvas.jsから、星空を描いた後に呼ばれる） =====

  // ザコの機体。種類ごとに色を変える（fan=水色 / ring=桃 / spiral=緑 / scatter=紫）。
  // 大きさは balance.battle.enemyScale 倍（Step11。従来の約1.3倍）
  function drawEnemies(ctx) {
    var k = B.enemyScale;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      ctx.fillStyle = EG.danmaku.kindInfo(e.kind).hull;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y + 10 * k);
      ctx.lineTo(e.x - 10 * k, e.y - 8 * k);
      ctx.lineTo(e.x + 10 * k, e.y - 8 * k);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 弾幕（飾りの弾）と、混み具合に数える従来の弾を、光る絵でまとめて描く（Step11。src/danmaku.js）
  function drawEnemyBullets(ctx) {
    EG.danmaku.draw(ctx, enemyBullets);
  }

  function drawPlayerBullets(ctx) {
    ctx.fillStyle = "#bdf3ff";
    for (var i = 0; i < playerBullets.length; i++) {
      var b = playerBullets[i];
      ctx.fillRect(b.x - 2, b.y - 6, 4, 10);
    }
  }

  // 「本当に当たる弾」（被弾タイマーが鳴ったときに自機へ飛ぶ弾）。飾りの弾より大きく、
  // 白い芯・赤いふち・脈打つ輪で、ひと目で「これが当たる」と分かるようにする（Step11）
  function drawRealBullet(ctx) {
    if (!incomingRealBullet) {
      return;
    }
    var x = incomingRealBullet.x;
    var y = incomingRealBullet.y;
    var pulse = 0.5 + 0.5 * Math.sin(elapsed * 18);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var halo = ctx.createRadialGradient(x, y, 2, x, y, 30);
    halo.addColorStop(0, "rgba(255, 60, 60, 0.85)");
    halo.addColorStop(1, "rgba(255, 30, 30, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "#ff2b2b";
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, " + (0.6 + 0.4 * pulse).toFixed(2) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 16 + 4 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 自機の残像（Step10。DESIGN.md §5.1 v0.6「残像」）。記録しておいた直近の位置・傾きを、
  // 古いものほど薄く描く。自機本体（drawPlayer）より先に描く
  function drawPlayerTrail(ctx) {
    var n = playerTrail.length;
    for (var i = 0; i < n; i++) {
      var t = playerTrail[i];
      var a = B.playerTrailMaxAlpha * ((i + 1) / n);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(t.x, t.y);
      ctx.rotate(t.tilt);
      ctx.scale(B.playerScale, B.playerScale); // 機体を大きく（Step11）
      ctx.fillStyle = "#9fe6ff";
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(-12, 12);
      ctx.lineTo(12, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // 自機（Step7: エンジンの炎・傾き・砲口の光を追加。Step10: もっと派手に。DESIGN.md §5.1）
  function drawPlayer(ctx) {
    if (hitFlashTimer > 0) {
      // 点滅（一定間隔で描画をスキップする）
      var blinkOn = Math.floor(hitFlashTimer / B.hitBlinkIntervalSec) % 2 === 0;
      if (!blinkOn) {
        return;
      }
    }
    ctx.save();
    ctx.translate(player.x + playerKick.x, player.y + playerKick.y); // 弾幕に当たったときのはじかれ（Step12）
    ctx.rotate(player.tilt);
    ctx.scale(B.playerScale, B.playerScale); // 機体を大きく（Step11。以降の座標はすべてこの倍率がかかる）

    // エンジンの炎（船体の後ろでゆらめく）。ダッシュ・ロール中はもっと大きく（Step10）
    var boosting = playerDashTimer > 0 || playerRollTimer > 0;
    var flicker = 0.7 + 0.3 * Math.abs(Math.sin(elapsed * B.engineFlickerSpeed)) + Math.random() * 0.08;
    var flameLen = B.engineFlameBaseLen * flicker * (boosting ? B.engineFlameBoostMultiplier : 1);
    ctx.save();
    ctx.globalAlpha = 0.85;
    var flameGrad = ctx.createLinearGradient(0, 12, 0, 12 + flameLen);
    flameGrad.addColorStop(0, "#ffe27a");
    flameGrad.addColorStop(1, "rgba(255, 120, 60, 0)");
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.moveTo(-6, 12);
    ctx.lineTo(6, 12);
    ctx.lineTo(0, 12 + flameLen);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 船体
    ctx.shadowColor = bombInvulnTimer > 0 ? "#ffe27a" : "#9fe6ff";
    ctx.shadowBlur = 8;
    ctx.fillStyle = bombInvulnTimer > 0 ? "#ffe27a" : "#9fe6ff"; // ボム無敵中は色を変える
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(-12, 12);
    ctx.lineTo(12, 12);
    ctx.closePath();
    ctx.fill();

    // 弾幕に当たった瞬間、機体が白く光る（Step12。だんだん薄くなる）
    if (playerWhiteTimer > 0 && playerWhiteMax > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (playerWhiteTimer / playerWhiteMax) * 1.4);
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(-12, 12);
      ctx.lineTo(12, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 発砲した瞬間、砲口を光らせる
    if (muzzleFlashTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, muzzleFlashTimer / B.muzzleFlashSec);
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, -14, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawParticles(ctx) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = "rgba(255, 200, 120, " + a.toFixed(2) + ")";
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
  }

  // 爆発の衝撃の輪（Step10）
  function drawShockwaves(ctx) {
    for (var i = 0; i < shockwaves.length; i++) {
      var s = shockwaves[i];
      var a = Math.max(0, s.life / s.maxLife);
      ctx.save();
      ctx.globalAlpha = a * 0.7;
      ctx.strokeStyle = "#ffd27a";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0, s.radius), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 被弾したときに自機から散る火花（Step10）
  function drawSparks(ctx) {
    for (var i = 0; i < sparks.length; i++) {
      var sp = sparks[i];
      var a = Math.max(0, sp.life / sp.maxLife);
      var h = (sp.size || 3) / 2;
      ctx.fillStyle = "rgba(" + (sp.rgb || "255,255,200") + "," + a.toFixed(2) + ")";
      ctx.fillRect(sp.x - h, sp.y - h, h * 2, h * 2);
    }
  }

  // 被弾したときの「-1」表示（Step10）
  function drawDamageTexts(ctx) {
    ctx.save();
    ctx.font = "bold 18px 'Consolas', 'Courier New', monospace";
    ctx.textAlign = "center";
    for (var i = 0; i < damageTexts.length; i++) {
      var d = damageTexts[i];
      var a = Math.max(0, d.life / d.maxLife);
      ctx.fillStyle = "rgba(255, 80, 80, " + a.toFixed(2) + ")";
      ctx.fillText(d.text, d.x, d.y);
    }
    ctx.restore();
  }

  // 被弾したとき、画面のふちが赤く光る（Step10。DESIGN.md §5.1 v0.6）
  // t: 光の強さの割合（1→0）、alphaMax: いちばん濃いときの不透明度（Step12で、弾幕に当たったときにも使えるよう引数にした）
  function drawEdgeGlow(ctx, t, alphaMax) {
    if (t <= 0) {
      return;
    }
    var alpha = alphaMax * t;
    var grad = ctx.createRadialGradient(
      canvasW / 2, canvasH / 2, Math.min(canvasW, canvasH) * 0.35,
      canvasW / 2, canvasH / 2, Math.max(canvasW, canvasH) * 0.75
    );
    grad.addColorStop(0, "rgba(255, 0, 0, 0)");
    grad.addColorStop(1, "rgba(255, 30, 30, " + alpha.toFixed(2) + ")");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();
  }

  function drawBombFlash(ctx) {
    var a = Math.max(0, bombFlashTimer / B.bombFlashSec) * 0.9;
    ctx.fillStyle = "rgba(255, 255, 255, " + a.toFixed(2) + ")";
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  function drawGameOver(ctx) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, canvasW, canvasH);
    if (EG.screens && EG.screens.isResultShown()) {
      return; // 成績つきの画面にも GAME OVER と出るので、ここでは描かない
    }
    ctx.fillStyle = "#ff5050";
    ctx.font = "bold 56px 'Consolas', 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("GAME OVER", canvasW / 2, canvasH / 2);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  function draw(ctx) {
    drawMiniboss(ctx);
    drawEnemies(ctx);
    drawEnemyBullets(ctx);
    drawRealBullet(ctx);
    drawPlayerBullets(ctx);
    drawPlayerTrail(ctx);
    drawPlayer(ctx);
    drawParticles(ctx);
    drawShockwaves(ctx);
    drawSparks(ctx);
    drawDamageTexts(ctx);
    if (hitEdgeFlashTimer > 0) {
      drawEdgeGlow(ctx, hitEdgeFlashTimer / B.hitEdgeFlashSec, B.hitEdgeFlashAlpha);
    }
    if (decoEdgeTimer > 0 && decoEdgeDur > 0) {
      drawEdgeGlow(ctx, decoEdgeTimer / decoEdgeDur, decoEdgeAlpha); // 弾幕（大玉）に当たったときの軽い赤い光（Step12）
    }
    if (gameOver) {
      drawGameOver(ctx);
    }
    if (bombFlashTimer > 0) {
      drawBombFlash(ctx);
    }
  }

  // canvas.jsが画面ぜんたいの揺れに使う（被弾時の小さな画面揺れ。DESIGN.md §5.1）
  function getShakeOffset() {
    // 本当の被弾の揺れに、弾幕に当たった揺れ（Step12）を重ねる。合計は本当の被弾のいちばん大きい揺れまで
    var real = shakeTimer > 0 ? B.shakeAmplitude * (shakeTimer / B.shakeSec) : 0;
    var deco = decoShakeTimer > 0 && decoShakeDur > 0 ? decoShakeAmp * (decoShakeTimer / decoShakeDur) : 0;
    var amp = Math.min(real + deco, B.shakeAmplitude);
    if (amp <= 0) {
      return { x: 0, y: 0 };
    }
    return { x: (Math.random() * 2 - 1) * amp, y: (Math.random() * 2 - 1) * amp };
  }

  // 向きが変わるなどでCanvasの大きさが変わったとき（layout.jsから）。敵・弾・自機の位置を新しい大きさに割合で移し替え、
  // 速さも新しい倍率に合わせ直す。ゲーム前（init前）なら大きさを覚えるだけ
  function onResize(newW, newH, oldW, oldH) {
    var oldSx = sx;
    var oldSy = sy;
    canvasW = newW;
    canvasH = newH;
    if (!B) {
      return;
    }
    updateScale();
    var rx = newW / oldW;
    var ry = newH / oldH;
    var kx = sx / oldSx;
    var ky = sy / oldSy;
    function mv(o) {
      o.x *= rx;
      o.y *= ry;
    }
    function mvVel(o) {
      o.vx = (o.vx || 0) * kx;
      o.vy *= ky;
    }
    mv(player);
    player.targetX *= rx;
    player.targetY *= ry;
    player.vx *= kx;
    player.vy *= ky;
    playerTrail.forEach(mv);
    enemies.forEach(function (e) {
      mv(e);
      if (e.pattern === "cross") {
        e.baseY *= ry;
        e.vx *= kx;
      } else {
        e.baseX *= rx;
        e.speed *= ky;
        if (e.pattern === "wave") {
          e.amplitude *= kx;
        }
      }
    });
    enemyBullets.forEach(function (b) {
      mv(b);
      mvVel(b);
    });
    playerBullets.forEach(mv);
    particles.forEach(mv);
    shockwaves.forEach(mv);
    sparks.forEach(mv);
    damageTexts.forEach(mv);
    if (incomingRealBullet) {
      mv(incomingRealBullet);
    }
    if (miniboss.active || miniboss.x) {
      mv(miniboss);
      miniboss.vx *= kx;
    }
    EG.danmaku.onResize(newW, newH, rx, ry);
  }

  var listenersAttached = false; // イベント購読は最初の1回だけでよい（次StepでWave開始のたびinit()を呼び直しても二重登録しないため）

  function init(canvasElement) {
    B = EG.balance.battle;
    canvasW = canvasElement.width;
    canvasH = canvasElement.height;
    updateScale();

    player = {
      x: canvasW / 2,
      y: canvasH - 60,
      vx: 0,
      vy: 0,
      targetX: canvasW / 2,
      targetY: canvasH - 60,
      tilt: 0,
    };
    playerRetargetTimer = 0; // 開始してすぐ1回目の行き先を選ぶ
    playerDashTimer = 0;
    playerDashCooldown = B.playerDashCooldownSec;
    playerRollTimer = 0;
    playerRollCooldown = B.playerRollCooldownSec;
    playerTrail = [];
    playerTrailTimer = 0;

    EG.danmaku.init(canvasW, canvasH); // 弾幕（飾りの弾・絵の準備・中ボスの弾幕）を初期状態に（Step11）
    enemies = [];
    enemyBullets = [];
    playerBullets = [];
    particles = [];
    shockwaves = [];
    sparks = [];
    damageTexts = [];
    incomingRealBullet = null;

    miniboss = { active: false, x: 0, y: 0, hp: 0, hpMax: 0, vx: 0, hitFlashTimer: 0 };
    minibossBulletTimer = 0;
    minibossDefeated = false;

    elapsed = 0;
    fireTimer = 0;
    ammoTimer = EG.balance.shot.consumeIntervalSec;
    hitFlashTimer = 0;
    shakeTimer = 0;
    bombFlashTimer = 0;
    bombInvulnTimer = 0;
    muzzleFlashTimer = 0;
    hitEdgeFlashTimer = 0;
    playerWhiteTimer = 0;
    playerWhiteMax = 0;
    playerKick = { x: 0, y: 0 };
    decoShakeTimer = 0;
    decoEdgeTimer = 0;
    decoLastAt = { small: -99, medium: -99, large: -99 };
    decoStats = newDecoStats();
    EG.danmaku.setHitHandler(onDecoHit); // 飾りの弾が自機に当たったときの反応を登録（Step12）
    gameOver = false;

    spawnFormation(B.initialEnemyCount); // ウェーブ開始時、最初からいる編隊
    spawnTimer = B.spawnIntervalSec;     // 次の編隊が出るまでの時間

    hitTimer = hitIntervalForCongestion();

    if (!listenersAttached) {
      EG.events.on("eg:answer", onAnswerEvent);
      document.addEventListener("keydown", onKeyDown);
      listenersAttached = true;
    }
  }

  return {
    init: init,
    update: update,
    draw: draw,
    onResize: onResize,
    // ボムボタン（タップ用。スペースキーと同じ働き。一時停止中・ゲーム終了後は何もしない）
    requestBomb: function () {
      if ((EG.pause && EG.pause.isPaused()) || gameOver || minibossDefeated) {
        return false;
      }
      var before = EG.state.data.bomb;
      tryBomb();
      return EG.state.data.bomb < before;
    },
    getShakeOffset: getShakeOffset,
    // 弾幕に当たった回数の数え直し（調整・テスト用。tools/test/hit_test.js が使う。Step12）
    resetDecoStats: function () {
      decoStats = newDecoStats();
    },
    isGameOver: function () {
      return gameOver;
    },
    // ===== 中ボス用（wave.jsから呼ぶ。Step5） =====
    startMiniboss: startMiniboss,
    damageMiniboss: damageMiniboss,
    isMinibossDefeated: function () {
      return minibossDefeated;
    },
    getMinibossHpRatio: function () {
      if (!miniboss.hpMax) {
        return 0;
      }
      return EG.util.clamp(miniboss.hp / miniboss.hpMax, 0, 1);
    },
    // 調整・デバッグ用: 画面の混み具合や残りタイマーを見るための状態出力（DESIGN.md §2.2の調整に使う）
    // elapsed/life/shot/enemyCount/enemyBulletCount/congestion/hitIntervalは既存の確認スクリプトが
    // 使っているので名前を変えないこと（Step4・Step5のnode idle_test.js）
    getDebugInfo: function () {
      return {
        elapsed: elapsed,
        playerX: player.x,
        playerY: player.y,
        enemyCount: enemies.length,
        enemyBulletCount: enemyBullets.length,
        decoBulletCount: EG.danmaku.count(), // 飾りの弾の数（Step11。混み具合には数えない）
        decoHits: JSON.parse(JSON.stringify(decoStats)), // 弾幕に当たった回数と、反応を出した回数（大きさ別。Step12）
        playerBulletCount: playerBullets.length,
        congestion: congestionCount(),
        hitInterval: hitIntervalForCongestion(),
        hitTimer: hitTimer,
        life: EG.state.data.life,
        shot: EG.state.data.shot,
        shotEmpty: EG.state.data.shot <= 0, // Step8: 弾切れかどうか（被弾間隔が半分になっているか）
        spawnTimer: spawnTimer,
        fireTimer: fireTimer,
        minibossActive: miniboss.active,
        minibossHp: miniboss.hp,
      };
    },
  };
})();
