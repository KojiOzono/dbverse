// er3d.js — Three.js 3D ER図
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { state, er2d, truncate, api, shortenName } from './main.js';

const CARD_W    = 7.0;
const TEX_W     = 768;
const HEADER_PX = 100;
const ROW_PX    = 44;
const PAD_PX    = 24;

const SCALE_2D_TO_3D = 1 / 30;

/* ═══════════ SETUP ═══════════ */
export function setupThree() {
  const canvas = document.getElementById('c');
  state.renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', alpha: true,
  });
  state.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  state.renderer.setSize(innerWidth, innerHeight);
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1.1;

  state.scene = new THREE.Scene();
  state.scene.fog = new THREE.FogExp2(0x03050d, 0.004);
  state.camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 2000);
  state.camera.position.set(0, 80, 0.01);

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.09;
  state.controls.rotateSpeed = 0.5;
  state.controls.zoomSpeed = 0.85;
  state.controls.panSpeed = 0.7;
  state.controls.minDistance = 3;
  state.controls.maxDistance = 800;
  state.controls.maxPolarAngle = Math.PI * 0.72;
  state.controls.target.set(0, 4, 0);

  state.scene.add(new THREE.AmbientLight(0x2a4060, 0.9));
  state.scene.add(new THREE.HemisphereLight(0x2e6aff, 0x05060f, 0.5));
  const key = new THREE.DirectionalLight(0x88c8ff, 0.7);
  key.position.set(20, 40, 25); state.scene.add(key);
  const rim = new THREE.PointLight(0x00ddff, 1.2, 400, 2);
  rim.position.set(-35, 15, -35); state.scene.add(rim);
  const rim2 = new THREE.PointLight(0xa06bff, 0.9, 400, 2);
  rim2.position.set(40, 10, 30); state.scene.add(rim2);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(240, 64),
    new THREE.MeshBasicMaterial({color: 0x061426, transparent: true,
      opacity: 0.15, depthWrite: false}));
  disc.rotation.x = -Math.PI/2; disc.position.y = -0.02;
  state.scene.add(disc);

  const N = 1500;
  const sg = new THREE.BufferGeometry();
  const pp = new Float32Array(N*3), cc = new Float32Array(N*3);
  for (let i = 0; i < N; i++) {
    const r = 260 + Math.random()*300;
    const a = Math.random()*Math.PI*2;
    const ph = Math.acos(2*Math.random()-1);
    pp[i*3]   = Math.sin(ph)*Math.cos(a)*r;
    pp[i*3+1] = Math.cos(ph)*r*0.6 + 30;
    pp[i*3+2] = Math.sin(ph)*Math.sin(a)*r;
    const col = new THREE.Color().setHSL(0.55+Math.random()*0.12, 0.7,
                                         0.5+Math.random()*0.4);
    cc[i*3]=col.r; cc[i*3+1]=col.g; cc[i*3+2]=col.b;
  }
  sg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  sg.setAttribute('color',    new THREE.BufferAttribute(cc, 3));
  state.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
    size: 0.7, vertexColors: true, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending})));

  state.erGroup = new THREE.Group(); state.scene.add(state.erGroup);
  state.raycaster = new THREE.Raycaster();
  state.clock = new THREE.Clock();
  state.pointer = new THREE.Vector2();

  state.composer = new EffectComposer(state.renderer);
  state.composer.addPass(new RenderPass(state.scene, state.camera));
  state.composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.5, 0.85));

  addEventListener('resize', () => {
    state.camera.aspect = innerWidth/innerHeight;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(innerWidth, innerHeight);
    state.composer.setSize(innerWidth, innerHeight);
  });

  const dom = state.renderer.domElement;
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('click', onClick);
  dom.addEventListener('dblclick', onDblClick);
}

/* ═══════════ BUILD ER ═══════════ */
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

function clearER() {
  while (state.erGroup.children.length) disposeObj(state.erGroup.children.pop());
  state.erCards = []; state.fkLines = [];
}

function cardSize(t) {
  const texH = HEADER_PX + t.columns.length * ROW_PX + PAD_PX;
  const H = CARD_W * texH / TEX_W;
  return {W: CARD_W, H, texH};
}

/* ─── 列のカード内ローカルY座標（中心基準） ─── */
function columnLocalY(table, colName) {
  const idx = table.columns.findIndex(c => c.name === colName);
  if (idx < 0) return 0;
  const sz = table._size || cardSize(table);
  const worldPerPx = CARD_W / TEX_W;
  const yFromTop = (HEADER_PX + ROW_PX * (idx + 0.5)) * worldPerPx;
  return sz.H / 2 - yFromTop;
}

