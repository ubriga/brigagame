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
    const r = new T.WebGLRenderer({ canvas: gl, antialias: true, powerPreference: "high-performance" });
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    Render3D._pr = pr;
    r.setPixelRatio(pr);
    r.setSize(game.W, game.H, false);
    r.outputColorSpace = T.SRGBColorSpace;

    const scene = new T.Scene();
    scene.background = new T.Color(0x0c1f30);
    scene.fog = new T.Fog(0x0c1f30, 800, 1700);

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
    Render3D._frame = { n: 0, t: 0 }; Render3D._lowStreak = 0;
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
    Render3D._r.render(Render3D._scene, Render3D._cam);

    // Adaptive pixel ratio + fallback request (admin-tunable floor, 3s window).
    const cfg = (window.App && App.graphics && App.graphics.webgl3d) || {};
    if (cfg.adaptive !== false) {
      const dt = performance.now() - t0;
      const f = Render3D._frame; f.n++; f.t += dt;
      if (f.t >= 3000) {
        const avg = f.n / (f.t / 1000);
        f.n = 0; f.t = 0;
        const floor = Number(cfg.min_fps) || 45;
        if (avg < floor) {
          if (Render3D._pr > 0.5) {
            Render3D._pr = Math.max(0.5, Render3D._pr - 0.25);
            Render3D._r.setPixelRatio(Render3D._pr);
          } else if (++Render3D._lowStreak >= 2) return false; // give up → 2D
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
    Render3D._models = null;
    Render3D._r = null; Render3D._scene = null; Render3D._cam = null;
    Render3D._blocks = { p1: [], p2: [] }; Render3D._cannons = {};
    Render3D._ready = false;
  },
};
if (typeof window !== "undefined") window.Render3D = Render3D;
