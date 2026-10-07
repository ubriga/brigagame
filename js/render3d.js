/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/* Render3D — WebGL (Three.js) render layer over the same server-owned game
 * state. Stage 1 (skeleton): capability probe, lazy engine load, placeholder
 * block towers/cannons, lighting/fog, adaptive pixel ratio, instant fallback
 * to the 2D renderer. This module ONLY reads game state; logic is untouched.
 * The server snapshot (snap.towers) stays the single source of truth. */
/* GLB asset base resolved from THIS script's URL, so model paths work from
 * any deployment subpath (GitHub Pages project site) as well as root.
 * (fetch() inside GLTFLoader resolves against the document base, unlike
 * dynamic import() which resolves against the referencing script.) */
const R3D_GFX3D = new URL("../assets/gfx3d/", document.currentScript.src).href;
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
    const hostAtStart=game.canvas;
    if (Render3D._ready) return true;
    const T = await import("../vendor/three.module.min.js");
    Render3D._T = T;
    /* Stage 2: real mockup-inspired models. Any load failure keeps the
     * stage-1 placeholder path below (fallback intact). */
    let models = Render3D._modelCache || null;
    if (!models) try {
      const { GLTFLoader } = await import("../vendor/GLTFLoader.min.js");
      const loader = new GLTFLoader();
      /* Per-asset loading with one retry: a single failed GLB never kills the
       * whole set, and every failure is named in the console (no silent
       * all-or-nothing). */
      const loadOne = async (file, tries) => {
        const u = R3D_GFX3D + file;
        for (let i = 0; i < tries; i++) {
          try { return await new Promise((res, rej) => loader.load(u, res, undefined, rej)); }
          catch (e) {
            if (i === tries - 1) { console.warn("[r3d] GLB load failed:", u, e && (e.message || e)); return null; }
            await new Promise((r) => setTimeout(r, 400));
          }
        }
        return null;
      };
      models = {
        brass: await loadOne("block_brass.glb", 2),
        window: await loadOne("block_window.glb", 2),
        vent: await loadOne("block_vent.glb", 2),
        cannon: await loadOne("cannon.glb", 2),
      };
      if (!models.brass && !models.window && !models.vent && !models.cannon) {
        models = null;   // nothing loaded at all: full placeholder path
      }
      // Stage 3 background set: each asset optional; a miss never kills the scene.
      const opt = (file) => loadOne(file, 1);
      if (models) models.bg = {
        mountains: await opt("bg_mountains.glb"),
        airship: await opt("bg_airship.glb"),
        moon: await opt("bg_moon.glb"),
        gear: await opt("bg_gear.glb"),
        cloud: await opt("bg_cloud.glb"),
        plate: await opt("ground_plate.glb"),
        lantern: await opt("prop_lantern.glb"),
        viaduct: await opt("bg_viaduct.glb"),
        village: await opt("bg_village.glb"),
        mountainsFar: await opt("bg_mountains_far.glb"),
        blockCorner: await opt("block_corner.glb"),
        blockBelt: await opt("block_belt.glb"),
        blockRubble: await opt("block_rubble.glb"),
        pressFrame: await opt("press_frame.glb"),
        pressPiston: await opt("press_piston.glb"),
      };
    } catch (e) { models = null; console.warn("[r3d] model init failed:", e && (e.message || e)); }
    if(game._r3dCancelled || !game.canvas || game.canvas!==hostAtStart)return false;
    if (models) Render3D._modelCache = models;
    Render3D._models = models;
    /* The 2D canvas already owns a 2D context, so WebGL gets its own canvas
     * stacked UNDER it in #game-stage. The 2D canvas keeps drawing HUD,
     * aim, shots and particles on top; world painting moves to WebGL. */
    const host = game.canvas;
    /* Engine reuse: the renderer/WebGL context persist across matches (parked
     * by dispose); only the scene graph is rebuilt per match. Recreating the
     * context per match made every match after the first composite black on
     * some browsers. */
    let r, gl;
    if (!Render3D._r) {
    gl = document.createElement("canvas");
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
    /* GPU context loss (phone GPU reset, driver hiccup, OS reclaim) throws
     * no exception - the canvas just paints black. Catch it and drop to the
     * 2D view immediately; if the browser restores the context, re-init 3D. */
    gl.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      const g0 = Render3D._game;
      if (g0 && g0._r3d) {
        g0._r3d = false;
        try { Render3D.disposeFull(); } catch (e2) {}
        if (typeof toast === "function") {
          const en = (typeof Lang !== "undefined" && Lang.current === "en");
          toast(en ? "Advanced graphics paused - switched to the simple view"
                   : "הגרפיקה המתקדמת נעצרה זמנית - עוברים לתצוגה הפשוטה");
        }
      }
    });
    gl.addEventListener("webglcontextrestored", () => {
      try { const g1 = Render3D._game; if (g1) g1._r3dTryInit(); } catch (e) {}
    });
    /* High-density phones (DPR>2) skip MSAA and start at 1.5x: at that
     * pixel density AA is invisible but costs real fill-rate. */
    const dpr = window.devicePixelRatio || 1;
    r = new T.WebGLRenderer({ canvas: gl, antialias: dpr <= 2, powerPreference: "high-performance" });
    const pr = dpr > 2 ? 1.5 : Math.min(dpr, 2);
    Render3D._pr = pr;
    r.setPixelRatio(pr);
    r.setSize(game.W, game.H, false);
    r.outputColorSpace = T.SRGBColorSpace;
    /* Filmic tone mapping: compresses highlights instead of clipping them,
     * the single biggest "game look" upgrade available (research-backed). */
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    } else {
      /* Parked engine from a previous match: re-attach the same canvas to the
       * new game's host and re-point sizing/listeners. */
      gl = Render3D._gl;
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
      Render3D._host = host; Render3D._syncBox = syncBox;
      Render3D._r.setPixelRatio(Render3D._pr);
      Render3D._r.setSize(game.W, game.H, false);
      r = Render3D._r;
    }

    const scene = new T.Scene();
    scene.background = new T.Color(0x0c1f30);
    scene.fog = new T.Fog(0x0c1f30, 900, 2400);

    const cam = new T.PerspectiveCamera(38, game.W / game.H, 1, 4000);
    cam.position.set(game.W / 2, 380, 780);
    cam.lookAt(game.W / 2, 230, 0);

    // Lighting: cool moon key + warm points at the tower tops (stage-1 base).
    scene.add(new T.HemisphereLight(0x9db8d6, 0x2a1f10, 1.15));
    const moon = new T.DirectionalLight(0xd8e6ff, 1.0);
    moon.position.set(650, 900, 500);
    scene.add(moon);
    // Reference frame: rim separates silhouettes, warm fill lifts tower bodies.
    const rim = new T.DirectionalLight(0x9db8ff, 0.6);
    rim.position.set(game.W / 2, 700, -700);
    scene.add(rim);
    const fill = new T.DirectionalLight(0xffd9a8, 0.5);
    fill.position.set(game.W / 2, 350, 900);
    scene.add(fill);
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
      /* Step 3: atmospheric haze band at the mountain bases - pushes the
       * backdrop one value step quieter so the towers keep silhouette. */
      {
        const haze = glowSprite(0x35597e, game.W * 1.35, 190, 0.2);
        haze.material.blending = T.NormalBlending;
        haze.position.set(game.W / 2, 78, -430);
        scene.add(haze);
      }
      if (bg.moon) {
        const mn = bg.moon.scene.clone(true);
        mn.scale.setScalar(1.15);
        mn.position.set(game.W * 0.74, 520, -480);
        scene.add(mn);
        const halo = glowSprite(0xffe9b8, 320, 320, 0.30);
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
        for (const [fx, rot] of [[0.32, 0.06]]) {
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
        vd.position.set(game.W / 2 - 277, 118, -440);
        vd.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.75); } });
        scene.add(vd);
      }
      if (bg.village) {
        for (const vx of [-340, game.W + 200]) {
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
      const edge = (c === 0 || c === blockProto._cols - 1);
      const pick = (r * 5 + c * 3 + (side === "p2" ? 1 : 0)) % 9;
      const src = (edge && models.bg.blockCorner) ? models.bg.blockCorner
        : (r % 4 === 2 && models.bg.blockBelt) ? models.bg.blockBelt
        : pick === 0 ? models.window : (pick === 1 || pick === 5) ? models.vent : models.brass;
      if (!src) return new T.Mesh(blockGeo, Render3D._mats[side]);
      const cl = src.scene.clone(true);
      if (edge && c === blockProto._cols - 1 && c !== 0) {   // mirror the corner spine outward
        cl.scale.x = -1;
        cl.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
        cl.traverse((o) => { if (o.isMesh) o.material.side = T.DoubleSide; });
      }
      /* Value structure: tower base ~20% darker than its top (baked-AO
       * reading). Emissive windows stay bright — the contrast is the point. */
      const dim = 0.80 + 0.20 * Math.max(0, Math.min(1, (7 - r) / 6));
      cl.traverse((o) => {
        if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(dim); }
      });
      return cl;
    };
    Render3D._rubble = { p1: [], p2: [] };
    for (const side of ["p1", "p2"]) {
      const group = [];
      const snapCols = Math.min(8, Math.max(game.TCOLS,
        (game.snap && game.snap.towers && game.snap.towers[side] && game.snap.towers[side][0] && game.snap.towers[side][0].length) || 0));
      blockProto._cols = snapCols;
      for (let r = 0; r < 12; r++) {                 // pool covers tower_expansion
        const row = [];
        for (let c = 0; c < snapCols; c++) {
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
      if (models && models.bg.blockRubble) {
        for (let c = 0; c < snapCols; c++) {
          const rb = models.bg.blockRubble.scene.clone(true);
          rb.position.set(game.tx(side) + c * game.BLOCK + game.BLOCK / 2, 0, 0);
          rb.visible = false;
          scene.add(rb);
          Render3D._rubble[side].push(rb);
        }
      }
      // Placeholder cannon: pivot group at the muzzle base, barrel cylinder.
      const pivot = new T.Group();
      const topY = game.TROWS * game.BLOCK;
      pivot.position.set(game.tx(side) + game.TCOLS * game.BLOCK / 2, topY + 10, 0);
      if (models && models.cannon) {
        const cm = models.cannon.scene.clone(true);   // barrel along +x, rotates with aim
        cm.scale.setScalar(1.28);                        // reference frame: bigger cannon read
        cm.position.y = -2;
        pivot.add(cm);
        // cannon mount platform (identity head; rides tower top, grid untouched)
        if (models.bg.blockBelt) {
          const mount = models.bg.blockBelt.scene.clone(true);
          mount.scale.set(1.15, 0.6, 1.15);
          mount.position.y = -14;
          pivot.add(mount);
        }
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

    /* Post chain: bloom bonds emissives (lanterns/windows/moon/stars) into
     * one grade — the "Tunic" unifier. OutputPass applies the tone map.
     * Optional: any load failure keeps the plain render path. */
    let composer = null;
    const admCfg = (window.App && App.graphics && App.graphics.webgl3d) || {};
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
        import("../vendor/postprocessing/EffectComposer.js"),
        import("../vendor/postprocessing/RenderPass.js"),
        import("../vendor/postprocessing/UnrealBloomPass.js"),
        import("../vendor/postprocessing/OutputPass.js"),
        import("../vendor/postprocessing/ShaderPass.js"),
      ]);
      composer = new EffectComposer(r);
      composer.addPass(new RenderPass(scene, cam));
      /* NaN/Inf guard: a single bad HDR texel (rare specular/driver artifact)
       * gets smeared by bloom's blur chain into a giant black block. Clamp it
       * before the bright pass so the frame can degrade gracefully. */
      composer.addPass(new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 col = texture2D(tDiffuse, vUv); vec3 v = col.rgb; if (!(v.r == v.r) || abs(v.r) > 1.0e6) v.r = 0.0; if (!(v.g == v.g) || abs(v.g) > 1.0e6) v.g = 0.0; if (!(v.b == v.b) || abs(v.b) > 1.0e6) v.b = 0.0; gl_FragColor = vec4(v, col.a); }"
      }));
      const bloom = new UnrealBloomPass(new T.Vector2(game.W, game.H), 0.5, 0.65, 0.8);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      /* Step 3: soft vignette seats the battle in its frame (final grade). */
      if (admCfg.vignette !== false) composer.addPass(new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 col = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = smoothstep(0.92, 0.42, length(d) * 1.12); gl_FragColor = vec4(col.rgb * mix(0.80, 1.0, v), col.a); }"
      }));
      Render3D._bloom = bloom;
    } catch (e) { composer = null; Render3D._bloom = null; }
    Render3D._composer = composer;

    // Contact shadow blobs: soft dark ellipses that ground towers and props.
    {
      const mkBlob = (x, z, sx, sz, op) => {
        const m = new T.Mesh(new T.PlaneGeometry(sx, sz),
          new T.MeshBasicMaterial({ map: Render3D._glowTex, color: 0x000000,
            transparent: true, opacity: op, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.6, z);
        scene.add(m);
      };
      for (const side of ["p1", "p2"]) {
        const cx = game.tx(side) + game.TCOLS * game.BLOCK / 2;
        mkBlob(cx, 6, game.TCOLS * game.BLOCK + 90, 95, 0.42);
      }
      mkBlob(game.W * 0.32, -250, 130, 60, 0.3);
      mkBlob(game.W * 0.68, -250, 130, 60, 0.3);
      /* Step 3 (floor integration): towers stand on bolted base plates with a
       * brass front trim; the stage gets a front lip with brass brackets and
       * scorch decals - objects connect instead of floating (report gap 7). */
      if (admCfg.floor_detail !== false) {
        const plateMat = new T.MeshStandardMaterial({ color: 0x3a3444, roughness: 0.8, metalness: 0.35 });
        const brassMat = new T.MeshStandardMaterial({ color: 0x9a7433, roughness: 0.5, metalness: 0.5 });
        for (const side of ["p1", "p2"]) {
          const cx = game.tx(side) + game.TCOLS * game.BLOCK / 2;
          const plate = new T.Mesh(new T.BoxGeometry(game.TCOLS * game.BLOCK + 26, 5, 96), plateMat);
          plate.position.set(cx, 2.5, 0);
          scene.add(plate);
          const trim = new T.Mesh(new T.BoxGeometry(game.TCOLS * game.BLOCK + 26, 2, 4), brassMat);
          trim.position.set(cx, 4.5, 46);
          scene.add(trim);
          for (let b = 0; b < 4; b++) {
            const bolt = new T.Mesh(new T.BoxGeometry(6, 3, 6), brassMat);
            bolt.position.set(cx - (game.TCOLS * game.BLOCK) / 2 + 10 + b * ((game.TCOLS * game.BLOCK - 20) / 3), 5.5, 40);
            scene.add(bolt);
          }
        }
        const lip = new T.Mesh(new T.BoxGeometry(game.W + 40, 10, 6), plateMat);
        lip.position.set(game.W / 2, -5, 88);
        scene.add(lip);
        for (let i = 0; i < 8; i++) {
          const brk = new T.Mesh(new T.BoxGeometry(14, 12, 8), brassMat);
          brk.position.set(62.5 + i * 125, -3, 90);
          scene.add(brk);
        }
        mkBlob(game.W * 0.5 - 85, 24, 74, 40, 0.28);
        mkBlob(game.W * 0.5 + 95, 38, 58, 34, 0.24);
      }
    }

    Render3D._r = r; Render3D._scene = scene; Render3D._cam = cam;
    Render3D._frame = { n: 0, t: 0 }; Render3D._lowStreak = 0; Render3D._adapted = false;
    Render3D._game = game;
    Render3D._ready = true;
    return true;
  },

  /* draw(game) → false only when the renderer asks for a permanent fallback
   * (sustained low FPS at the lowest pixel ratio). Otherwise renders. */
  draw(game) {
    /* Keep the WebGL canvas glued to the 2D canvas every frame. It was only
     * re-measured on window "resize", so any later layout shift (viewport/
     * address-bar changes, rotation, fullscreen, content above the canvas)
     * left it misplaced or zero-sized: towers, obstacles and the 3D scene
     * vanished and only the 2D shots remained. */
    try {
      const h = Render3D._host, g = Render3D._gl;
      if (h && g && h.offsetWidth > 0) {
        const l = h.offsetLeft + "px", tp = h.offsetTop + "px", w = h.offsetWidth + "px", ht = h.offsetHeight + "px";
        if (g.style.left !== l) g.style.left = l;
        if (g.style.top !== tp) g.style.top = tp;
        if (g.style.width !== w) g.style.width = w;
        if (g.style.height !== ht) g.style.height = ht;
      }
    } catch (e) {}
    const T = Render3D._T, t0 = performance.now();
    const towers = (game.displayTowers || (game.snap && game.snap.towers));
    if (!towers) { if (Render3D._composer) Render3D._composer.render(); else Render3D._r.render(Render3D._scene, Render3D._cam); return true; }
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
      // Rubble stubs crown torn columns once the tower is damaged (step 2).
      // A column counts as torn when the snap's top row is gone there; a fully
      // destroyed column keeps a ground-level stub instead of vanishing.
      const rbs = Render3D._rubble && Render3D._rubble[side];
      if (rbs && rbs.length) {
        const hp = (game.displayHp && game.displayHp[side]) || (game.snap && game.snap.tower_hp && game.snap.tower_hp[side]);
        const damaged = hp && hp.hp < hp.max - 0.5;
        for (let c = 0; c < rbs.length; c++) {
          const torn = !!(tw && (!(tw[0] && tw[0][c]) || !tw.length));
          let topY = -1;
          for (let r = 0; r < grid.length; r++)
            if (grid[r] && grid[r][c] && grid[r][c].visible) topY = Math.max(topY, grid[r][c].position.y);
          rbs[c].visible = !!(damaged && torn);
          if (rbs[c].visible) rbs[c].position.y = topY > 0 ? topY + game.BLOCK / 2 + 1 : game.BLOCK / 2 - 4;
        }
      }
      // Cannon aim: my side follows the live aim, the other rests at 45°.
      const pivot = Render3D._cannons[side];
      const mine = side === game.mySide();
      const deg = mine ? (game.aimAngle ?? 45) : 45;
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
    /* Steam press obstacle (visual-only, option ב): frame + cyclic piston,
     * steam puffs at slam, pulsing warning lamp. Lazy-built once the snap's
     * obstacle is known; the server keeps owning the (invisible) hitbox. */
    const mdls = Render3D._models;
    if (!Render3D._press && mdls && mdls.bg && mdls.bg.pressFrame && mdls.bg.pressPiston) try {
      const ob0 = (game.obstacleNow ? game.obstacleNow() : null) || (game.snap && game.snap.obstacle);
      if (ob0) {
        const sc = Render3D._scene, cx = ob0.x + ob0.w / 2;
        const frame = mdls.bg.pressFrame.scene.clone(true);
        frame.position.set(cx, 0, 0); sc.add(frame);
        const piston = mdls.bg.pressPiston.scene.clone(true);
        // The press sinks below the ground line: clip everything under y=0 so only the part above ground shows.
        const clipPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
        for (const obj of [frame, piston]) obj.traverse(n => {
          if (!n.material) return;
          const mats = (Array.isArray(n.material) ? n.material : [n.material]).map(m => { const k = m.clone(); k.clippingPlanes = [clipPlane]; return k; });
          n.material = Array.isArray(n.material) ? mats : mats[0];
        });
        if (Render3D._r) Render3D._r.localClippingEnabled = true;
        piston.position.set(cx, 2, 0); sc.add(piston);
        const lamp = new T.Sprite(new T.SpriteMaterial({
          map: Render3D._glowTex, color: 0xffb35c, transparent: true, opacity: 0.3,
          blending: T.AdditiveBlending, depthWrite: false, fog: false }));
        lamp.scale.set(44, 44, 1); lamp.position.set(cx, 190, 14); sc.add(lamp);
        const puffs = [];
        for (const px of [-34, 0, 34]) {
          const sp = new T.Sprite(new T.SpriteMaterial({
            map: Render3D._glowTex, color: 0xcfd8e3, transparent: true, opacity: 0,
            blending: T.NormalBlending, depthWrite: false, fog: false }));
          sp.scale.set(26, 26, 1); sp.position.set(cx + px, 178, 8); sc.add(sp);
          puffs.push({ sp, life: 0, x: cx + px });
        }
        let rail = null;
        if (ob0.motion && ob0.motion.enabled && ob0.motion.max_x > ob0.motion.min_x) {
          rail = new T.Mesh(
            new T.BoxGeometry(ob0.motion.max_x - ob0.motion.min_x + 130, 5, 30),
            new T.MeshStandardMaterial({ color: 0x3d2f1c, roughness: 0.6, metalness: 0.4 }));
          rail.position.set((ob0.motion.min_x + ob0.motion.max_x) / 2 + ob0.w / 2, 2.5, 0);
          sc.add(rail);
        }
        Render3D._press = { frame, piston, lamp, puffs, rail, top: 89, bot: 2,
          period: 3600, t0: performance.now(), prevPhase: 0, offs: [-34, 0, 34] };
        // top: piston cycle is capped so the piston never rises past the 184-tall
        // collision silhouette (89 + 95 model height = 184).
      }
    } catch (e) { Render3D._pressErr = String(e); }
    const pr = Render3D._press;
    if (pr) {
      const obL = (game.obstacleNow ? game.obstacleNow() : null) || (game.snap && game.snap.obstacle);
      if (obL) {   // the press rides the server-owned hitbox (static or moving lane)
        const cx = obL.x + obL.w / 2;
        const lift = obL.lift || 0;   // server vertical raise/lower (0 = on ground)
        pr.frame.position.x = cx; pr.frame.position.y = lift;
        pr.piston.position.x = cx; pr.lamp.position.x = cx;
        pr.lamp.position.y = 190 + lift;
        for (let i = 0; i < pr.puffs.length; i++) {
          pr.puffs[i].sp.position.x = cx + pr.offs[i];
          pr.puffs[i].baseY = 178 + lift;
        }
        pr._lift = lift;
      }
      const nowMs = performance.now();
      const phase = ((nowMs - pr.t0) % pr.period) / pr.period;
      const span = pr.top - pr.bot;
      let y = pr.bot;
      if (phase < 0.35) {           // slow rise with ease-out (anticipation)
        const k = phase / 0.35; y = pr.bot + span * (1 - (1 - k) * (1 - k));
      } else if (phase < 0.55) {    // hold at top, lamp warns
        y = pr.top;
      } else if (phase < 0.63) {    // fast slam, accelerating
        const k = (phase - 0.55) / 0.08; y = pr.top - span * k * k;
      }                             // else rest at bottom
      pr.piston.position.y = y + (pr._lift || 0);
      const holding = phase >= 0.35 && phase < 0.55;
      const warn = obL && obL.warning;
      const vis = Math.max(0, Math.min(1, ((pr._lift || 0) + 60) / 60));   // lamp and steam fade out as the press sinks
      pr.lamp.material.opacity = ((holding || warn) ? 0.55 + 0.35 * Math.sin(nowMs / 85) : 0.22) * vis;
      if (pr.prevPhase < 0.63 && phase >= 0.63)   // slam landed → steam burst
        for (const p of pr.puffs) { p.life = (pr._lift || 0) > -30 ? 1 : 0; p.sp.position.y = p.baseY ?? 178; }
      pr.prevPhase = phase;
      const dt2 = Math.min(0.25, Render3D._bgT2 ? (nowMs - Render3D._bgT2) / 1000 : 0.016);
      for (const p of pr.puffs) {
        if (p.life > 0) {
          p.life = Math.max(0, p.life - dt2 / 1.1);
          p.sp.position.y += 42 * dt2;
          p.sp.material.opacity = 0.4 * p.life;
          const s = 26 * (1.7 - p.life * 0.7);
          p.sp.scale.set(s, s, 1);
        }
      }
      Render3D._bgT2 = nowMs;
    }
    if (Render3D._composer) Render3D._composer.render(); else Render3D._r.render(Render3D._scene, Render3D._cam);

    // Adaptive pixel ratio + fallback request (tunable floor).
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
          if (Render3D._bloom && Render3D._bloom.enabled !== false) {
            Render3D._bloom.enabled = false;   // bloom is the first luxury to go
          } else if (Render3D._pr > 0.5) {
            Render3D._pr = Math.max(0.5, Math.round(Render3D._pr * 0.75 * 100) / 100);
            Render3D._r.setPixelRatio(Render3D._pr);
          } else if (++Render3D._lowStreak >= 3) return false; // give up → 2D
        } else Render3D._lowStreak = 0;
      }
    }
    return true;
  },

  /* Match-level teardown: the scene graph goes, but the renderer, canvas,
   * THREE module and loaded models stay PARKED for the next match. Creating
   * a fresh WebGL context per match is what made every match after the first
   * composite black on some browsers (and burns the browser's context budget
   * on real devices). */
  dispose() {
    try {
      if (Render3D._syncBox) window.removeEventListener("resize", Render3D._syncBox);
      if (Render3D._gl && Render3D._gl.parentElement) Render3D._gl.parentElement.removeChild(Render3D._gl);
      if (Render3D._host) Render3D._host.classList.remove("gl3d");
    } catch (e) {}
    try { Render3D._composer && Render3D._composer.dispose && Render3D._composer.dispose(); } catch (e) {}
    try { Render3D._glowTex && Render3D._glowTex.dispose && Render3D._glowTex.dispose(); } catch (e) {}
    if (Render3D._models) Render3D._modelCache = Render3D._models;
    Render3D._glowTex = null;
    Render3D._host = null; Render3D._syncBox = null;
    Render3D._models = null; Render3D._bgMotion = null; Render3D._bgT = 0;
    Render3D._composer = null; Render3D._bloom = null;
    Render3D._scene = null; Render3D._cam = null;
    Render3D._game = null;
    Render3D._blocks = { p1: [], p2: [] }; Render3D._cannons = {};
    // The press belongs to the disposed scene: without this reset the next
    // match's guard (`!Render3D._press`) skips the rebuild and the obstacle
    // is invisible in 3D for every match after the first.
    Render3D._press = null;
    Render3D._ready = false;
  },

  /* Full teardown: drops the parked engine too (context lost, or the adaptive
   * path gave up on 3D for this device). The next init starts cold. */
  disposeFull() {
    try { Render3D.dispose(); } catch (e) {}
    try { Render3D._r && Render3D._r.dispose(); } catch (e) {}
    Render3D._r = null; Render3D._gl = null; Render3D._T = null;
    Render3D._modelCache = null;
  },
};
if (typeof window !== "undefined") window.Render3D = Render3D;