export function buildER() {
  clearER();
  const n = state.schema.tables.length;
  if (!n) return;

  state.schema.tables.forEach(t => {
    t._size = cardSize(t);
  });

  const posMap = {};
  if (state.layout2d && state.layout2d.positions) {
    const cx = state.layout2d.width  / 2;
    const cy = state.layout2d.height / 2;
    state.schema.tables.forEach(t => {
      const p = state.layout2d.positions[t.name];
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
  } else {
    state.schema.tables.forEach(t => {
      t._pos = new THREE.Vector3(0, 2.0, 0);
      posMap[t.name] = t._pos;
    });
  }

  state.schema.tables.forEach(t => {
    const c = makeERCard(t);
    c.group.position.copy(t._pos);
    state.erGroup.add(c.group);
    state.erCards.push(c);
  });

  state.schema.tables.forEach(t => {
    t.fks.forEach(fk => {
      const src = posMap[t.name], dst = posMap[fk.to_table];
      if (!src || !dst) return;
      if (t.name === fk.to_table) return;

      const dstT = state.schema.tables.find(x => x.name === fk.to_table);
      if (!dstT) return;

      // 仮の曲線（animate で毎フレーム更新される）
      const p0 = new THREE.Vector3(src.x, src.y, src.z);
      const p3 = new THREE.Vector3(dst.x, dst.y, dst.z);
      const p1 = new THREE.Vector3().lerpVectors(p0, p3, 0.3);
      const p2 = new THREE.Vector3().lerpVectors(p0, p3, 0.7);
      const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);

      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 40, 0.06, 6, false),
        new THREE.MeshBasicMaterial({
          color: 0xa06bff, transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false}));
      // 常時表示：visible=false は付けない
      state.erGroup.add(tube);

      const dots = [];
      const dg = new THREE.SphereGeometry(0.13, 8, 8);
      for (let k = 0; k < 3; k++) {
        const d = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({
          color: 0xc9a0ff, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false}));
        // 常時表示：visible=false は付けない
        state.erGroup.add(d); dots.push(d);
      }

      state.fkLines.push({
        curve, mesh: tube, dots, phase: Math.random(),
        from: t.name, to: fk.to_table,
        fromCol: fk.from_col, toCol: fk.to_col,
        fromTable: t, toTable: dstT,
      });
    });
  });
}

function makeERCard(t) {
  const group = new THREE.Group();
  const sz = cardSize(t);
  const tex = makeERTexture(t, sz.texH);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(sz.W, sz.H),
    new THREE.MeshBasicMaterial({map: tex, transparent: true,
      depthWrite: true, side: THREE.DoubleSide}));
  plane.userData.pickable = true;
  plane.userData.tableName = t.name;
  group.add(plane);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(sz.W*0.55, sz.W*0.58, 64),
    new THREE.MeshBasicMaterial({color: 0x4de8ff, side: THREE.DoubleSide,
      transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false}));
  ring.rotation.x = -Math.PI/2;
  ring.position.y = -sz.H/2 - 0.6;
  group.add(ring);

  return {
    name: t.name, table: t, group, plane, ring,
    baseY: t._pos.y, hover: 0, hoverTarget: 0, rel: 0, relTarget: 0,
    fade: 1, fadeTarget: 1, W: sz.W, H: sz.H,
  };
}



function makeERTexture(t, texH) {
  const cv = document.createElement('canvas');
  const TEX_DPR = 3;
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

  // メタ情報（右寄せで同じ行に）
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
      g.fillRect(0, y - ROW_PX/2 + 4, TEX_W, ROW_PX - 8);
    }

    // アイコン
    g.fillStyle = iconColor;
    g.font = '40px "SF Mono","Courier New",monospace';
    g.fillText(icon, 34, y);

    // カラム名
    g.fillStyle = isPK ? '#ffd166' : (isFK ? '#c9a0ff' : '#eaf6ff');
    g.font = '44px "SF Mono","Courier New",monospace';
    g.fillText(truncate(c.name, 20), 92, y);

    // NOT NULL
    if (c.notnull && !isPK) {
      g.fillStyle = '#ff8ba0';
      g.font = '30px "SF Mono","Courier New",monospace';
      g.fillText('*', TEX_W - 250, y - 8);
    }

    // 型名
    g.fillStyle = '#95b8cc';
    g.font = '30px "SF Mono","Courier New",monospace';
    g.textAlign = 'right';
    g.fillText(c.type, TEX_W - 34, y);
    g.textAlign = 'left';

    y += ROW_PX;
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = (state.renderer && state.renderer.capabilities)
    ? state.renderer.capabilities.getMaxAnisotropy() : 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}



/* ═══════════ CAMERA ═══════════ */
function ease(t) { return t < 0.5 ? 2*t*t : -1 + (4-2*t)*t; }

export function tweenCamera(toPos, toTarget, ms) {
  const fromPos = state.camera.position.clone();
  const fromTgt = state.controls.target.clone();
  const t0 = performance.now();
  state.camTween = now => {
    const t = Math.min(1, (now - t0) / ms);
    const k = ease(t);
    state.camera.position.lerpVectors(fromPos, toPos, k);
    state.controls.target.lerpVectors(fromTgt, toTarget, k);
    if (t >= 1) state.camTween = null;
  };
}

