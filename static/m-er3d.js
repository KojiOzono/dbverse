/* m-er3d.js — モバイル用 3D ER図（PC版 er3d.js の視覚品質を再現） */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const CARD_W    = 7.0;   // 8.4 → 7.0（PC版と同じ）
const TEX_W     = 768;
const HEADER_PX = 100;   // 140 → 100
const ROW_PX    = 44;    // 76  → 44
const PAD_PX    = 24;    // 32  → 24
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

// ─── 公開 API ─────────────────────────────
export function isReady() { return !!renderer; }

export async function init(canvas, schemaData, layoutData, clickCb) {
  canvasEl = canvas;
  schema = schemaData;
  layout = layoutData;
  onTableClick = clickCb;

  if (renderer) {
    // 既に初期化済みならスキーマだけ更新
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

  // ライト
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

  // 床ディスク
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(240, 64),
    new THREE.MeshBasicMaterial({
      color: 0x061426, transparent: true, opacity: 0.15, depthWrite: false,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.02;
  scene.add(disc);

  // 星（PC版は1500、モバイルは800に削減）
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
    size: 0.7, vertexColors: true, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })));

  erGroup = new THREE.Group();
  scene.add(erGroup);

  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();
  pointer = new THREE.Vector2();

  // Bloom
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(w, h), 0.5, 0.5, 0.85
  ));

  // インタラクション
  const dom = renderer.domElement;
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('click', onClick);

  // 初期ビルド
  rebuild();

  // アニメーション開始
  animate();

  // フィット
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
  // シーン破棄
  if (erGroup) {
    while (erGroup.children.length) disposeObj(erGroup.children.pop());
  }
  cards = []; fkLines = [];
  // renderer等は残す（再度initされたい時はリロード）
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
      // 常時表示：visible=false は付けない
      erGroup.add(tube);

      const dots = [];
      const dg = new THREE.SphereGeometry(0.13, 8, 8);
      for (let k = 0; k < 3; k++) {
        const d = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({
          color: 0xc9a0ff, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        // 常時表示：visible=false は付けない
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

  // ヘッダ左のアクセントバー
  g.fillStyle = '#4de8ff';
  g.fillRect(30, 30, 10, 76);

  // テーブル名
  g.fillStyle = '#eaf6ff';
  g.font = '56px "SF Mono","Courier New",monospace';
  g.textBaseline = 'middle';
  g.fillText(truncate(shortenName(t.name), 18), 60, 62);

  // メタ情報 ← 右寄せ・同じ行・白
  g.fillStyle = '#eaf6ff';
  g.font = '26px "SF Mono","Courier New",monospace';
  g.textAlign = 'right';
  g.fillText(t.rows + ' rows · ' + t.columns.length + ' cols', TEX_W - 30, 62);
  g.textAlign = 'left';
  // ヘッダ下線
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

    // アイコン（28 → 40）
    g.fillStyle = iconColor;
    g.font = '40px "SF Mono","Courier New",monospace';
    g.fillText(icon, 34, y);

    // カラム名（22 → 44）
    g.fillStyle = isPK ? '#ffd166' : (isFK ? '#c9a0ff' : '#eaf6ff');
    g.font = (isPK ? '' : '') + '44px "SF Mono","Courier New",monospace';
    g.fillText(truncate(c.name, 20), 92, y);

    // NOT NULL アスタリスク（20 → 30）
    if (c.notnull && !isPK) {
      g.fillStyle = '#ff8ba0';
      g.font = '30px "SF Mono","Courier New",monospace';
      g.fillText('*', TEX_W - 250, y - 8);
    }

    // 型名（22 → 30）
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

    // 関連カードの rel を更新
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

    // FK線の表示制御：非ホバー時は全表示、ホバー時は関連のみ
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
    // 常時更新（曲線スタイルはそのまま）
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