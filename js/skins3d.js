/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/* Skins3D - procedural 3D versions of every tower skin (cosmetic only).
 * One builder per 2D "geometry" skin plus a generic builder driven by the same
 * style data the 2D renderer uses (fill, frame, glow, texture, emblem, tier).
 * No downloads, no logic, no hitbox: the server snapshot stays the source of
 * truth. Used by Render3D (in-match) and by the shop's 3D preview. */
const S3D_BASE = new URL("../assets/gfx3d/", document.currentScript.src).href;
const Skins3D = {
  BLOCK: 26, COLS: 4, ROWS: 6,

  /* admin switch, delivered with the rest of the graphics config */
  enabled() {
    try { const g = window.App && App.graphics && App.graphics.webgl3d; return !(g && g.skins3d === false); }
    catch (e) { return true; }
  },

  norm(raw) {
    if (Array.isArray(raw)) raw = { colors: raw, fill: raw, frame: raw[1], texture: "plain", emblem: "" };
    raw = raw || {};
    const colors = raw.colors || ["#3b82f6", "#1e3a8a"];
    const fill = raw.fill || colors;
    return { fill: [fill[0], fill[1] || fill[0]], frame: raw.frame || colors[1] || "#fff", glow: raw.glow || "",
      texture: raw.texture || "plain", emblem: raw.emblem || "", geometry: raw.geometry || "", tier: raw.tier || "" };
  },
  isDefault(raw) { const s = Skins3D.norm(raw); return s.fill[0] === "#60a5fa" && s.fill[1] === "#1d4ed8"; },
  key(raw) { const s = Skins3D.norm(raw); return [s.fill.join(), s.frame, s.glow, s.texture, s.emblem, s.geometry, s.tier].join("|"); },

  color(T, s) {
    const c = new T.Color();
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s || "");
    if (m) c.setRGB(m[1] / 255, m[2] / 255, m[3] / 255, T.SRGBColorSpace); else c.set(s || "#ffffff");
    return c;
  },

  /* texture family -> surface feel */
  surface(tex) {
    const t = tex || "plain";
    if (/steel|chrome|metal|carbon|circuit|mecha|copper/.test(t)) return { metal: .85, rough: .28, emis: 0 };
    if (/ice|pearl|opal|marble|crystal|coral|candy|glass|hologram|water|wave/.test(t)) return { metal: .15, rough: .14, emis: .12 };
    if (/lava|magma|inferno|solar|plasma|flame|aurora|nebula|quantum|neon|matrix|grid|storm|stars|void|obsidian|lunar/.test(t)) return { metal: .4, rough: .35, emis: .42 };
    if (/stone|brick|sand|clay|wood|rune|lacquer|leaf|scales|soft|fabric|paper|camo|pixel|stripe|petal|paint|comic/.test(t)) return { metal: 0, rough: .9, emis: 0 };
    return { metal: .25, rough: .55, emis: 0 };
  },

  /* tint the tower's block meshes (cloned materials, original values kept) */
  tintBlocks(T, grid, style, rows) {
    const s = Skins3D.norm(style), top = Skins3D.color(T, s.fill[0]), bot = Skins3D.color(T, s.fill[1]);
    const frame = Skins3D.color(T, s.frame), surf = Skins3D.surface(s.texture), tmp = new T.Color();
    const n = Math.max(1, rows - 1);
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) {
      const frac = Math.min(1, r / n);          // pool row 0 is the top row
      grid[r][c].traverse(o => {
        if (!o.isMesh || !o.material) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        const out = ms.map(m => {
          if (!m.userData.skinBase) {
            m = m.clone();
            m.userData.skinBase = { color: m.color ? m.color.clone() : null, emissive: m.emissive ? m.emissive.clone() : null,
              ei: m.emissiveIntensity, metal: m.metalness, rough: m.roughness };
          }
          const b = m.userData.skinBase;
          if (b.color) {
            const lum = Math.min(1, .25 + (b.color.r * .3 + b.color.g * .59 + b.color.b * .11) * 1.6);
            tmp.copy(top).lerp(bot, frac);
            m.color.copy(tmp).multiplyScalar(1.45 + .5 * lum);
          }
          if ("metalness" in m) { m.metalness = Math.max(b.metal || 0, surf.metal); m.roughness = surf.rough; }
          if (m.emissive && b.emissive) {
            const windowy = Math.max(b.emissive.r, b.emissive.g, b.emissive.b) > .45;
            if (windowy) { m.emissive.copy(frame).lerp(b.emissive, .25); m.emissiveIntensity = b.ei || 1; }
            else { m.emissive.copy(tmp).multiplyScalar(.5); m.emissiveIntensity = .3 + surf.emis + (s.glow ? .12 : 0); }
          }
          m.needsUpdate = true;
          return m;
        });
        o.material = Array.isArray(o.material) ? out : out[0];
      });
    }
  },

  /* ---------- ornament builders (tower-local: x 0..W, y 0..H up, z depth) ---------- */
  ornament(T, style, side, H) {
    const s = Skins3D.norm(style), W = Skins3D.COLS * Skins3D.BLOCK, D = 24;
    const f = side === "p2" ? -1 : 1;
    const light = Skins3D.color(T, s.fill[0]), dark = Skins3D.color(T, s.fill[1]), frame = Skins3D.color(T, s.frame);
    const glow = s.glow ? Skins3D.color(T, s.glow) : frame;
    const surf = Skins3D.surface(s.texture);
    const root = new T.Group(), upd = [];
    const std = (col, o = {}) => new T.MeshStandardMaterial(Object.assign({ color: col, roughness: surf.rough, metalness: surf.metal * .8 }, o));
    const emis = (col, k = .9) => new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: k, roughness: .4 });
    const add = (geo, mat, x, y, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); root.add(m); return m; };
    const poly = (pts, depth, mat, x, y, z) => {
      const sh = new T.Shape(); pts.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1]));
      const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
      const m = new T.Mesh(g, mat); m.position.set(x || 0, y || 0, (z || 0) - depth / 2); root.add(m); return m;
    };
    const cx = W / 2, g = s.geometry;
    const lightM = () => std(light), darkM = () => std(dark), frameM = () => std(frame, { metalness: .6, roughness: .3 });

    if (g === "missile") {
      add(new T.ConeGeometry(W * .34, 56, 24), lightM(), cx, H + 26, 0);
      for (const sx of [-1, 1]) poly([[0, 0], [sx * 28, -42], [sx * 4, -36], [sx * 4, 0]], 6, darkM(), cx + sx * (W * .44), 54, 0);
      add(new T.SphereGeometry(10, 16, 12), emis(new T.Color("#67e8f9"), .7), cx, H - 22, D / 2 + 1);
      for (let i = 0; i < 3; i++) { const fl = add(new T.ConeGeometry(6, 22, 10), emis(new T.Color(["#fef08a", "#fb923c", "#ef4444"][i]), 1.2), cx + (i - 1) * 22, -6, 2, Math.PI, 0, 0); upd.push(t => { fl.scale.y = 1 + .35 * Math.sin(t / 90 + i * 2); }); }
    } else if (g === "spaceship") {
      const sau = add(new T.SphereGeometry(1, 32, 16), darkM(), cx, H - 14, 0); sau.scale.set(W * .72, 14, 34);
      const dome = add(new T.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), std(light, { transparent: true, opacity: .85 }), cx, H - 10, 0); dome.scale.set(W * .28, 26, 22);
      for (const ox of [-.48, -.25, 0, .25, .48]) add(new T.SphereGeometry(3, 10, 8), emis(new T.Color(ox === 0 ? "#fef08a" : "#67e8f9"), 1), cx + W * ox * 1.3, H - 14, 24);
      const ring = add(new T.TorusGeometry(W * .5, 1.6, 8, 40), emis(new T.Color("#67e8f9"), 1), cx, H * .42, 0, Math.PI / 2); upd.push(t => { ring.position.y = H * .42 + Math.sin(t / 500) * 10; ring.material.emissiveIntensity = .7 + .3 * Math.sin(t / 300); });
    } else if (g === "tank") {
      add(new T.BoxGeometry(W + 36, 28, 40), darkM(), cx, 14, 0);
      for (let i = 0; i < 6; i++) add(new T.CylinderGeometry(8, 8, 6, 16), std(new T.Color("#111827")), -4 + i * (W + 8) / 5, 13, 21, Math.PI / 2);
      const tur = add(new T.SphereGeometry(1, 24, 12), darkM(), cx, H + 4, 0); tur.scale.set(W * .3, 16, 22);
      add(new T.CylinderGeometry(4.5, 4.5, 75, 14), frameM(), cx + f * 40, H + 6, 0, 0, 0, Math.PI / 2);
    } else if (g === "dragon") {
      for (const sx of [-1, 1]) poly([[0, 0], [sx * 38, 22], [sx * 14, 46], [sx * 46, 66], [0, 76]], 4, darkM(), cx + sx * (W / 2 - 4), H * .3, -8);
      const tail = new T.CatmullRomCurve3([new T.Vector3(W, 40, 0), new T.Vector3(W + 40, 22, 6), new T.Vector3(W + 34, 0, 8)]);
      add(new T.TubeGeometry(tail, 16, 4, 8), frameM(), 0, 0, 0);
      for (const sx of [.32, .68]) add(new T.ConeGeometry(7, 34, 10), lightM(), W * sx, H + 14, 0, 0, 0, (sx < .5 ? .25 : -.25));
      for (const sx of [.4, .6]) add(new T.SphereGeometry(3.4, 10, 8), emis(new T.Color("#fde047"), 1), W * sx, H - 24, D / 2 + 1);
    } else if (g === "pyramid") {
      const p = add(new T.ConeGeometry(W * .98, H + 38, 4), darkM(), cx, (H + 38) / 2 - 2, -22, 0, Math.PI / 4, 0); p.scale.z = .18;
      add(new T.TorusGeometry(10, 2.4, 8, 3), emis(new T.Color("#fef08a"), .9), cx, H * .62, D / 2 + 2, 0, 0, Math.PI / 6);
      add(new T.ConeGeometry(6, 12, 4), emis(new T.Color("#fef08a"), 1.1), cx, H + 8, 0, 0, Math.PI / 4, 0);
    } else if (g === "ice_fortress") {
      const ice = std(new T.Color("#bae6fd"), { transparent: true, opacity: .72, roughness: .1, metalness: .1, emissive: new T.Color("#7dd3fc"), emissiveIntensity: .45 });
      const spikes = [[-8, 40, 12], [20, 70, 14], [W * .5, 86, 16], [W - 20, 66, 14], [W + 8, 48, 12]];
      for (const [x, h, r] of spikes) add(new T.ConeGeometry(r, h, 6), ice, x, H - 14 + h / 2, -6);
      for (let i = 0; i < 5; i++) add(new T.ConeGeometry(2.6, 36, 6), ice, 12 + i * W / 4.4, H * .55, D / 2 + 3, Math.PI);
    } else if (g === "mecha") {
      for (const sx of [-1, 1]) { add(new T.BoxGeometry(24, H - 20, 24), darkM(), cx + sx * (W / 2 + 12), (H - 20) / 2 + 6, 0); add(new T.SphereGeometry(16, 16, 12), frameM(), cx + sx * (W / 2 + 12), H - 18, 0); }
      const bar = add(new T.BoxGeometry(W * .56, 7, 4), emis(new T.Color("#67e8f9"), .9), cx, H - 40, D / 2 + 1); upd.push(t => { bar.material.emissiveIntensity = .6 + .4 * Math.sin(t / 380); });
      add(new T.CylinderGeometry(1.8, 1.8, 28, 8), frameM(), cx, H + 14, 0); add(new T.SphereGeometry(4, 10, 8), emis(new T.Color("#67e8f9"), 1), cx, H + 30, 0);
    } else if (g === "orb") {
      const shell = add(new T.SphereGeometry(1, 32, 20), std(new T.Color("#c7d2fe"), { transparent: true, opacity: .2, roughness: .05 }), cx, H * .5, 0); shell.scale.set(W * .8, H * .62, 40);
      const dome = add(new T.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(light, { transparent: true, opacity: .8 }), cx, H, 0); dome.scale.set(W * .34, 20, 22);
      const ring = add(new T.TorusGeometry(W * .74, 1.8, 8, 48), emis(new T.Color("#e0f2fe"), .9), cx, H * .5, 0, Math.PI / 2.4);
      const orb = add(new T.SphereGeometry(5, 12, 10), emis(new T.Color("#f0abfc"), 1.1), cx, H * .5, 0);
      upd.push(t => { const a = t / 900; orb.position.set(cx + Math.cos(a) * W * .74, H * .5 + Math.sin(a) * 12, Math.sin(a) * 14); ring.rotation.z = Math.sin(a * .3) * .1; });
    } else if (g === "crystal") {
      for (const [dx, hh, rr] of [[-.34, 62, 10], [.34, 54, 9], [0, 92, 13]]) {
        const cr = add(new T.OctahedronGeometry(rr, 0), std(light, { roughness: .08, metalness: .2, transparent: true, opacity: .92, emissive: light, emissiveIntensity: .4 }), cx + W * dx, H + hh * .35, 0); cr.scale.set(1, hh / rr / 1.4, 1);
      }
      const spark = []; for (let i = 0; i < 3; i++) spark.push(add(new T.OctahedronGeometry(2.6, 0), emis(new T.Color("#ffffff"), 1), W * [.2, .75, .45][i], H * [.9, .7, .45][i], D / 2 + 2));
      upd.push(t => spark.forEach((m, i) => { m.scale.setScalar(.5 + .5 * Math.abs(Math.sin(t / 420 + i * 1.7))); }));
    } else if (g === "phoenix") {
      for (const sx of [-1, 1]) poly([[0, 0], [sx * 46, 8], [sx * 70, 46], [sx * 52, 84], [sx * 30, 54], [sx * 12, 62]], 3, std(dark, { emissive: glow, emissiveIntensity: .25 }), cx + sx * (W * .46 - 4), H * .2, -8);
      const fl = []; for (let i = 0; i < 5; i++) fl.push(add(new T.ConeGeometry(7, 26, 8), emis(new T.Color(["#fde047", "#f97316", "#ef4444", "#f97316", "#fde047"][i]), 1.1), W * (.12 + i * .19), H + 8, 0));
      upd.push(t => fl.forEach((m, i) => { m.scale.y = .7 + .5 * Math.abs(Math.sin(t / 160 + i * 1.7)); }));
    } else if (g === "castle") {
      for (const sx of [-1, 1]) {
        const x = cx + sx * (W / 2 + 12);
        add(new T.CylinderGeometry(12, 13, H - 14, 16), darkM(), x, (H - 14) / 2, 0);
        for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; add(new T.BoxGeometry(6, 10, 6), frameM(), x + Math.cos(a) * 11, H - 9, Math.sin(a) * 11); }
        add(new T.ConeGeometry(15, 26, 16), std(new T.Color("#7c3aed")), x, H + 8, 0);
        const fl = add(new T.PlaneGeometry(22, 12), new T.MeshStandardMaterial({ color: "#facc15", side: T.DoubleSide, roughness: .6 }), x + sx * 12, H + 28, 0); upd.push(t => { fl.rotation.y = Math.sin(t / 260 + sx) * .5; });
      }
    } else {
      /* generic skins: frame cap + plinth, tier crest, glow halo. Everything
       * is derived from the same style data the 2D renderer uses. */
      add(new T.BoxGeometry(W + 8, 6, D + 4), frameM(), cx, H + 3, 0);
      add(new T.BoxGeometry(W + 8, 7, D + 4), frameM(), cx, 3.5, 0);
      const n = s.tier === "legendary" ? 5 : s.tier === "epic" ? 3 : s.tier === "rare" ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const x = n === 1 ? cx : 14 + i * (W - 28) / (n - 1), h = (n === 1 ? 24 : 16) + (i === (n - 1) / 2 ? 14 : 0) + (s.tier === "legendary" ? 8 : 0);
        add(new T.ConeGeometry(5.5, h, 6), std(light, { metalness: Math.max(.35, surf.metal) }), x, H + 6 + h / 2, 0);
        if (s.tier === "legendary") add(new T.SphereGeometry(2.6, 8, 6), emis(frame, 1), x, H + 6 + h + 2, 0);
      }
      if (s.tier === "legendary" || s.glow) {
        const halo = Skins3D._halo(T, glow, s.tier === "legendary" ? .55 : .3);
        halo.scale.set(W * 2.4, H * 1.5, 1); halo.position.set(cx, H * .5, -22); root.add(halo);
        upd.push(t => { halo.material.opacity = (s.tier === "legendary" ? .5 : .28) + .12 * Math.sin(t / 420); });
      }
    }
    /* emblem on the tower front, like the 2D glyph */
    if (s.emblem) {
      const em = Skins3D._emblem(T, s.emblem, s.frame, s.glow);
      em.position.set(cx, H / 2, D / 2 + 3); em.scale.set(46, 46, 1); root.add(em);
    }
    root.userData.update = t => { for (const u of upd) u(t); };
    root.userData.key = Skins3D.key(style) + "#" + H;
    return root;
  },

  _halo(T, col, op) {
    if (!Skins3D._haloTex) {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const x = c.getContext("2d"), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(.4, "rgba(255,255,255,.35)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      Skins3D._haloTex = new T.CanvasTexture(c);
    }
    return new T.Sprite(new T.SpriteMaterial({ map: Skins3D._haloTex, color: col, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
  },
  _emblem(T, glyph, frame, glow) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d"); x.textAlign = "center"; x.textBaseline = "middle"; x.font = "bold 92px sans-serif";
    x.fillStyle = frame; if (glow) { x.shadowColor = glow; x.shadowBlur = 14; } x.globalAlpha = .88; x.fillText(glyph, 64, 70);
    return new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false, fog: false }));
  },

  /* ---------- 2D helper for the Clockwork battle renderer ---------- */
  _tc: {},
  tinted2D(img, sx, sy, raw, frac) {
    const s = Skins3D.norm(raw), B = 26, k = Skins3D.key(raw) + "|" + (img.src || img.width) + "|" + sx + "|" + sy + "|" + Math.round(frac * 8);
    let c = Skins3D._tc[k];
    if (c) return c;
    c = document.createElement("canvas"); c.width = c.height = B;
    const x = c.getContext("2d");
    x.drawImage(img, sx, sy, B, B, 0, 0, B, B);
    x.globalCompositeOperation = "source-atop";
    const g = x.createLinearGradient(0, 0, B, B); g.addColorStop(0, s.fill[0]); g.addColorStop(1, s.fill[1]);
    x.globalAlpha = .62; x.fillStyle = g; x.fillRect(0, 0, B, B);
    x.globalAlpha = .3 + .25 * frac; x.fillStyle = s.fill[1]; x.fillRect(0, 0, B, B);
    x.globalAlpha = .55; x.strokeStyle = s.frame; x.lineWidth = 1.5; x.strokeRect(1, 1, B - 2, B - 2);
    if (Object.keys(Skins3D._tc).length > 600) Skins3D._tc = {};
    Skins3D._tc[k] = c;
    return c;
  },

  /* ---------- in-match: apply to Render3D's scene ---------- */
  applyMatch(game) {
    const R = Render3D, T = R._T;
    if (!T || !R._scene) return;
    const on = Skins3D.enabled();
    R._skinState = R._skinState || { p1: null, p2: null };
    for (const side of ["p1", "p2"]) {
      const raw = game.snap && game.snap.skins && game.snap.skins[side];
      const rows = ((game.displayTowers || game.snap.towers)[side] || []).length || game.TROWS;
      const key = on && raw && !Skins3D.isDefault(raw) ? Skins3D.key(raw) + "#" + rows : "off";
      const st = R._skinState[side];
      if (st && st.key === key) continue;
      if (st && st.root) { R._scene.remove(st.root); st.root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      let root = null;
      if (key !== "off") {
        Skins3D.tintBlocks(T, R._blocks[side], raw, rows);
        root = Skins3D.ornament(T, raw, side, rows * game.BLOCK);
        root.position.set(game.tx(side), 0, 0);
        R._scene.add(root);
      } else if (st && st.key !== "off") Skins3D.resetBlocks(R._blocks[side]);
      R._skinState[side] = { key, root };
    }
  },
  tick(t) {
    const st = Render3D._skinState; if (!st) return;
    for (const side of ["p1", "p2"]) if (st[side] && st[side].root) st[side].root.userData.update(t);
  },
  resetBlocks(grid) {
    for (const row of grid) for (const o of row) o.traverse(m => {
      if (!m.isMesh || !m.material) return;
      const b = m.material.userData && m.material.userData.skinBase; if (!b) return;
      if (b.color) m.material.color.copy(b.color); if (b.emissive) { m.material.emissive.copy(b.emissive); m.material.emissiveIntensity = b.ei; }
      if ("metalness" in m.material) { m.material.metalness = b.metal; m.material.roughness = b.rough; }
    });
  },
  dispose() { Render3D._skinState = null; },

  /* ---------- shop preview: one shared offscreen renderer ---------- */
  _pq: Promise.resolve(),
  capable() { return typeof Render3D !== "undefined" && Render3D.capable(); },
  async _init() {
    if (Skins3D._pv) return Skins3D._pv;
    const T = await import("../vendor/three.module.min.js");
    const cv = document.createElement("canvas"); cv.width = 300; cv.height = 300;
    const r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.setSize(300, 300, false); r.setClearColor(0x000000, 0);
    let proto = null;
    try {
      const { GLTFLoader } = await import("../vendor/GLTFLoader.min.js");
      const ld = new GLTFLoader(), base = S3D_BASE;
      const get = f => new Promise(res => ld.load(base + f, res, undefined, () => res(null)));
      proto = { brass: await get("block_brass.glb"), window: await get("block_window.glb"), vent: await get("block_vent.glb") };
    } catch (e) { proto = null; }
    Skins3D._pv = { T, r, cv, proto };
    return Skins3D._pv;
  },
  /* draws the 3D tower into a 2D canvas (the right half of a split card) */
  preview(target, rawStyle, side = "p1") {
    Skins3D._pq = Skins3D._pq.then(async () => {
      try {
        const P = await Skins3D._init(), { T, r, cv, proto } = P;
        const B = Skins3D.BLOCK, W = Skins3D.COLS * B, H = Skins3D.ROWS * B;
        const scene = new T.Scene();
        scene.add(new T.HemisphereLight(0xdde6f2, 0x6a5a40, 1.15));
        const key = new T.DirectionalLight(0xfff4e0, 1.6); key.position.set(-120, 260, 300); scene.add(key);
        const rim = new T.DirectionalLight(0x9db8ff, .6); rim.position.set(200, 120, -200); scene.add(rim);
        const grid = [];
        for (let rr = 0; rr < Skins3D.ROWS; rr++) {
          const row = [];
          for (let c = 0; c < Skins3D.COLS; c++) {
            const pick = (rr * 5 + c * 3) % 9, src = proto && (pick === 0 ? proto.window : (pick === 1 || pick === 5) ? proto.vent : proto.brass);
            let m;
            if (src) { m = src.scene.clone(true); } else m = new T.Mesh(new T.BoxGeometry(B - 2, B - 2, B - 2), new T.MeshStandardMaterial({ color: 0xb8863b, roughness: .6, metalness: .3 }));
            m.position.set(c * B + B / 2, (Skins3D.ROWS - rr) * B - B / 2, 0); scene.add(m); row.push(m);
          }
          grid.push(row);
        }
        Skins3D.tintBlocks(T, grid, rawStyle, Skins3D.ROWS);
        const orn = Skins3D.ornament(T, rawStyle, side, H); scene.add(orn); orn.userData.update(700);
        const ground = new T.Mesh(new T.BoxGeometry(W + 90, 4, 60), new T.MeshStandardMaterial({ color: 0x4b5563, roughness: .8 })); ground.position.set(W / 2, -2, 0); scene.add(ground);
        const tw = target.width, th = target.height; r.setSize(tw, th, false);
        const cam = new T.PerspectiveCamera(30, tw / th, 1, 2000), tn = Math.tan(15 * Math.PI / 180);
        const dist = Math.max((H + 64) / 2 / tn, (W + 110) / 2 / tn / (tw / th));
        cam.position.set(W / 2 + 30, H * .52 + 26, dist); cam.lookAt(W / 2, H * .52 - 6, 0);
        r.render(scene, cam);
        const x = target.getContext("2d"); x.clearRect(0, 0, target.width, target.height);
        x.drawImage(cv, 0, 0, target.width, target.height);
        scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        return true;
      } catch (e) { console.warn("[skins3d] preview failed", e && e.message); return false; }
    });
    return Skins3D._pq;
  }
};
