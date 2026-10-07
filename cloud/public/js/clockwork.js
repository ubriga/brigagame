/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/* Clockwork Towers graphics pack (direction D2) - a fully separated visual
 * layer. Blocks stay the source of truth; this module only draws. Activated
 * by the graphics_pack admin control; off = the classic renderer untouched.
 * Low-spec mode (auto FPS detection or manual pref) freezes animation. */
const Clockwork = {
  BASE: "assets/gfx/clockwork/",
  _img: {}, _ready: false, _loading: false,
  _autoLow: false, _fps: null,

  FILES: {
    block_a: "block_a.png", block_b: "block_b.png", block_vent: "block_vent.png",
    dmg_light: "dmg_light.png", dmg_heavy: "dmg_heavy.png",
    gear_s: "gear_s.png", gear_m: "gear_m.png", gear_l: "gear_l.png",
    window: "window.png", window_p1: "window_p1.png", window_p2: "window_p2.png",
    chimney: "chimney.png", steam: "steam.png", shard: "shard.png",
    strip_p1: "strip_p1.png", strip_p2: "strip_p2.png",
    pennant_p1: "pennant_p1.png", pennant_p2: "pennant_p2.png",
    rivet: "rivet.png", gauge: "gauge.png", needle: "needle.png",
    bg_sky: "bg_sky.webp", bg_far: "bg_far.webp", bg_near: "bg_near.webp",
    airship: "airship.webp",
    tower_sheet: "tower_sheet.webp", cannon: "cannon.webp",
  },

  cfg() {
    return (typeof App !== "undefined" && App.graphics) || null;
  },

  /* null = pack off (classic renderer), "low" = static mode, "full" = animated */
  mode() {
    const g = Clockwork.cfg();
    if (!g || g.enabled !== true || !Clockwork._ready) return null;
    let pref = null;
    try { pref = (typeof Consent !== "undefined") ? Consent.getPref("bg_gfx_low") : null; } catch (e) {}
    if (pref === "1") return "low";
    if (pref === "full") return "full";
    if (g.low_spec_default === true) return "low";
    if (Clockwork._autoLow) return "low";
    if ((navigator.hardwareConcurrency || 8) <= 3) return "low";
    return "full";
  },

  preload() {
    if (Clockwork._ready || Clockwork._loading) return;
    Clockwork._loading = true;
    const jobs = Object.entries(Clockwork.FILES).map(([k, f]) => new Promise(res => {
      const im = new Image();
      im.onload = () => { Clockwork._img[k] = im; res(); };
      im.onerror = () => res();
      im.src = Clockwork.BASE + f;
    }));
    Promise.all(jobs).then(() => { Clockwork._ready = true; });
  },

  /* One-shot FPS probe per match: drop to low if the device cannot hold 45. */
  tick(dt, mode) {
    if (mode !== "full" || Clockwork._fps === "done") return;
    if (!Clockwork._fps) Clockwork._fps = { n: 0, t: 0 };
    const f = Clockwork._fps;
    f.n++; f.t += dt;
    if (f.t >= 3) {
      if (f.n / f.t < 45) Clockwork._autoLow = true;
      Clockwork._fps = "done";
    }
  },
  resetMatch() { Clockwork._fps = null; },

  maxParticles(mode) {
    const g = Clockwork.cfg() || {};
    if (mode === "low") return 32;
    return Math.min(96, Math.max(16, Number(g.max_particles) || 96));
  },

  // ---------- background ----------
  background(g, t, mode) {
    const c = g.ctx, I = Clockwork._img, W = g.W, H = g.H, GR = g.GROUND;
    const low = mode === "low";
    if (I.bg_sky) c.drawImage(I.bg_sky, -20, -20, W + 40, H + 40);
    // far industrial skyline, slow parallax
    if (I.bg_far) {
      const fw = 1400, off = low ? 200 : (t * 4) % fw;
      c.drawImage(I.bg_far, -off, GR - 196, fw, 200);
      c.drawImage(I.bg_far, fw - off, GR - 196, fw, 200);
    }
    // airship drifts slowly (owner can freeze it)
    if (I.airship) {
      const gcfg = Clockwork.cfg() || {};
      if (!low && gcfg.airship_motion !== false) {
        const span = W + 460, x = ((t * 11) % span) - 320;
        c.drawImage(I.airship, x, 84 + Math.sin(t * .3) * 7, 240, 100);
      } else {
        c.drawImage(I.airship, 585, 96, 200, 83);
      }
    }
    // ground plate + near strip with lamps
    c.fillStyle = "#34261a";
    c.fillRect(-20, GR - 4, W + 40, H - GR + 24);
    if (I.bg_near) {
      const fw = 1400, off = low ? 0 : (t * 9) % fw;
      c.drawImage(I.bg_near, -off, GR - 34, fw, 90);
      c.drawImage(I.bg_near, fw - off, GR - 34, fw, 90);
    }
  },

  // ---------- towers ----------
  tower(g, side, mode) {
    const c = g.ctx, I = Clockwork._img, B = g.BLOCK;
    const tower = (g.displayTowers || g.snap.towers)[side];
    const rows = tower.length, cols = tower[0].length;
    const towerX = g.tx(side), towerY = g.GROUND - rows * B;
    const w = cols * B, h = rows * B;
    const hpInfo = (g.displayHp || g.snap.tower_hp || {})[side];
    const blockMax = hpInfo && hpInfo.max ? hpInfo.max / (rows * cols) : 15;
    const hpFrac = hpInfo && hpInfo.max ? Math.max(0, hpInfo.hp / hpInfo.max) : 1;
    const t = g.idleClock, low = mode === "low";
    const p1 = side === "p1";

    // hit wobble + low-HP shudder (frozen in low-spec)
    let wob = 0;
    if (!low) {
      for (const a of g.anims) if (a.kind === "hitflash" && a.target === side && a.t >= 0 && a.t < 1)
        wob = Math.sin(a.t * Math.PI * 6) * (1 - a.t) * 3;
      if (hpFrac < .25) wob += Math.sin(t * 40) * .6;
    }
    c.save(); c.translate(wob, 0);

    // deep silhouette
    c.fillStyle = "rgba(24,13,6,.30)";
    c.beginPath(); c.roundRect(towerX - 7, towerY + 5, w + 14, h - 1, 10); c.fill();

    const variants = [I.block_a, I.block_b, I.block_vent];
    const alive = (r, col) => tower[r] && tower[r][col] > 0;

    // team metal strip on the outer edge
    const strip = I[p1 ? "strip_p1" : "strip_p2"];
    if (strip && !I.tower_sheet) {
      const sx = p1 ? towerX - 6 : towerX + w - 2;
      c.drawImage(strip, sx, towerY + 4, 8, h - 6);
    }

    // blocks: when the mockup tower sheet is loaded, each alive block draws
    // its own slice of the real 3D cylinder (p2 samples mirrored columns) so
    // the tower reads as the mockup's riveted tower; destroyed blocks still
    // open real holes. Falls back to brass plates without the sheet.
    const sheet = I.tower_sheet;
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const hp = tower[r][col];
      if (hp <= 0) continue;
      const x = towerX + col * B, y = g.GROUND - (rows - r) * B;
      const frac = Math.min(1, hp / blockMax);
      c.save();
      if (sheet) {
        const sc = p1 ? col : (cols - 1 - col);
        c.globalAlpha = .94 + .06 * frac;
        c.drawImage(sheet, sc * 26, r * 26, 26, 26, x, y, B, B);
      } else {
        const spr = variants[(r * 7 + col * 3) % 3];
        c.globalAlpha = .55 + .45 * frac;
        if (spr) c.drawImage(spr, x, y, B, B);
      }
      c.globalAlpha = 1;
      if (frac < .35 && I.dmg_heavy) c.drawImage(I.dmg_heavy, x, y, B, B);
      else if (frac < .72 && I.dmg_light) c.drawImage(I.dmg_light, x, y, B, B);
      c.restore();
    }

    // crumbling blocks reuse the brass plate sprite
    for (const b of g.blockTransitions) if (b.side === side) {
      const q = Math.min(1, b.age / b.life), p = g.blockCenter(side, b.r, b.col);
      c.save(); c.translate(p.x, p.y); c.rotate((q > .5 ? q - .5 : 0) * (p1 ? .18 : -.18));
      const scale = q < .5 ? 1 : 1 - (q - .5) * .55; c.scale(scale, scale);
      c.globalAlpha = 1 - Math.max(0, q - .72) / .28;
      if (sheet) {
        const sc = p1 ? b.col : (cols - 1 - b.col);
        c.drawImage(sheet, sc * 26, b.r * 26, 26, 26, -B / 2, -B / 2, B, B);
      } else if (I.block_a) c.drawImage(I.block_a, -B / 2 + 1, -B / 2 + 1, B - 2, B - 2);
      if (I.dmg_heavy) c.drawImage(I.dmg_heavy, -B / 2 + 1, -B / 2 + 1, B - 2, B - 2);
      c.restore();
    }

    // riveted doorway at the base (classic blocks only - the sheet bakes the base)
    if (I.tower_sheet) { /* sheet mode: mockup tower has no doorway */ } else {
    c.save();
    c.fillStyle = "rgba(24,13,6,.5)";
    c.beginPath(); c.roundRect(towerX + w / 2 - 12, g.GROUND - 28, 24, 28, [11, 11, 2, 2]); c.fill();
    c.strokeStyle = "#3f2d18"; c.lineWidth = 2;
    c.beginPath(); c.roundRect(towerX + w / 2 - 12, g.GROUND - 28, 24, 28, [11, 11, 2, 2]); c.stroke();
    c.fillStyle = "rgba(244,201,93,.7)";
    c.beginPath(); c.arc(towerX + w / 2 + 5, g.GROUND - 14, 2, 0, Math.PI * 2); c.fill();
    c.restore();
    }

    // gears mounted on deterministic anchor cells - they fall with their block
    const firing = (g.cannonRecoil && (g.cannonRecoil[side] || 0)) > 0;
    const speed = low ? 0 : (firing ? 5.2 : (hpFrac < .25 ? 2.6 : .8));
    const th = t * speed;
    const gearAt = (img, r, col, size, dir) => {
      if (!img || !alive(Math.min(r, rows - 1), col)) return;
      const p = g.blockCenter(side, Math.min(r, rows - 1), col);
      c.save(); c.translate(p.x, p.y); c.rotate(dir * th);
      c.drawImage(img, -size / 2, -size / 2, size, size);
      c.restore();
    };
    gearAt(I.gear_m, 2, 0, 34, 1);
    gearAt(I.gear_s, 1, 2, 24, -1.6);
    gearAt(I.gear_m, 4, 3, 30, .7);

    // warm porthole windows with team enamel ring; flicker when hurt
    const win = I.tower_sheet ? null : (I[p1 ? "window_p1" : "window_p2"] || I.window);
    const winAt = (r, col, seed) => {
      if (!win || !alive(r, col)) return;
      const x = towerX + col * B, y = g.GROUND - (rows - r) * B;
      let a = .92;
      if (!low) a = hpFrac < .25 ? .55 + .35 * Math.abs(Math.sin(t * 9 + seed)) : .85 + .15 * Math.sin(t * 2.2 + seed);
      c.save(); c.globalAlpha = a;
      c.drawImage(win, x + 1, y + 1, B - 2, B - 2);
      c.restore();
    };
    winAt(1, 1, 0); winAt(3, 2, 2.1);

    // chimney on the top-left alive cell + rhythmic steam puffs
    let chimCol = -1;
    for (let col = 0; col < cols; col++) if (alive(0, col)) { chimCol = col; break; }
    if (chimCol >= 0 && I.chimney) {
      const cx = towerX + chimCol * B + B / 2, cy = towerY;
      c.drawImage(I.chimney, cx - 10, cy - 26, 20, 27);
      if (!low && I.steam) {
        for (let i = 0; i < 2; i++) {
          const phase = (t * .16 + i * .5 + (p1 ? 0 : .23)) % 1;
          const s = 12 + phase * 22;
          c.save(); c.globalAlpha = .5 * (1 - phase);
          c.drawImage(I.steam, cx - s / 2 + Math.sin(t + i) * 3, cy - 34 - phase * 30 - s / 2, s, s);
          c.restore();
        }
      }
    }

    // pressure gauge by the cannon hub: needle rides reload, spikes on fire
    const m = g.muzzle(side);
    const f = p1 ? 1 : -1;
    const gx = m.x - f * 24, gy = m.y + 16;
    if (I.gauge && !I.tower_sheet) c.drawImage(I.gauge, gx - 15, gy - 15, 30, 30);
    if (I.needle && !I.tower_sheet) {
      const rec = (g.cannonRecoil && (g.cannonRecoil[side] || 0));
      const base = .18 + .4 * (g.reloadFrac ? g.reloadFrac() : 1);
      const pressure = low ? .5 : Math.min(1, base + (rec > 0 ? rec / .34 * .8 : 0));
      const ang = (-120 + 180 * pressure) * Math.PI / 180;
      c.save(); c.translate(gx, gy); c.rotate(ang);
      c.drawImage(I.needle, -15, -15, 30, 30);
      c.restore();
    }

    // end-of-match character: winner vents celebratory steam, loser sputters
    if (g.ended && g.snap && g.snap.winner_side && I.steam && !low) {
      const won = g.snap.winner_side === side;
      for (let i = 0; i < (won ? 3 : 2); i++) {
        const phase = (t * (won ? .3 : .5) + i * .37 + (p1 ? 0 : .19)) % 1;
        const sp = won ? 16 + phase * 30 : 10 + phase * 16;
        c.save();
        c.globalAlpha = (won ? .55 : .4) * (1 - phase);
        if (!won) c.filter = "brightness(.55)";
        const sx = towerX + w * (won ? (.25 + i * .25) : (.35 + i * .3));
        c.drawImage(I.steam, sx - sp / 2, towerY - 14 - phase * (won ? 56 : 26) - sp / 2, sp, sp);
        c.restore();
      }
      if (won) { // victory gear spin
        const p = g.blockCenter(side, Math.min(2, rows - 1), 0);
        if (I.gear_s) { c.save(); c.translate(p.x + w * .3, p.y - 10); c.rotate(t * 9); c.drawImage(I.gear_s, -12, -12, 24, 24); c.restore(); }
      }
    }

    // team pennant (replaces the classic flag while the pack is on)
    const pen = I[p1 ? "pennant_p1" : "pennant_p2"];
    if (pen) {
      const poleX = towerX + (p1 ? 8 : w - 8);
      const swayA = low ? 0 : Math.sin(t * 2.1 + (p1 ? 0 : 1.4)) * .06;
      c.save(); c.translate(poleX, towerY - 6); c.rotate(p1 ? swayA : Math.PI + swayA);
      c.drawImage(pen, p1 ? -4 : -48, -30, 52, 40);
      c.restore();
    }
    c.restore();
  },

  // ---------- shot: brass rivet with a hot trail ----------
  shot(g, a) {
    const c = g.ctx, I = Clockwork._img;
    if (a.t < 0.08 && a.side) {
      const m = g.muzzle(a.side);
      c.save(); c.globalAlpha = .8 * (1 - a.t / 0.08);
      if (I.steam) {
        c.drawImage(I.steam, m.x - 22, m.y - 22, 44, 44);
        c.drawImage(I.steam, m.x - 12, m.y - 30, 30, 30);
      }
      c.restore();
    }
    const n = a.points.length;
    const fi = g.shotIndex(a), i = Math.floor(fi), f = fi - i;
    const p0 = a.points[i], p1 = a.points[Math.min(n - 1, i + 1)];
    const x = p0[0] + (p1[0] - p0[0]) * f, y = p0[1] + (p1[1] - p0[1]) * f;
    c.strokeStyle = "rgba(232,160,92,.5)"; c.lineWidth = 3; c.lineCap = "round";
    c.beginPath();
    const upto = Math.max(0, Math.floor(fi));
    c.moveTo(a.points[0][0], a.points[0][1]);
    for (let k = 1; k <= upto; k++) c.lineTo(a.points[k][0], a.points[k][1]);
    c.lineTo(x, y); c.stroke();
    const r = a.weapon === "cluster_mini" ? 9 : 14;
    if (I.rivet) {
      const vx = p1[0] - p0[0], vy = p1[1] - p0[1];
      const ang = Math.atan2(vy, vx) + a.t * 14;
      c.save(); c.translate(x, y); c.rotate(ang);
      const glow = c.createRadialGradient(0, 0, 1, 0, 0, r * 1.6);
      glow.addColorStop(0, "rgba(244,201,93,.55)"); glow.addColorStop(1, "rgba(244,201,93,0)");
      c.fillStyle = glow; c.beginPath(); c.arc(0, 0, r * 1.6, 0, 7); c.fill();
      const sz = a.weapon === "cluster_mini" ? 14 : 20;
      c.drawImage(I.rivet, -sz / 2, -sz / 2, sz, sz);
      c.restore();
    } else {
      c.fillStyle = "#fff7a8"; c.shadowColor = "#fbbf24"; c.shadowBlur = 10;
      c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
    }
  },

  // ---------- explosion: steam burst + sparks + gear shards ----------
  explosion(g, a) {
    const c = g.ctx, I = Clockwork._img, t = a.t;
    if (a.cosmetic) {
      c.save(); c.globalAlpha = .5 * (1 - t);
      if (I.steam) c.drawImage(I.steam, a.x - a.r, a.y - a.r, a.r * 2, a.r * 2);
      c.restore();
      return;
    }
    if (t < 0.12) {
      c.save(); c.globalAlpha = .9 * (1 - t / 0.12);
      c.fillStyle = "#fff7e0";
      c.beginPath(); c.arc(a.x, a.y, a.r * .8, 0, 7); c.fill();
      c.restore();
    }
    // expanding steam puffs
    if (I.steam) for (let i = 0; i < 5; i++) {
      const ang = i * 1.256 + .7, dist = a.r * t * 1.05;
      const size = a.r * (0.55 + 1.0 * t);
      c.save(); c.globalAlpha = .72 * (1 - t);
      c.drawImage(I.steam, a.x + Math.cos(ang) * dist - size / 2,
        a.y + Math.sin(ang) * dist - size / 2 - t * 22, size, size);
      c.restore();
    }
    // hot core
    const r = a.r * (0.3 + 0.6 * Math.min(1, t * 1.6));
    const grad = c.createRadialGradient(a.x, a.y, 1, a.x, a.y, r);
    grad.addColorStop(0, `rgba(255,230,160,${.8 * (1 - t)})`);
    grad.addColorStop(.6, `rgba(212,138,60,${.6 * (1 - t)})`);
    grad.addColorStop(1, "rgba(120,70,30,0)");
    c.fillStyle = grad;
    c.beginPath(); c.arc(a.x, a.y, r, 0, 7); c.fill();
    // sparks
    c.save(); c.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      const ang = i * .897 + .3, d1 = a.r * t * 1.5, d0 = d1 - a.r * .22;
      c.globalAlpha = Math.max(0, 1 - t * 1.15);
      c.strokeStyle = t < .4 ? "#ffe9a8" : "#e8a05c";
      c.lineWidth = 3 * (1 - t) + 1;
      c.beginPath();
      c.moveTo(a.x + Math.cos(ang) * d0, a.y + Math.sin(ang) * d0);
      c.lineTo(a.x + Math.cos(ang) * d1, a.y + Math.sin(ang) * d1 + t * 14);
      c.stroke();
    }
    c.restore();
    // gear shards tumbling outward
    if (I.shard) for (let i = 0; i < 3; i++) {
      const ang = i * 2.1 + 1.1, dist = a.r * t * (1.1 + i * .25);
      c.save();
      c.translate(a.x + Math.cos(ang) * dist, a.y + Math.sin(ang) * dist + t * t * 26);
      c.rotate(t * (5 + i * 2) * (i % 2 ? 1 : -1));
      c.globalAlpha = Math.max(0, 1 - t * t);
      const s = 16 - i * 3;
      c.drawImage(I.shard, -s / 2, -s / 2, s, s);
      c.restore();
    }
    // brass shockwave ring
    c.save();
    c.strokeStyle = `rgba(226,188,122,${.65 * (1 - t)})`;
    c.lineWidth = 4 * (1 - t) + 1;
    c.beginPath(); c.arc(a.x, a.y, a.r * (0.4 + 1.6 * t), 0, 7); c.stroke();
    c.restore();
  },

  // ---------- debris: brass shard instead of flat rect ----------
  debris(g, a) {
    const c = g.ctx, I = Clockwork._img;
    c.save();
    c.globalAlpha = Math.max(0, 1 - a.t * a.t);
    c.translate(a.x, a.y); c.rotate(a.rot);
    if (I.block_a && a.size >= 10) {
      c.drawImage(I.block_a, -a.size / 2, -a.size / 2, a.size, a.size);
    } else if (I.shard) {
      c.drawImage(I.shard, -a.size / 2, -a.size / 2, a.size, a.size);
    }
    c.restore();
  },

  /* Smoke particles become warm steam puffs while the pack is on.
   * Returns true if it drew the particle. */
  steamParticle(c, p, q) {
    const I = Clockwork._img;
    if (!I.steam) return false;
    c.globalAlpha = .38 * q;
    const s = p.size * 3.2;
    c.drawImage(I.steam, p.x - s / 2, p.y - s / 2, s, s);
    return true;
  },
};
if (typeof window !== "undefined") window.Clockwork = Clockwork;
