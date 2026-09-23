/* m-er3d.js — モバイル用 3D ER図（PC版 er3d.js の視覚品質を再現） */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const CARD_W    = 7.0;
const TEX_W     = 768;
const HEADER_PX = 100;
const ROW_PX    = 44;
const PAD_PX    = 24;
const SCALE_2D_TO_3D = 1 / 30;

// ─── 内部状態 ─────────────────────────────
let renderer = null, scene = null, camera = null;
let controls = null, composer = null, clock = null;
let erGroup = null, raycaster = null, pointer = null;
let cards = [], fkLines = [];
let animateId = null;
let canvasEl = null;
let schema = null, layout = null;
let onTableClick = null;
let hoveredCard = null;

// ─── 宇宙装飾 ───
let nebulaGroup   = null;
let pulsarPoints  = null;
let pulsarColAttr = null;
let pulsarData    = [];
let meteors       = [];
let meteorTimer   = 3;
let starTexture   = null;

// ─── ユーティリティ ─────────────────────────
function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function shortenName(name) {
  const i = name.indexOf('_');
  return i >= 0 ? name.slice(i + 1) : name;
}
function shortType(t) {
  t = String(t).toUpperCase();
  if (t.startsWith('CHARACTER VARYING')) return 'VARCHAR';
  if (t.startsWith('TIMESTAMP')) return 'TS';
  if (t.startsWith('DOUBLE')) return 'DBL';
  if (t.startsWith('BIGINT')) return 'BIGINT';
  if (t.startsWith('INTEGER')) return 'INT';
  if (t.startsWith('BOOLEAN')) return 'BOOL';
  return t;
}