export function fitER() {
  if (state.erCards.length === 0)
    return {pos: new THREE.Vector3(0, 80, 0.01), target: new THREE.Vector3(0, 4, 0)};

  const bbox = new THREE.Box3();
  state.erCards.forEach(c => {
    const half = new THREE.Vector3(c.W/2, c.H/2, c.H/2);
    bbox.expandByPoint(c.group.position.clone().sub(half));
    bbox.expandByPoint(c.group.position.clone().add(half));
  });
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const diag = Math.max(size.x, size.z, size.y * 1.2);

  const fov = 55 * Math.PI / 180;
  const dist = Math.max(diag / (2 * Math.tan(fov / 2)) * 0.55, 15);

  return {
    pos:    center.clone().add(new THREE.Vector3(0, dist, 0.01)),
    target: center,
  };
}

export function fitER3D() {
  if (state.erCards.length === 0)
    return {pos: new THREE.Vector3(30, 50, 70), target: new THREE.Vector3(0, 4, 0)};

  const bbox = new THREE.Box3();
  state.erCards.forEach(c => {
    const half = new THREE.Vector3(c.W/2, c.H/2, c.H/2);
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
    target: target,
  };
}

/* ═══════════ INTERACTION ═══════════ */
function onPointerMove(e) {
  if (er2d.mode === '2d') return;
  state.pointer.x = (e.clientX / innerWidth) * 2 - 1;
  state.pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const hits = state.raycaster.intersectObjects(
    state.erCards.map(c => c.plane), false);
  const n = hits.length ? hits[0].object.userData.tableName : null;
  if (n !== state.hoveredCard) {
    state.hoveredCard = n;
    state.erCards.forEach(c => { c.hoverTarget = c.name === n ? 1 : 0; });
    const related = new Set();
    if (n) {
      state.schema.tables.forEach(t => {
        t.fks.forEach(fk => {
          if (t.name === n) related.add(fk.to_table);
          if (fk.to_table === n) related.add(t.name);
        });
      });
    }
    state.erCards.forEach(c => { c.relTarget = related.has(c.name) ? 1 : 0; });
    state.fkLines.forEach(b => {
      // 非ホバー時は全表示、ホバー時は関連のみ
      const show = !n || (b.from === n || b.to === n);
      b.mesh.visible = show;
      b.dots.forEach(d => { d.visible = show; });
    });
  }
  document.body.style.cursor = hits.length ? 'pointer' : 'default';
}

function onPointerDown(e) {
  state.pointerDownPos = {x: e.clientX, y: e.clientY};
}

function onClick(e) {
  if (er2d.mode === '2d') return;
  if (state.pointerDownPos) {
    const dx = Math.abs(e.clientX - state.pointerDownPos.x);
    const dy = Math.abs(e.clientY - state.pointerDownPos.y);
    if (dx > 5 || dy > 5) return;
  }
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const hits = state.raycaster.intersectObjects(
    state.erCards.map(c => c.plane), false);
  if (hits.length) api.openTable?.(hits[0].object.userData.tableName);
}

function onDblClick() {
  if (er2d.mode === '2d') return;
  const c = fitER3D();
  tweenCamera(c.pos, c.target, 500);
}

/* ═══════════ ANIMATE ═══════════ */
export function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(state.clock.getDelta(), 0.05);
  const t = state.clock.elapsedTime;
  if (er2d.mode === '3d') {
    state.erCards.forEach(c => {
      c.plane.quaternion.copy(state.camera.quaternion);
      c.hover = THREE.MathUtils.lerp(c.hover, c.hoverTarget || 0, dt*8);
      c.rel   = THREE.MathUtils.lerp(c.rel,   c.relTarget   || 0, dt*6);
      c.fade  = THREE.MathUtils.lerp(c.fade,
        c.fadeTarget !== undefined ? c.fadeTarget : 1, dt*5);
      const lift = c.hover * 0.8 + Math.sin(t*1.3 + c.group.position.x)*0.05;
      c.group.position.y = c.baseY + lift;
      const baseOp = (c.hover > 0.05 || c.rel > 0.05) ? 1 : 0.95;
      c.plane.material.opacity = c.fade * baseOp;
      c.ring.material.opacity = (c.hover*0.4 + c.rel*0.15) * c.fade;
      const rs = 1 + c.hover*0.08 + c.rel*0.03;
      c.ring.scale.set(rs, rs, rs);
    });

    state.fkLines.forEach(b => {
      // 常時更新（表示状態に関わらず曲線を最新位置に保つ）
      const srcCard = state.erCards.find(c => c.name === b.from);
      const dstCard = state.erCards.find(c => c.name === b.to);
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
      const dist = Math.sqrt(dx*dx + dz*dz) || 1;
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

      b.phase += dt*0.25;
      b.dots.forEach((d, i) => {
        const u = (b.phase + i/b.dots.length) % 1;
        d.position.copy(b.curve.getPoint(u));
        d.scale.setScalar(0.7 + Math.sin(u*Math.PI)*0.7);
        d.material.opacity = 0.3 + Math.sin(u*Math.PI)*0.7;
      });
    });

    if (state.camTween) state.camTween(performance.now());
    state.controls.update();
    state.composer.render();
  }
}