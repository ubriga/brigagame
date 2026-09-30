/* Render3D — WebGL (Three.js) render layer over the same server-owned game
 * state. Stage 1 (skeleton): capability probe, lazy engine load, placeholder
 * block towers/cannons, lighting/fog, adaptive pixel ratio, instant fallback
 * to the 2D renderer. This module ONLY reads game state; logic is untouched.
 * The server snapshot (snap.towers) stays the single source of truth. */
const Render3D = {
  _T: null, _r: null, _scene: null, _cam: null,
  _blocks: { p1: [], p2: [] }, _mats: null, _cannons: {},
  _frame: { n: 0, t: 0 }, _pr: 1, _lowStreak: 0,
  _ready: false,

  capable() {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch (e) { return false; }
  },

  /* init(game) → true when the 3D scene is live. Throws on any failure so
   * the caller silently keeps the 2D renderer. */
  async init(game) {
    if (Render3D._ready) return true;
    const T = await import("../vendor/three.module.min.js");
    Render3D._T = T;
    /* Stage 2: real mockup-inspired models. Any load failure keeps the
     * stage-1 placeholder path below (fallback intact). */
    let models = null;
    try {
      const { GLTFLoader } = await import("../vendor/GLTFLoader.min.js");
      const loader = new GLTFLoader();
      const load = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));
      models = {
        brass: await load("../assets/gfx3d/block_brass.glb"),
        window: await load("../assets/gfx3d/block_window.glb"),
        vent: await load("../assets/gfx3d/block_vent.glb"),
        cannon: await load("../assets/gfx3d/cannon.glb"),
      };
      // Stage 3 background set: each asset optional; a miss never kills the scene.
      const opt = (u) => new Promise((res) => loader.load(u, res, undefined, () => res(null)));
      models.bg = {
        mountains: await opt("../assets/gfx3d/bg_mountains.glb"),
        airship: await opt("../assets/gfx3d/bg_airship.glb"),
        moon: await opt("../assets/gfx3d/bg_moon.glb"),
        gear: await opt("../assets/gfx3d/bg_gear.glb"),
        cloud: await opt("../assets/gfx3d/bg_cloud.glb"),
        plate: await opt("../assets/gfx3d/ground_plate.glb"),
        lantern: await opt("../assets/gfx3d/prop_lantern.glb"),
        viaduct: await opt("../assets/gfx3d/bg_viaduct.glb"),
        village: await opt("../assets/gfx3d/bg_village.glb"),
        mountainsFar: await opt("../assets/gfx3d/bg_mountains_far.glb"),
      };
    } catch (e) { models = null; }
    Render3D._models = models;
    /* The 2D canvas already owns a 2D context, so WebGL gets its own canvas
     * stacked UNDER it in #game-stage. The 2D canvas keeps drawing HUD,
     * aim, shots and particles on top; world painting moves to WebGL. */
    const host = game.canvas;
    const gl = document.createElement("canvas");
    gl.id = "gl3d-canvas";
    gl.style.cssText = "position:absolute;z-index:0;pointer-events:none";
    host.parentElement.insertBefore(gl, host);
    host.style.position = "relative";
    host.style.zIndex = "1";
    host.classList.add("gl3d");
    const syncBox = () => {
      gl.style.left = host.offsetLeft + "px";
      gl.style.top = host.offsetTop + "px";
      gl.style.width = host.offsetWidth + "px";
      gl.style.height = host.offsetHeight + "px";
    };
    syncBox();
    window.addEventListener("resize", syncBox);
    Render3D._gl = gl; Render3D._host = host; Render3D._syncBox = syncBox;
    /* High-density phones (DPR>2) skip MSAA and start at 1.5x: at that
     * pixel density AA is invisible but costs real fill-rate. */
    const dpr = window.devicePixelRatio || 1;
    const r = new T.WebGLRenderer({ canvas: gl, antialias: dpr <= 2, powerPreference: "high-performance" });
    const pr = dpr > 2 ? 1.5 : Math.min(dpr, 2);
    Render3D._pr = pr;
    r.setPixelRatio(pr);
    r.setSize(game.W, game.H, false);
    r.outputColorSpace = T.SRGBColorSpace;

    const scene = new T.Scene();
    scene.background = new T.Color(0x0c1f30);
    scene.fog = new T.Fog(0x0c1f30, 900, 2400);

    const cam = new T.PerspectiveCamera(38, game.W / game.H, 1, 4000);
    cam.position.set(game.W / 2, 380, 780);
    cam.lookAt(game.W / 2, 230, 0);

    // Lighting: cool moon key + warm points at the tower tops (stage-1 base).
    scene.add(new T.HemisphereLight(0x9db8d6, 0x2a1f10, 1.05));
    const moon = new T.DirectionalLight(0xd8e6ff, 1.0);
    moon.position.set(650, 900, 500);
    scene.add(moon);
    for (const side of ["p1", "p2"]) {
      const pl = new T.PointLight(0xffb35c, 26000, 420, 2);
      const tx = game.tx(side) + game.TCOLS * game.BLOCK / 2;
      pl.position.set(tx, game.TROWS * game.BLOCK + 60, 90);
      scene.add(pl);
    }

    // Ground strip (world y=0 is the game GROUND line).
    const ground = new T.Mesh(
      new T.BoxGeometry(game.W, 44, 170),
      new T.MeshStandardMaterial({ color: 0x2a2438, roughness: 0.85, metalness: 0.3 }));
    ground.position.set(game.W / 2, -22, 0);
    scene.add(ground);

    /* Stage 3: background / ground detail / atmosphere. Everything is static
     * or near-static; per-frame cost is a few position/rotation writes. */
    Render3D._bgMotion = []; Render3D._bgT = 0;
    const glowTex = (() => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 128;
      const g2d = cv.getContext("2d");
      const gr = g2d.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.35, "rgba(255,255,255,.42)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g2d.fillStyle = gr; g2d.fillRect(0, 0, 128, 128);
      return new T.CanvasTexture(cv);
    })();
    Render3D._glowTex = glowTex;
    const glowSprite = (color, sx, sy, opacity) => {
      const sp = new T.Sprite(new T.SpriteMaterial({
        map: glowTex, color, transparent: true, opacity,
        blending: T.AdditiveBlending, depthWrite: false, fog: false }));
      sp.scale.set(sx, sy, 1);
      return sp;
    };
    const bg = models && models.bg;
    if (bg) {
      if (bg.mountains) {
        const mt = bg.mountains.scene.clone(true);
        mt.position.set(game.W / 2, -10, -520);
        scene.add(mt);
      }
      if (bg.mountainsFar) {
        const mf = bg.mountainsFar.scene.clone(true);
        mf.position.set(game.W / 2, -6, -720);
        scene.add(mf);
      }
      if (bg.moon) {
        const mn = bg.moon.scene.clone(true);
        mn.scale.setScalar(1.5);
        mn.position.set(game.W * 0.74, 520, -480);
        scene.add(mn);
        const halo = glowSprite(0xffe9b8, 380, 380, 0.42);
        halo.position.copy(mn.position); halo.position.z -= 12;
        scene.add(halo);
      }
      if (bg.airship) {
        const ship = bg.airship.scene.clone(true);
        ship.scale.setScalar(1.3);
        ship.position.set(game.W * 0.2, 500, -360);
        ship.add(glowSprite(0xffd9a0, 34, 34, 0.55));   // nose light
        ship.children[ship.children.length - 1].position.set(56, 0, 0);
        scene.add(ship);
        Render3D._bgMotion.push({ obj: ship, kind: "drift", speed: 9, min: -180, max: game.W + 180 });
      }
      if (bg.cloud) {
        for (const [fx, fy, fz, sc, sp] of [[0.15, 560, -480, 1.6, 5.0], [0.55, 615, -540, 2.1, 3.0], [0.85, 500, -400, 1.2, 6.5]]) {
          const cl = bg.cloud.scene.clone(true);
          cl.scale.setScalar(sc);
          cl.position.set(game.W * fx, fy, fz);
          scene.add(cl);
          Render3D._bgMotion.push({ obj: cl, kind: "drift", speed: sp, min: -220, max: game.W + 220 });
        }
      }
      if (bg.gear) {
        for (const [fx, rot] of [[0.32, 0.06], [0.68, -0.045]]) {
          const gr = bg.gear.scene.clone(true);
          gr.position.set(game.W * fx, 24, -260);
          scene.add(gr);
          Render3D._bgMotion.push({ obj: gr, kind: "spin", speed: rot });
        }
      }
      if (bg.plate) {
        for (let px = 0; px * 120 < game.W + 120; px++) {
          const plate = bg.plate.scene.clone(true);
          plate.position.set(px * 120 + 60, -1.5, 0);
          scene.add(plate);
        }
      }
      if (bg.viaduct) {
        const vd = bg.viaduct.scene.clone(true);
        vd.position.set(game.W / 2 - 277, 118, -360);
        scene.add(vd);
      }
      if (bg.village) {
        for (const vx of [-190, game.W + 40]) {
          const vg = bg.village.scene.clone(true);
          vg.position.set(vx, -4, -300);
          scene.add(vg);
        }
      }
      if (bg.lantern) {
        for (const [fx, withLight] of [[0.30, false], [0.42, true], [0.58, true], [0.70, false]]) {
          const lp = bg.lantern.scene.clone(true);
          const lx = game.W * fx;
          lp.position.set(lx, 0, 88);
          scene.add(lp);
          const halo = glowSprite(0xffa54d, 60, 60, 0.5);
          halo.position.set(lx, 37, 88);
          scene.add(halo);
          if (withLight) {
            const pl2 = new T.PointLight(0xffa54d, 14000, 300, 2);
            pl2.position.set(lx, 42, 92);
            scene.add(pl2);
          }
        }
      }
    }
    // Water strip in front of the platform: dark teal, tight specular sheen.
    {
      const water = new T.Mesh(new T.PlaneGeometry(game.W + 700, 230),
        new T.MeshStandardMaterial({ color: 0x10303f, roughness: 0.16, metalness: 0.6 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(game.W / 2, -20.5, 200);
      scene.add(water);
    }
    // Mist banks rolling over the platform edge: big soft drifting sprites.
    for (const [fx, fy, fz, sx, sy, op, sp] of [
        [0.2, 14, 120, 380, 95, 0.13, 7], [0.6, 24, 70, 320, 80, 0.10, 5],
        [0.85, 10, 150, 420, 100, 0.12, 9], [0.4, 30, 30, 260, 70, 0.08, 4]]) {
      const mist = glowSprite(0x9fc4d8, sx, sy, op);
      mist.position.set(game.W * fx, fy, fz);
      scene.add(mist);
      Render3D._bgMotion.push({ obj: mist, kind: "drift", speed: sp, min: -320, max: game.W + 320 });
    }
    // Cool rim from behind so tower edges read against the sky.
    {
      const rim = new T.DirectionalLight(0x86b4e8, 0.35);
      rim.position.set(game.W / 2, 620, -700);
      rim.target.position.set(game.W / 2, 120, 0);
      scene.add(rim); scene.add(rim.target);
    }

    // Sky dome: vertical gradient teal→deep blue (procedural 2px texture).
    {
      const cv = document.createElement("canvas"); cv.width = 2; cv.height = 256;
      const g2d = cv.getContext("2d");
      const gr = g2d.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, "#02060e"); gr.addColorStop(0.6, "#081a2c"); gr.addColorStop(1, "#123243");
      g2d.fillStyle = gr; g2d.fillRect(0, 0, 2, 256);
      const tex = new T.CanvasTexture(cv);
      const dome = new T.Mesh(new T.SphereGeometry(2300, 20, 14),
        new T.MeshBasicMaterial({ map: tex, side: T.BackSide, fog: false, depthWrite: false }));
      dome.position.set(game.W / 2, 200, 0);
      dome.renderOrder = -10;
      scene.add(dome);
      scene.background = null;
    }

    // Stars: two size layers, additive, subtle.
    {
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (const [n, size, op] of [[150, 1.7, 0.75], [26, 3.4, 0.95]]) {
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos[i * 3] = rnd() * (game.W + 900) - 450;
          pos[i * 3 + 1] = 300 + rnd() * 560;
          pos[i * 3 + 2] = -300 - rnd() * 420;
        }
        const sg = new T.BufferGeometry();
        sg.setAttribute("position", new T.BufferAttribute(pos, 3));
        scene.add(new T.Points(sg, new T.PointsMaterial({
          color: 0xf5e9c8, size, sizeAttenuation: false, fog: false,
          transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false })));
      }
    }

    // Placeholder block materials (stage 1 cubes; GLB models arrive in stage 2).
    Render3D._mats = {
      p1: new T.MeshStandardMaterial({ color: 0x3f7d6e, roughness: 0.5, metalness: 0.65 }),
      p2: new T.MeshStandardMaterial({ color: 0x8a6b3f, roughness: 0.5, metalness: 0.65 }),
      cannon: new T.MeshStandardMaterial({ color: 0x5c4a33, roughness: 0.45, metalness: 0.7 }),
    };
    const blockGeo = new T.BoxGeometry(game.BLOCK - 2, game.BLOCK - 2, game.BLOCK - 2);
    /* Deterministic variant map: mostly brass plates, a window band near the
     * middle rows, vents lower down — mirrors the 2D mockup sheet. */
    const blockProto = (side, r, c) => {
      if (!models) return new T.Mesh(blockGeo, Render3D._mats[side]);
      const pick = (r * 5 + c * 3 + (side === "p2" ? 1 : 0)) % 9;
      const src = pick === 0 ? models.window : (pick === 1 || pick === 5) ? models.vent : models.brass;
      return src.scene.clone(true);
    };
    for (const side of ["p1", "p2"]) {
      const group = [];
      for (let r = 0; r < 12; r++) {                 // pool covers tower_expansion
        const row = [];
        for (let c = 0; c < game.TCOLS; c++) {
          const m = blockProto(side, r, c);
          m.position.set(
            game.tx(side) + c * game.BLOCK + game.BLOCK / 2,
            (r + 1) * game.BLOCK - game.BLOCK / 2,
            0);
          m.visible = false;
          scene.add(m);
          row.push(m);
        }
        group.push(row);
      }
      Render3D._blocks[side] = group;
      // Placeholder cannon: pivot group at the muzzle base, barrel cylinder.
      const pivot = new T.Group();
      const topY = game.TROWS * game.BLOCK;
      pivot.position.set(game.tx(side) + game.TCOLS * game.BLOCK / 2, topY + 10, 0);
      if (models) {
        const cm = models.cannon.scene.clone(true);   // barrel along +x, rotates with aim
        cm.position.y = -2;
        pivot.add(cm);
      } else {
        const base = new T.Mesh(new T.BoxGeometry(30, 14, 24), Render3D._mats.cannon);
        base.position.y = -4;
        pivot.add(base);
        const barrel = new T.Mesh(new T.CylinderGeometry(5, 6.5, 46, 12), Render3D._mats.cannon);
        barrel.rotation.z = -Math.PI / 2;             // barrel along +x, rotates with aim
        barrel.position.x = 20;
        pivot.add(barrel);
      }
      scene.add(pivot);
      Render3D._cannons[side] = pivot;
    }

    Render3D._r = r; Render3D._scene = scene; Render3D._cam = cam;
    Render3D._frame = { n: 0, t: 0 }; Render3D._lowStreak = 0; Render3D._adapted = false;
    Render3D._ready = true;
    return true;
  },

  /* draw(game) → false only when the renderer asks for a permanent fallback
   * (sustained low FPS at the lowest pixel ratio). Otherwise renders. */
  draw(game) {
    const T = Render3D._T, t0 = performance.now();
    const towers = (game.displayTowers || (game.snap && game.snap.towers));
    if (!towers) { Render3D._r.render(Render3D._scene, Render3D._cam); return true; }
    for (const side of ["p1", "p2"]) {
      const tw = towers[side] || [];
      const grid = Render3D._blocks[side];
      for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) {
        const cell = tw[r] && tw[r][c];
        // tower rows are stored top-first; world row 0 is the bottom block.
        grid[r][c].visible = cell != null && cell > 0;
        if (grid[r][c].visible)
          grid[r][c].position.y = (tw.length - r) * game.BLOCK - game.BLOCK / 2;
      }
      // Cannon aim: my side follows the live aim, the other rests at 45°.
      const pivot = Render3D._cannons[side];
      const mine = side === game.mySide();
      const deg = mine ? (game.aimAngle || 45) : 45;
      const f = side === "p1" ? 1 : -1;
      pivot.rotation.z = f * deg * Math.PI / 180 * (side === "p1" ? 1 : 1);
      if (side === "p2") pivot.rotation.y = Math.PI; // mirror barrel direction
      const d = { rows: tw.length || game.TROWS };
      pivot.position.y = d.rows * game.BLOCK + 10;
    }
    // Stage-3 atmosphere motion: wall-clock dt, a few writes per frame.
    const bm = Render3D._bgMotion;
    if (bm && bm.length) {
      const nwb = performance.now();
      const dtb = Math.min(0.25, Render3D._bgT ? (nwb - Render3D._bgT) / 1000 : 0.016);
      Render3D._bgT = nwb;
      for (const mo of bm) {
        if (mo.kind === "spin") mo.obj.rotation.z += mo.speed * dtb * 6;
        else {
          mo.obj.position.x += mo.speed * dtb;
          if (mo.obj.position.x > mo.max) mo.obj.position.x = mo.min;
        }
      }
    }
    Render3D._r.render(Render3D._scene, Render3D._cam);

    // Adaptive pixel ratio + fallback request (admin-tunable floor).
    // First window is 1s so an overloaded device reacts fast; later windows
    // are 2s. Steps multiply by 0.75 (2.0 → 1.5 → 1.13 …) instead of small
    // fixed subtractions, so relief lands within a few seconds, not half a
    // minute. At the 0.5 floor, 3 consecutive low windows give up to 2D.
    const cfg = (window.App && App.graphics && App.graphics.webgl3d) || {};
    if (cfg.adaptive !== false) {
      const dt = performance.now() - t0;
      const f = Render3D._frame; f.n++; f.t += dt;
      const winMs = Render3D._adapted ? 2000 : 1000;
      if (f.t >= winMs) {
        const avg = f.n / (f.t / 1000);
        f.n = 0; f.t = 0;
        const floor = Number(cfg.min_fps) || 45;
        if (avg < floor) {
          Render3D._adapted = true;
          if (Render3D._pr > 0.5) {
            Render3D._pr = Math.max(0.5, Math.round(Render3D._pr * 0.75 * 100) / 100);
            Render3D._r.setPixelRatio(Render3D._pr);
          } else if (++Render3D._lowStreak >= 3) return false; // give up → 2D
        } else Render3D._lowStreak = 0;
      }
    }
    return true;
  },

  dispose() {
    try { Render3D._r && Render3D._r.dispose(); } catch (e) {}
    try {
      if (Render3D._syncBox) window.removeEventListener("resize", Render3D._syncBox);
      if (Render3D._gl && Render3D._gl.parentElement) Render3D._gl.parentElement.removeChild(Render3D._gl);
      if (Render3D._host) Render3D._host.classList.remove("gl3d");
    } catch (e) {}
    Render3D._gl = null; Render3D._host = null; Render3D._syncBox = null;
    Render3D._models = null; Render3D._bgMotion = null; Render3D._bgT = 0;
    Render3D._r = null; Render3D._scene = null; Render3D._cam = null;
    Render3D._blocks = { p1: [], p2: [] }; Render3D._cannons = {};
    Render3D._ready = false;
  },
};
if (typeof window !== "undefined") window.Render3D = Render3D;