// ─── 丸い光テクスチャ ───
function makeStarTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.00, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  grad.addColorStop(0.85, 'rgba(255,255,255,0.04)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ─── ノイズ（fBm）生成 ───
function makeNoise(seed) {
  const rnd = (() => {
    let s = seed * 9301 + 49297;
    return () => (s = (s * 9301 + 49297) % 233280) / 233280;
  })();
  const G = 16;
  const grid = [];
  for (let i = 0; i <= G; i++) {
    grid[i] = [];
    for (let j = 0; j <= G; j++) grid[i][j] = rnd();
  }
  const smooth = t => t * t * (3 - 2 * t);
  const sample = (x, y, freq) => {
    const fx = (((x * freq) % G) + G) % G;
    const fy = (((y * freq) % G) + G) % G;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = (x0 + 1) % G,  y1 = (y0 + 1) % G;
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const a = grid[x0][y0], b = grid[x1][y0];
    const c = grid[x0][y1], d = grid[x1][y1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
  return (x, y) => {
    let v = 0, amp = 0.5, f = 1.5;
    for (let o = 0; o < 5; o++) {
      v += sample(x, y, f) * amp;
      amp *= 0.5; f *= 2;
    }
    return v;
  };
}

// ─── 雲状の星雲テクスチャ ───
// モバイル負荷軽減のため 128px（スプライトで拡大されるので十分滑らか）
const NEBULA_TEX_SIZE = 128;
function makeNebulaTexture(seed = 1) {
  const S = NEBULA_TEX_SIZE;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  const fbm  = makeNoise(seed);
  const warp = makeNoise(seed + 17);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      // ドメインワープでうねりを出す
      const wx = u + (warp(u, v) - 0.5) * 0.35;
      const wy = v + (warp(v, u) - 0.5) * 0.35;
      let n = fbm(wx, wy);
      // 中心からの距離で縁を自然に消す
      const dx = u - 0.5, dy = v - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const edge = Math.max(0, 1 - r);
      const edge2 = edge * edge * (3 - 2 * edge);
      // 濃淡を強調（しきい値でちぎれ感）
      n = Math.max(0, (n - 0.35) * 2.2);
      const a = Math.min(1, n * edge2);
      const i = (y * S + x) * 4;
      img.data[i]     = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function setupSpaceFX() {
  starTexture = makeStarTexture();

  // ─── 星雲（複数レイヤーの雲を重ねる） ───
  const nebCenters = [
    { x: -120, y:  50, z: -140, size: 260, cols: [0xa06bff, 0x4de8ff] },
    { x:  130, y:  40, z:  120, size: 240, cols: [0xff6b8b, 0xa06bff] },
    { x:   60, y: -20, z: -180, size: 220, cols: [0x4de8ff, 0x7dff9b] },
    { x: -150, y:  80, z:  110, size: 250, cols: [0x66ddff, 0xa06bff] },
  ];
  const LAYERS = 4;
  nebulaGroup = new THREE.Group();
  nebCenters.forEach((d, ci) => {
    for (let k = 0; k < LAYERS; k++) {
      const tex = makeNebulaTexture(ci * 10 + k + 1);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: d.cols[k % d.cols.length],
        transparent: true,
        opacity: 0.16 + Math.random() * 0.1,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        rotation: Math.random() * Math.PI * 2,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(
        d.x + (Math.random() - 0.5) * 70,
        d.y + (Math.random() - 0.5) * 40,
        d.z + (Math.random() - 0.5) * 70
      );
      const s = d.size * (0.6 + Math.random() * 0.6);
      sp.scale.set(s, s * (0.6 + Math.random() * 0.4), 1);
      nebulaGroup.add(sp);
    }
  });
  scene.add(nebulaGroup);

  // ─── パルサー ───
  const PN = 36;
  const ppos = new Float32Array(PN * 3);
  const pcol = new Float32Array(PN * 3);
  pulsarData = [];
  for (let i = 0; i < PN; i++) {
    const r = 160 + Math.random() * 260;
    const a = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    ppos[i * 3]     = Math.sin(ph) * Math.cos(a) * r;
    ppos[i * 3 + 1] = Math.cos(ph) * r * 0.6 + 30;
    ppos[i * 3 + 2] = Math.sin(ph) * Math.sin(a) * r;
    const base = new THREE.Color().setHSL(
      0.5 + Math.random() * 0.12, 0.85, 0.7);
    pulsarData.push({
      freq:  0.35 + Math.random() * 0.85,
      phase: Math.random() * Math.PI * 2,
      base,
    });
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  pulsarColAttr = new THREE.BufferAttribute(pcol, 3);
  pulsarColAttr.setUsage(THREE.DynamicDrawUsage);
  pg.setAttribute('color', pulsarColAttr);
  pulsarPoints = new THREE.Points(pg, new THREE.PointsMaterial({
    size: 2.4,
    map: starTexture,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  }));
  scene.add(pulsarPoints);

  // ─── 流れ星 ───
  const METEOR_N = 3;
  const mg = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true);
  mg.translate(0, 0.5, 0);
  meteors = [];
  for (let i = 0; i < METEOR_N; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xddeeff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(mg, mat);
    mesh.visible = false;
    scene.add(mesh);
    meteors.push({
      mesh, mat,
      active: false,
      life: 0, maxLife: 0,
      speed: 0, length: 0,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, 1),
    });
  }
  meteorTimer = 3;
}

function spawnMeteor(m) {
  const a = Math.random() * Math.PI * 2;
  const R = 240 + Math.random() * 100;
  const h = 60 + Math.random() * 120;
  m.pos.set(Math.cos(a) * R, h, Math.sin(a) * R);

  const opp = a + Math.PI + (Math.random() - 0.5) * 0.6;
  const endH = h - 80 - Math.random() * 60;
  const ex = Math.cos(opp) * R;
  const ez = Math.sin(opp) * R;
  m.dir.set(ex - m.pos.x, endH - m.pos.y, ez - m.pos.z).normalize();

  m.speed   = 120 + Math.random() * 100;
  m.length  = 22 + Math.random() * 30;
  m.maxLife = 2.0 + Math.random() * 1.4;
  m.life    = 0;
  m.active  = true;

  const tint = Math.random();
  if (tint < 0.6)      m.mat.color.setHex(0xddeeff);
  else if (tint < 0.8) m.mat.color.setHex(0xddaaff);
  else                 m.mat.color.setHex(0xaaffdd);

  m.mesh.visible = true;
  m.mesh.position.copy(m.pos);
  m.mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), m.dir);
  m.mesh.scale.set(1, m.length, 1);
  m.mat.opacity = 0;
}

function updateSpaceFX(dt, t) {
  // 星雲をゆっくり回転
  if (nebulaGroup) {
    nebulaGroup.children.forEach((sp, i) => {
      sp.material.rotation += dt * 0.004 * (i % 2 ? 1 : -1);
    });
  }

  if (pulsarColAttr) {
    const arr = pulsarColAttr.array;
    for (let i = 0; i < pulsarData.length; i++) {
      const p = pulsarData[i];
      const s = 0.5 + 0.5 * Math.sin(t * p.freq * Math.PI * 2 + p.phase);
      const v = s * s * s;
      const k = 0.25 + v * 0.75;
      const c = p.base;
      arr[i * 3]     = c.r * k;
      arr[i * 3 + 1] = c.g * k;
      arr[i * 3 + 2] = c.b * k;
    }
    pulsarColAttr.needsUpdate = true;
  }

  meteorTimer -= dt;
  if (meteorTimer <= 0) {
    const slot = meteors.find(x => !x.active);
    if (slot) spawnMeteor(slot);
    meteorTimer = 4 + Math.random() * 10;
  }
  meteors.forEach(m => {
    if (!m.active) return;
    m.life += dt;
    if (m.life >= m.maxLife) {
      m.active = false;
      m.mesh.visible = false;
      m.mat.opacity = 0;
      return;
    }
    m.pos.addScaledVector(m.dir, m.speed * dt);
    m.mesh.position.copy(m.pos);
    const p = m.life / m.maxLife;
    m.mat.opacity = Math.sin(p * Math.PI) * 0.9;
  });
}

// ─── 公開 API ─────────────────────────────
export function isReady() { return !!renderer; }

export async function init(canvas, schemaData, layoutData, clickCb) {
  canvasEl = canvas;
  schema = schemaData;
  layout = layoutData;
  onTableClick = clickCb;

  if (renderer) {
    rebuild();
    resize();
    return;
  }

  const w = canvasEl.clientWidth || 320;
  const h = canvasEl.clientHeight || 400;

  renderer = new THREE.WebGLRenderer({
    canvas: canvasEl, antialias: true, powerPreference: 'high-performance',
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x03050d, 0.004);

  camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 2000);
  camera.position.set(0, 80, 0.01);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.85;
  controls.panSpeed = 0.7;
  controls.minDistance = 3;
  controls.maxDistance = 800;
  controls.maxPolarAngle = Math.PI * 0.72;
  controls.target.set(0, 4, 0);
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  scene.add(new THREE.AmbientLight(0x2a4060, 0.9));
  scene.add(new THREE.HemisphereLight(0x2e6aff, 0x05060f, 0.5));
  const key = new THREE.DirectionalLight(0x88c8ff, 0.7);
  key.position.set(20, 40, 25);
  scene.add(key);
  const rim = new THREE.PointLight(0x00ddff, 1.2, 400, 2);
  rim.position.set(-35, 15, -35);
  scene.add(rim);
  const rim2 = new THREE.PointLight(0xa06bff, 0.9, 400, 2);
  rim2.position.set(40, 10, 30);
  scene.add(rim2);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(240, 64),
    new THREE.MeshBasicMaterial({
      color: 0x061426, transparent: true, opacity: 0.15, depthWrite: false,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.02;
  scene.add(disc);

  starTexture = makeStarTexture();

  const N = 800;
  const sg = new THREE.BufferGeometry();
  const pp = new Float32Array(N * 3);
  const cc = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 260 + Math.random() * 300;
    const a = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pp[i * 3]     = Math.sin(ph) * Math.cos(a) * r;
    pp[i * 3 + 1] = Math.cos(ph) * r * 0.6 + 30;
    pp[i * 3 + 2] = Math.sin(ph) * Math.sin(a) * r;
    const col = new THREE.Color().setHSL(0.55 + Math.random() * 0.12, 0.7,
                                          0.5 + Math.random() * 0.4);
    cc[i * 3] = col.r; cc[i * 3 + 1] = col.g; cc[i * 3 + 2] = col.b;
  }
  sg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  sg.setAttribute('color',    new THREE.BufferAttribute(cc, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
    size: 1.4,
    map: starTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  })));

  setupSpaceFX();

  erGroup = new THREE.Group();
  scene.add(erGroup);

  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();
  pointer = new THREE.Vector2();

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(w, h), 0.5, 0.5, 0.85
  ));

  const dom = renderer.domElement;
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('click', onClick);

  rebuild();
  animate();

  setTimeout(() => {
    resize();
    const c = fitPosition();
    camera.position.copy(c.pos);
    controls.target.copy(c.target);
    controls.update();
  }, 80);
}

