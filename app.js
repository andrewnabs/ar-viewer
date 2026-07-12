import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

// ─────────────────────────────────────────────────────────────────────────────
// AR Air-Situation viewer.
//
// A scenario is a small JSON blob of aircraft { callsign, x, y, flight-level }.
// It arrives either in the URL hash (#s=<base64url-json>, how the kiosk QR code
// delivers it) or via ?scene=<name> which loads scenes/<name>.json (for local
// testing). The scene is rendered as a ~0.5 m airspace box: the radar plan is
// the horizontal floor, altitude is up, top of the box = topFt (45,000 ft).
//
// Anchoring: MindAR image-tracks the radar screen. Because the screen is a
// vertical target, its anchor axes are already world-aligned (x right, y up,
// z toward the viewer), so the box stands upright in front of the screen with
// no extra rotation. A trackless fallback parents the same box to the camera.
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = {
  g: 0x35d07f, // green  — coordinated / assumed
  w: 0xdfe8f0, // white  — selected / your sector
  c: 0x35c7e0, // cyan   — highlighted
  b: 0x5b8cff, // blue   — pending / next sector
  y: 0x8899a6, // grey   — other sector / not concerned
};
const ACCENT = 0x35c7e0;

// Box dimensions in MindAR anchor units (1 unit ≈ tracked image width). The box
// is roughly a cube; SIZE is tunable live via pinch / the +/- buttons.
const BOX = { w: 0.42, h: 0.42, d: 0.42 };
const BASE_Y = -0.28;   // drop the box so it sits in front of / below screen centre
const FRONT_Z = 0.30;   // push it out in front of the screen toward the viewer
const FL_RINGS = [10000, 20000, 30000, 40000]; // altitude reference loops

// ── scene loading ────────────────────────────────────────────────────────────
async function loadScene() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const enc = hash.get('s');
  if (enc) return decodeScene(enc);
  const name = new URLSearchParams(location.search).get('scene');
  if (name) {
    const res = await fetch(`./scenes/${name.replace(/[^a-z0-9_-]/gi, '')}.json`);
    if (res.ok) return res.json();
  }
  // Fall back to the bundled demo so the page is never empty.
  return fetch('./scenes/scenario1.json').then((r) => r.json());
}

function decodeScene(enc) {
  let b64 = enc.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';   // re-add stripped padding (Safari is strict)
  const json = decodeURIComponent(escape(atob(b64)));
  return JSON.parse(json);
}

// ── label sprites (billboarded callsign + flight level) ──────────────────────
function makeLabel(callsign, ft, colorHex) {
  const pad = 8, lineH = 30, w = 220, h = 66, dpr = 2;
  const cv = document.createElement('canvas');
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = 'rgba(6,18,31,0.72)';
  roundRect(g, 1, 1, w - 2, h - 2, 8); g.fill();
  g.strokeStyle = `#${colorHex.toString(16).padStart(6, '0')}`;
  g.lineWidth = 1.5; roundRect(g, 1, 1, w - 2, h - 2, 8); g.stroke();
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = '600 26px -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillText(callsign, pad + 4, pad + lineH / 2);
  g.fillStyle = `#${colorHex.toString(16).padStart(6, '0')}`;
  g.font = '500 22px -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillText(flText(ft), pad + 4, pad + lineH + lineH / 2 - 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.renderOrder = 10;
  sprite.scale.set(0.11, 0.11 * (h / w), 1);
  return sprite;
}
function flText(ft) { return 'FL' + String(Math.round(ft / 100)).padStart(3, '0'); }
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function makeTextSprite(text, colorHex, px = 20) {
  const dpr = 2, w = 128, h = 40;
  const cv = document.createElement('canvas'); cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  g.fillStyle = `#${colorHex.toString(16).padStart(6, '0')}`;
  g.font = `600 ${px}px -apple-system, Segoe UI, Roboto, sans-serif`;
  g.textBaseline = 'middle'; g.fillText(text, 2, h / 2);
  const tex = new THREE.CanvasTexture(cv);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0.85 }));
  s.scale.set(0.09, 0.09 * (h / w), 1);
  return s;
}

// ── build the airspace box for a scene ───────────────────────────────────────
function buildAirspace(scene) {
  const root = new THREE.Group();
  root.position.set(0, BASE_Y, FRONT_Z);

  const topFt = scene.topFt || 45000;
  const { w, h, d } = BOX;
  const px = (fx) => (fx - 0.5) * w;        // radar x  → box X
  const pz = (fy) => (fy - 0.5) * d;        // radar y  → box depth (top of radar = far)
  const py = (ft) => Math.max(0, Math.min(1, ft / topFt)) * h;

  // Wireframe cube (faint) + brighter base frame.
  const cube = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.22 }));
  cube.position.y = h / 2;
  root.add(cube);

  // Ground grid on the base.
  const grid = new THREE.GridHelper(w, 8, ACCENT, ACCENT);
  grid.material.transparent = true; grid.material.opacity = 0.14;
  grid.scale.z = d / w;
  root.add(grid);

  // Altitude reference loops + FL labels up one corner.
  for (const ft of FL_RINGS) {
    if (ft > topFt) continue;
    const y = py(ft);
    const loop = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-w / 2, y, -d / 2), new THREE.Vector3(w / 2, y, -d / 2),
        new THREE.Vector3(w / 2, y, d / 2), new THREE.Vector3(-w / 2, y, d / 2),
      ]),
      new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.12 }));
    root.add(loop);
    const lbl = makeTextSprite(flText(ft), ACCENT, 18);
    lbl.position.set(-w / 2 - 0.02, y, -d / 2);
    root.add(lbl);
  }

  // Aircraft: marker + drop-line + ground tick + billboard label.
  const markerGeo = new THREE.SphereGeometry(0.011, 16, 12);
  for (const a of scene.aircraft || []) {
    const color = COLORS[a.c] || COLORS.g;
    const x = px(a.x), z = pz(a.y), y = py(a.ft);

    const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color }));
    marker.position.set(x, y, z);
    root.add(marker);

    const drop = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, z), new THREE.Vector3(x, y, z)]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 }));
    root.add(drop);

    const tick = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
    tick.position.set(x, 0, z);
    root.add(tick);

    const label = makeLabel(a.cs, a.ft, color);
    label.position.set(x, y + 0.05, z);
    root.add(label);
  }

  return root;
}