export function resize() {
  if (!renderer || !canvasEl) return;
  const w = canvasEl.clientWidth;
  const h = canvasEl.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
}

export function fitPosition() {
  if (!cards.length) {
    return {
      pos: new THREE.Vector3(30, 50, 70),
      target: new THREE.Vector3(0, 4, 0),
    };
  }
  const bbox = new THREE.Box3();
  cards.forEach(c => {
    const half = new THREE.Vector3(c.W / 2, c.H / 2, c.H / 2);
    bbox.expandByPoint(c.group.position.clone().sub(half));
    bbox.expandByPoint(c.group.position.clone().add(half));
  });
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const diag = Math.max(size.x, size.z, size.y * 1.2);

  const fov = 55 * Math.PI / 180;
  const dist = Math.max(diag / (2 * Math.tan(fov / 2)) * 0.85, 15);

  const angle = 35 * Math.PI / 180;
  const dir = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)).normalize();

  const targetY = center.y + size.y * 1.2;
  const target = new THREE.Vector3(center.x, targetY, center.z);

  return {
    pos: target.clone().addScaledVector(dir, dist),
    target,
  };
}

export function doFit(ms = 500) {
  const c = fitPosition();
  tweenCamera(c.pos, c.target, ms);
}

export function dispose() {
  if (animateId) cancelAnimationFrame(animateId);
  animateId = null;
  if (erGroup) {
    while (erGroup.children.length) disposeObj(erGroup.children.pop());
  }
  cards = []; fkLines = [];
}

// ─── 内部：ビルド ─────────────────────────
function rebuild() {
  if (!erGroup || !schema) return;
  while (erGroup.children.length) disposeObj(erGroup.children.pop());
  cards = []; fkLines = [];

  const tables = schema.tables;
  const n = tables.length;
  if (!n) return;

  tables.forEach(t => { t._size = cardSize(t); });

  const posMap = {};
  const positions = (layout && layout.positions) ? layout.positions : {};
  const w = (layout && layout.width) || 800;
  const h = (layout && layout.height) || 600;
  const cx = w / 2;
  const cy = h / 2;

  tables.forEach(t => {
    const p = positions[t.name];
    if (p) {
      t._pos = new THREE.Vector3(
        (p.x - cx) * SCALE_2D_TO_3D,
        2.0,
        (p.y - cy) * SCALE_2D_TO_3D
      );
    } else {
      t._pos = new THREE.Vector3(0, 2.0, 0);
    }
    posMap[t.name] = t._pos;
  });

  tables.forEach(t => {
    const c = makeCard(t);
    c.group.position.copy(t._pos);
    erGroup.add(c.group);
    cards.push(c);
  });

  tables.forEach(t => {
    t.fks.forEach(fk => {
      const src = posMap[t.name], dst = posMap[fk.to_table];
      if (!src || !dst) return;
      if (t.name === fk.to_table) return;
      const dstT = tables.find(x => x.name === fk.to_table);
      if (!dstT) return;

      const p0 = new THREE.Vector3(src.x, src.y, src.z);
      const p3 = new THREE.Vector3(dst.x, dst.y, dst.z);
      const p1 = new THREE.Vector3().lerpVectors(p0, p3, 0.3);
      const p2 = new THREE.Vector3().lerpVectors(p0, p3, 0.7);
      const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);

      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 40, 0.06, 6, false),
        new THREE.MeshBasicMaterial({
          color: 0xa06bff, transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      erGroup.add(tube);

      const dots = [];
      const dg = new THREE.SphereGeometry(0.13, 8, 8);
      for (let k = 0; k < 3; k++) {
        const d = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({
          color: 0xc9a0ff, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        erGroup.add(d);
        dots.push(d);
      }

      fkLines.push({
        curve, mesh: tube, dots, phase: Math.random(),
        from: t.name, to: fk.to_table,
        fromCol: fk.from_col, toCol: fk.to_col,
        fromTable: t, toTable: dstT,
      });
    });
  });
}

function disposeObj(o) {
  o.traverse(x => {
    if (x.geometry) x.geometry.dispose();
    if (x.material) {
      if (Array.isArray(x.material)) {
        x.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      } else {
        if (x.material.map) x.material.map.dispose();
        x.material.dispose();
      }
    }
  });
}

function cardSize(t) {
  const texH = HEADER_PX + t.columns.length * ROW_PX + PAD_PX;
  const H = CARD_W * texH / TEX_W;
  return { W: CARD_W, H, texH };
}

function columnLocalY(table, colName) {
  const idx = table.columns.findIndex(c => c.name === colName);
  if (idx < 0) return 0;
  const sz = table._size || cardSize(table);
  const worldPerPx = CARD_W / TEX_W;
  const yFromTop = (HEADER_PX + ROW_PX * (idx + 0.5)) * worldPerPx;
  return sz.H / 2 - yFromTop;
}

function makeCard(t) {
  const group = new THREE.Group();
  const sz = cardSize(t);
  const tex = makeTexture(t, sz.texH);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(sz.W, sz.H),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: true,
      side: THREE.DoubleSide,
    })
  );
  plane.userData.pickable = true;
  plane.userData.tableName = t.name;
  group.add(plane);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(sz.W * 0.55, sz.W * 0.58, 64),
    new THREE.MeshBasicMaterial({
      color: 0x4de8ff, side: THREE.DoubleSide, transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -sz.H / 2 - 0.6;
  group.add(ring);

  return {
    name: t.name, table: t, group, plane, ring,
    baseY: t._pos.y, hover: 0, hoverTarget: 0,
    rel: 0, relTarget: 0, fade: 1, fadeTarget: 1,
    W: sz.W, H: sz.H,
  };
}

function makeTexture(t, texH) {
  const cv = document.createElement('canvas');
  const TEX_DPR = 2;
  cv.width  = Math.round(TEX_W * TEX_DPR);
  cv.height = Math.round(texH * TEX_DPR);
  const g = cv.getContext('2d');
  g.scale(TEX_DPR, TEX_DPR);

  g.fillStyle = 'rgba(6,17,32,0.98)';
  g.fillRect(0, 0, TEX_W, texH);

  const grad = g.createLinearGradient(0, 0, 0, HEADER_PX);
  grad.addColorStop(0, 'rgba(77,232,255,0.35)');
  grad.addColorStop(1, 'rgba(77,232,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, TEX_W, HEADER_PX);

  g.strokeStyle = 'rgba(77,232,255,0.85)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, TEX_W - 3, texH - 3);

  g.fillStyle = '#4de8ff';
  g.fillRect(30, 30, 10, 76);

  g.fillStyle = '#eaf6ff';
  g.font = '56px "SF Mono","Courier New",monospace';
  g.textBaseline = 'middle';
  g.fillText(truncate(shortenName(t.name), 18), 60, 62);

  g.fillStyle = '#eaf6ff';
  g.font = '26px "SF Mono","Courier New",monospace';
  g.textAlign = 'right';
  const rowsStr = (t.rows == null) ? '—' : t.rows;
  g.fillText(rowsStr + ' rows · ' + t.columns.length + ' cols', TEX_W - 30, 62);
  g.textAlign = 'left';

  g.strokeStyle = 'rgba(77,232,255,0.3)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(16, HEADER_PX);
  g.lineTo(TEX_W - 16, HEADER_PX);
  g.stroke();

  const fkMap = {};
  t.fks.forEach(fk => { fkMap[fk.from_col] = fk; });

  let y = HEADER_PX + ROW_PX / 2;
  t.columns.forEach(c => {
    const isPK = c.pk;
    const fk = fkMap[c.name];
    const isFK = !!fk;

    let icon = '◆', iconColor = '#4de8ff';
    if (isPK)      { icon = '★'; iconColor = '#ffd166'; }
    else if (isFK) { icon = '↗'; iconColor = '#a06bff'; }

    if (isFK) {
      g.fillStyle = 'rgba(160,107,255,0.14)';
      g.fillRect(0, y - ROW_PX / 2 + 4, TEX_W, ROW_PX - 8);
    }

    g.fillStyle = iconColor;
    g.font = '40px "SF Mono","Courier New",monospace';
    g.fillText(icon, 34, y);

    g.fillStyle = isPK ? '#ffd166' : (isFK ? '#c9a0ff' : '#eaf6ff');
    g.font = '44px "SF Mono","Courier New",monospace';
    g.fillText(truncate(c.name, 20), 92, y);

    if (c.notnull && !isPK) {
      g.fillStyle = '#ff8ba0';
      g.font = '30px "SF Mono","Courier New",monospace';
      g.fillText('*', TEX_W - 250, y - 8);
    }

    g.fillStyle = '#95b8cc';
    g.font = '30px "SF Mono","Courier New",monospace';
    g.textAlign = 'right';
    g.fillText(c.type, TEX_W - 34, y);
    g.textAlign = 'left';

    y += ROW_PX;
  });

  const tex = new THREE.CanvasTexture(cv);
  if (renderer && renderer.capabilities) {
    tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  }
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}


// ─── カメラ tween ─────────────────────────
function ease(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
function tweenCamera(toPos, toTarget, ms) {
  const fromPos = camera.position.clone();
  const fromTgt = controls.target.clone();
  const t0 = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const k = ease(t);
    camera.position.lerpVectors(fromPos, toPos, k);
    controls.target.lerpVectors(fromTgt, toTarget, k);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ─── インタラクション ─────────────────────
let pointerDownPos = null;

function onPointerMove(e) {
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cards.map(c => c.plane), false);
  const n = hits.length ? hits[0].object.userData.tableName : null;

  if (n !== hoveredCard) {
    hoveredCard = n;
    cards.forEach(c => { c.hoverTarget = c.name === n ? 1 : 0; });

    const related = new Set();
    if (n && schema) {
      schema.tables.forEach(t => {
        t.fks.forEach(fk => {
          if (t.name === n) related.add(fk.to_table);
          if (fk.to_table === n) related.add(t.name);
        });
      });
    }
    cards.forEach(c => { c.relTarget = related.has(c.name) ? 1 : 0; });

    fkLines.forEach(b => {
      const show = !n || (b.from === n || b.to === n);
      b.mesh.visible = show;
      b.dots.forEach(d => { d.visible = show; });
    });
  }
  canvasEl.style.cursor = hits.length ? 'pointer' : 'grab';
}

function onPointerDown(e) {
  pointerDownPos = { x: e.clientX, y: e.clientY };
}

function onClick(e) {
  if (!pointerDownPos) return;
  const dx = Math.abs(e.clientX - pointerDownPos.x);
  const dy = Math.abs(e.clientY - pointerDownPos.y);
  pointerDownPos = null;
  if (dx > 8 || dy > 8) return;

  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cards.map(c => c.plane), false);
  if (hits.length) {
    const name = hits[0].object.userData.tableName;
    if (name && onTableClick) onTableClick(name);
  }
}

// ─── アニメーション ─────────────────────
function animate() {
  animateId = requestAnimationFrame(animate);
  if (!renderer) return;

  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateSpaceFX(dt, t);

  cards.forEach(c => {
    c.plane.quaternion.copy(camera.quaternion);
    c.hover = THREE.MathUtils.lerp(c.hover, c.hoverTarget || 0, dt * 8);
    c.rel   = THREE.MathUtils.lerp(c.rel,   c.relTarget   || 0, dt * 6);
    c.fade  = THREE.MathUtils.lerp(c.fade,
      c.fadeTarget !== undefined ? c.fadeTarget : 1, dt * 5);

    const lift = c.hover * 0.8 + Math.sin(t * 1.3 + c.group.position.x) * 0.05;
    c.group.position.y = c.baseY + lift;

    const baseOp = (c.hover > 0.05 || c.rel > 0.05) ? 1 : 0.95;
    c.plane.material.opacity = c.fade * baseOp;
    c.ring.material.opacity = (c.hover * 0.4 + c.rel * 0.15) * c.fade;
    const rs = 1 + c.hover * 0.08 + c.rel * 0.03;
    c.ring.scale.set(rs, rs, rs);
  });

  fkLines.forEach(b => {
    const srcCard = cards.find(c => c.name === b.from);
    const dstCard = cards.find(c => c.name === b.to);
    if (!srcCard || !dstCard) return;

    const srcLocalY = columnLocalY(b.fromTable, b.fromCol);
    const dstLocalY = columnLocalY(b.toTable, b.toCol);

    const p0 = new THREE.Vector3(0, srcLocalY, 0)
      .applyQuaternion(srcCard.plane.quaternion)
      .add(srcCard.group.position);
    const p3 = new THREE.Vector3(0, dstLocalY, 0)
      .applyQuaternion(dstCard.plane.quaternion)
      .add(dstCard.group.position);

    const dx = p3.x - p0.x, dz = p3.z - p0.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const perpX = -dz / dist, perpZ = dx / dist;
    const bend = Math.min(dist * 0.18, 8);
    const midY = Math.max(p0.y, p3.y) + 1.5;

    const p1 = new THREE.Vector3(
      p0.x + dx * 0.30 + perpX * bend, midY, p0.z + dz * 0.30 + perpZ * bend);
    const p2 = new THREE.Vector3(
      p0.x + dx * 0.70 + perpX * bend, midY, p0.z + dz * 0.70 + perpZ * bend);

    b.curve.points[0].copy(p0);
    b.curve.points[1].copy(p1);
    b.curve.points[2].copy(p2);
    b.curve.points[3].copy(p3);

    b.mesh.geometry.dispose();
    b.mesh.geometry = new THREE.TubeGeometry(b.curve, 40, 0.06, 6, false);

    b.phase += dt * 0.25;
    b.dots.forEach((d, i) => {
      const u = (b.phase + i / b.dots.length) % 1;
      d.position.copy(b.curve.getPoint(u));
      d.scale.setScalar(0.7 + Math.sin(u * Math.PI) * 0.7);
      d.material.opacity = 0.3 + Math.sin(u * Math.PI) * 0.7;
    });
  });

  controls.update();
  composer.render();
}