// ── app bootstrap ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

(async function main() {
  let scene;
  try { scene = await loadScene(); }
  catch (e) { showError('Could not load the scenario data. The AR link may be incomplete.'); return; }

  $('introTitle').textContent = scene.title || 'Air Situation in 3D';
  $('hudSub').textContent = scene.name || 'scenario';

  const airspace = buildAirspace(scene);

  $('startBtn').addEventListener('click', () => startTracked(scene, airspace), { once: true });
  $('freeBtn').addEventListener('click', () => startFree(scene, airspace), { once: true });
  // Offer the trackless fallback after a short delay in case the camera/target fails.
  setTimeout(() => $('freeBtn').classList.remove('hidden'), 6000);
})();

function showError(msg) {
  const box = $('errBox');
  box.textContent = msg; box.classList.remove('hidden');
}

let renderer, camera, sceneThree, running;
const state = { auto: true };  // slow auto-rotate until the viewer interacts

function commonThree(mindarRenderer, mindarScene, mindarCamera) {
  renderer = mindarRenderer; sceneThree = mindarScene; camera = mindarCamera;
  const light = new THREE.HemisphereLight(0xffffff, 0x223344, 1.1);
  sceneThree.add(light);
}

function revealHud() {
  $('intro').classList.add('hidden');
  ['hud', 'controls', 'hudBottom'].forEach((id) => $(id).classList.remove('hidden'));
}

async function startTracked(scene, airspace) {
  let mindar;
  try {
    mindar = new MindARThree({
      container: $('ar'),
      imageTargetSrc: './targets/scenario1.mind',
      uiScanning: false, uiLoading: false, uiError: false,
      filterMinCF: 0.0001, filterBeta: 0.01,
    });
  } catch (e) { showError('AR could not start on this device.'); return; }

  const { renderer: r, scene: s, camera: c } = mindar;
  commonThree(r, s, c);
  const anchor = mindar.addAnchor(0);
  anchor.group.add(airspace);

  const pill = $('statusPill');
  anchor.onTargetFound = () => { pill.className = 'status-pill tracking'; pill.textContent = '● Tracking'; };
  anchor.onTargetLost = () => { pill.className = 'status-pill searching'; pill.textContent = '◎ Searching…'; };

  try {
    await mindar.start();
  } catch (e) {
    // start() rejects if the camera is blocked OR the .mind target failed to load.
    showError('Couldn’t start screen tracking. Allow camera access, or use the button below to place the air picture in front of you.');
    $('freeBtn').classList.remove('hidden');
    return;
  }
  revealHud();
  startLoop(airspace);
  installGestures(airspace);
}

// Trackless fallback: show the box locked in front of the camera.
async function startFree(scene, airspace) {
  const w = window.innerWidth, h = window.innerHeight;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(w, h); renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  $('ar').appendChild(renderer.domElement);
  sceneThree = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 100);
  sceneThree.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));

  // Camera feed as background (best-effort; if denied we just show the box on the dark bg).
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = stream;
    await video.play();
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1';
    $('ar').appendChild(video);
  } catch (e) { document.body.style.background = '#06121f'; }

  const holder = new THREE.Group();
  holder.position.set(0, 0, -0.85);
  airspace.position.set(0, -BOX.h / 2, 0); // recentre for head-on viewing
  holder.add(airspace);
  sceneThree.add(holder);

  $('statusPill').className = 'status-pill tracking';
  $('statusPill').textContent = '● Placed';
  revealHud();
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });
  startLoop(airspace);
  installGestures(airspace);
}

function startLoop(airspace) {
  if (running) return; running = true;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (state.auto) airspace.rotation.y += dt * 0.3;
    renderer.render(sceneThree, camera);
  });
}

// Pinch to scale, one-finger drag to spin the box.
function installGestures(airspace) {
  const el = $('ar');
  let mode = null, startDist = 0, startScale = 1, lastX = 0;
  const scaleOf = () => airspace.scale.x;

  el.addEventListener('touchstart', (e) => {
    state.auto = false;  // any touch stops the idle auto-rotate
    if (e.touches.length === 2) {
      mode = 'pinch'; startDist = dist(e.touches); startScale = scaleOf();
    } else if (e.touches.length === 1) {
      mode = 'spin'; lastX = e.touches[0].clientX;
    }
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (mode === 'pinch' && e.touches.length === 2) {
      const s = Math.max(0.35, Math.min(3, startScale * (dist(e.touches) / startDist)));
      airspace.scale.setScalar(s);
    } else if (mode === 'spin' && e.touches.length === 1) {
      const x = e.touches[0].clientX;
      airspace.rotation.y += (x - lastX) * 0.01; lastX = x;
    }
  }, { passive: true });

  el.addEventListener('touchend', () => { mode = null; }, { passive: true });

  $('btnIn').addEventListener('click', () => airspace.scale.setScalar(Math.min(3, scaleOf() * 1.15)));
  $('btnOut').addEventListener('click', () => airspace.scale.setScalar(Math.max(0.35, scaleOf() / 1.15)));
  $('btnSpin').addEventListener('click', () => { state.auto = !state.auto; });
  function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
}
