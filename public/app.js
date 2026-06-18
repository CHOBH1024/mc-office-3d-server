// ── 전체 코드를 DOMContentLoaded 안에서 실행 (DOM 보장) ───────────────────
window.addEventListener('DOMContentLoaded', () => {

// ── GLOBALS ───────────────────────────────────────────────────────────────
const BACKEND_URL = window.location.origin;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let socket = null, player = null, remotePlayers = {};
let localStream = null, camPeers = {}, screenStream = null, screenPeers = {};
let camOn = false;

// ── LOADING (가장 먼저, 오류 발생 무관하게 완료 보장) ──────────────────────
const ldFill = document.getElementById('ld-fill');
const ldSub  = document.getElementById('ld-sub');
let pLoad = 0;
const ldInterval = setInterval(() => {
  pLoad = Math.min(pLoad + Math.random() * 18 + 2, 100);
  if (ldFill) ldFill.style.width = pLoad + '%';
  if (pLoad >= 99.9) {
    clearInterval(ldInterval);
    if (ldSub) ldSub.textContent = '완료!';
    setTimeout(() => {
      const ld = document.getElementById('loading');
      if (ld) { ld.style.opacity = '0'; setTimeout(() => { ld.style.display = 'none'; }, 500); }
      document.getElementById('login-ui').style.display = 'block';
      initColors();
    }, 300);
  }
}, 80);

// ── UTILS ─────────────────────────────────────────────────────────────────
function toast(msg) {
  const tw = document.getElementById('toast-wrap');
  if (!tw) return;
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg;
  tw.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 300); }, 3000);
}

// ── THREE.JS SETUP ────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9bd4e8, 25, 95);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
const audioListener = new THREE.AudioListener();
camera.add(audioListener);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setClearColor(0x87ceeb); // 하늘색
renderer.shadowMap.enabled = true;
renderer.domElement.id = 'cv';
document.body.insertBefore(renderer.domElement, document.body.firstChild);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Lights
const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfffff0, 1.0);
sun.position.set(25, 45, 20); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 130 });
scene.add(sun);

// ── PIXEL TEXTURE FACTORY (진짜 마크 감성) ─────────────────────────────────
const irnd = (a, b) => a + Math.floor(Math.random() * (b - a));
function pixTex(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const cx = c.getContext('2d'); draw(cx);
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}
const noise = (cx, base, spots) => { cx.fillStyle = base; cx.fillRect(0,0,16,16); spots.forEach(col => { for (let i=0;i<10;i++){ cx.fillStyle=col; cx.fillRect(irnd(0,16),irnd(0,16),irnd(1,3),irnd(1,3)); } }); };
const TEX = {
  grassTop: pixTex(cx => noise(cx, '#5a9e43', ['#4f8c3a','#69b04e','#467f33'])),
  grassSide: pixTex(cx => { noise(cx, '#8a6a3a', ['#7a5c2e','#9a7a44']); cx.fillStyle='#5a9e43'; cx.fillRect(0,0,16,5); for(let i=0;i<6;i++){cx.fillStyle='#4f8c3a';cx.fillRect(irnd(0,16),3,2,3);} }),
  dirt: pixTex(cx => noise(cx, '#8a6a3a', ['#7a5c2e','#9a7a44','#6e5128'])),
  stone: pixTex(cx => noise(cx, '#8a8a8a', ['#787878','#9a9a9a','#6e6e6e'])),
  cobble: pixTex(cx => { noise(cx,'#7d7d7d',['#6a6a6a','#909090']); cx.strokeStyle='#5a5a5a'; cx.lineWidth=1; [[0,0,8,8],[8,0,8,8],[0,8,8,8],[8,8,8,8]].forEach(r=>cx.strokeRect(r[0]+1,r[1]+1,r[2]-2,r[3]-2)); }),
  planks: pixTex(cx => { cx.fillStyle='#b3823c'; cx.fillRect(0,0,16,16); for(let y=0;y<16;y+=4){cx.fillStyle='#8c5e1a';cx.fillRect(0,y,16,1);cx.fillStyle='#c8973c';cx.fillRect(0,y+1,16,1);} }),
  logSide: pixTex(cx => { cx.fillStyle='#6b4f25'; cx.fillRect(0,0,16,16); for(let x=0;x<16;x+=3){cx.fillStyle=x%2?'#5a4220':'#7c5d2c';cx.fillRect(x,0,2,16);} }),
  logTop: pixTex(cx => { cx.fillStyle='#a9844a'; cx.fillRect(0,0,16,16); cx.strokeStyle='#7c5d2c'; for(let r=6;r>0;r-=2){cx.beginPath();cx.arc(8,8,r,0,7);cx.stroke();} }),
  brick: pixTex(cx => { cx.fillStyle='#9c4a3a'; cx.fillRect(0,0,16,16); cx.fillStyle='#caa'; for(let y=0;y<16;y+=4)cx.fillRect(0,y,16,1); for(let r=0;r<4;r++){const o=(r%2)*8;for(let x=o;x<16+8;x+=8)cx.fillRect(x%16,r*4,1,4);} }),
  glass: pixTex(cx => { cx.clearRect(0,0,16,16); cx.fillStyle='rgba(150,205,235,0.4)'; cx.fillRect(0,0,16,16); cx.strokeStyle='rgba(230,248,255,0.95)'; cx.lineWidth=2; cx.strokeRect(1,1,14,14); }),
  leaves: pixTex(cx => noise(cx, '#3e7a34', ['#356a2c','#4a8c3e','#2e5e26'])),
  sand: pixTex(cx => noise(cx, '#dcd29a', ['#cfc488','#e8dca8'])),
  glow: pixTex(cx => { noise(cx, '#e8c84a', ['#f0d860','#d4a82e']); cx.fillStyle='#fff0a0'; for(let i=0;i<5;i++)cx.fillRect(irnd(2,14),irnd(2,14),2,2); }),
  water: pixTex(cx => noise(cx, '#2a6fd4', ['#2360bd','#3a82e6','#1e55a8'])),
  lava: pixTex(cx => { noise(cx, '#e2540f', ['#ff7b1a','#c43a08']); cx.fillStyle='#ffd23a'; for(let i=0;i<4;i++)cx.fillRect(irnd(1,14),irnd(1,14),2,2); }),
  slime: pixTex(cx => { noise(cx, '#5fbf5a', ['#52ac4e','#74d66e']); cx.strokeStyle='#3e8c3a'; cx.lineWidth=1; cx.strokeRect(2,2,12,12); }),
  tnt: pixTex(cx => { cx.fillStyle='#c0392b'; cx.fillRect(0,0,16,16); cx.fillStyle='#ece4d4'; cx.fillRect(0,6,16,4); cx.fillStyle='#1a1a1a'; cx.font='bold 5px monospace'; cx.fillText('TNT',1,10); }),
};
const LM = (t, o={}) => new THREE.MeshLambertMaterial({ map: t, ...o });
// 블록 종류 정의 (핫바)
const BLOCKS = [
  { id:'grass',  name:'잔디',   mats:()=>[LM(TEX.grassSide),LM(TEX.grassSide),LM(TEX.grassTop),LM(TEX.dirt),LM(TEX.grassSide),LM(TEX.grassSide)] },
  { id:'dirt',   name:'흙',     mats:()=>LM(TEX.dirt) },
  { id:'stone',  name:'돌',     mats:()=>LM(TEX.stone) },
  { id:'cobble', name:'조약돌', mats:()=>LM(TEX.cobble) },
  { id:'planks', name:'판자',   mats:()=>LM(TEX.planks) },
  { id:'log',    name:'나무',   mats:()=>[LM(TEX.logSide),LM(TEX.logSide),LM(TEX.logTop),LM(TEX.logTop),LM(TEX.logSide),LM(TEX.logSide)] },
  { id:'brick',  name:'벽돌',   mats:()=>LM(TEX.brick) },
  { id:'glass',  name:'유리',   mats:()=>LM(TEX.glass,{transparent:true,opacity:0.65}) },
  { id:'glow',   name:'발광석', mats:()=>new THREE.MeshLambertMaterial({ map:TEX.glow, emissive:0xffcc44, emissiveIntensity:0.9 }) },
  { id:'water',  name:'물',     mats:()=>LM(TEX.water,{transparent:true,opacity:0.72}) },
  { id:'lava',   name:'용암',   mats:()=>new THREE.MeshLambertMaterial({ map:TEX.lava, emissive:0xff5a0a, emissiveIntensity:0.7 }) },
  { id:'slime',  name:'점프대', mats:()=>LM(TEX.slime,{transparent:true,opacity:0.9}) },
  { id:'tnt',    name:'TNT',    mats:()=>LM(TEX.tnt) },
];
const blockById = id => BLOCKS.find(b => b.id === id) || BLOCKS[1];

function colorTex(hex) { const c=document.createElement('canvas');c.width=c.height=4;const cx=c.getContext('2d');cx.fillStyle=hex;cx.fillRect(0,0,4,4);const t=new THREE.CanvasTexture(c);t.magFilter=THREE.NearestFilter;return t; }
function mat(hex) { return new THREE.MeshLambertMaterial({ map: colorTex(hex) }); }
function addBox(w, h, d, m, x, y, z) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; scene.add(b); return b;
}

// ── WORLD (마크 스타일 잔디 평야 + 건물 + 나무) ────────────────────────────
// 잔디 바닥 (타일 반복)
{
  const gt = TEX.grassTop.clone(); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(50, 50); gt.magFilter = THREE.NearestFilter;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshLambertMaterial({ map: gt }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
}
// 외벽 (조약돌 타일 큰 박스 — 성능 최적화) + 유리창
function tiledMat(tex, rx, ry) { const t = tex.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.magFilter = THREE.NearestFilter; return new THREE.MeshLambertMaterial({ map: t }); }
addBox(41, 4, 1, tiledMat(TEX.cobble, 41, 4), 0, 2, -15);
addBox(41, 4, 1, tiledMat(TEX.cobble, 41, 4), 0, 2, 15);
addBox(1, 4, 30, tiledMat(TEX.cobble, 30, 4), -20, 2, 0);
addBox(1, 4, 30, tiledMat(TEX.cobble, 30, 4), 20, 2, 0);
addBox(6, 2, 0.25, LM(TEX.glass, { transparent: true, opacity: 0.6 }), -13, 2.2, -14.4);
addBox(6, 2, 0.25, LM(TEX.glass, { transparent: true, opacity: 0.6 }), 13, 2.2, -14.4);
// 책상 (판자)
[[-8,-8],[-4,-8],[0,-8],[4,-8],[8,-8]].forEach(([x,z]) => addBox(3, 0.2, 1.5, LM(TEX.planks), x, 1, z));
// 나무 (통나무 + 잎)
function tree(x, z) {
  for (let h = 0; h < 3; h++) addBox(1,1,1, [LM(TEX.logSide),LM(TEX.logSide),LM(TEX.logTop),LM(TEX.logTop),LM(TEX.logSide),LM(TEX.logSide)], x, h+0.5, z);
  for (let dx=-1; dx<=1; dx++) for (let dz=-1; dz<=1; dz++) for (let dy=0; dy<2; dy++) addBox(1,1,1, LM(TEX.leaves), x+dx, 3.5+dy, z+dz);
  addBox(1,1,1, LM(TEX.leaves), x, 5.5, z);
}
[[-16,8],[16,8],[-16,-2],[16,-2],[0,12]].forEach(([x,z]) => tree(x,z));
// 작은 잔디 언덕 (점프해서 올라가 보세요)
[[13,10,1],[14,10,1],[13,11,1],[14,11,2],[13,11,2]].forEach(([x,z,hh]) => { for(let h=0;h<hh;h++) addBox(1,1,1, h===hh-1?[LM(TEX.grassSide),LM(TEX.grassSide),LM(TEX.grassTop),LM(TEX.dirt),LM(TEX.grassSide),LM(TEX.grassSide)]:LM(TEX.dirt), x, h+0.5, z); });
// 떠다니는 구름
const clouds = [];
for (let i = 0; i < 14; i++) {
  const cl = new THREE.Mesh(new THREE.BoxGeometry(5 + Math.random()*8, 1.3, 4 + Math.random()*6), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  cl.position.set(-60 + Math.random()*120, 28 + Math.random()*10, -60 + Math.random()*120);
  scene.add(cl); clouds.push(cl);
}

// ── 동물(닭) 로컬 배회 ─────────────────────────────────────────────────────
const animals = [];
function buildChicken(x, z) {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const add = (w, h, d, m, px, py, pz) => { const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); p.position.set(px, py, pz); g.add(p); return p; };
  add(0.5, 0.4, 0.7, white, 0, 0.5, 0);
  add(0.34, 0.34, 0.34, white, 0, 0.82, 0.32);
  add(0.16, 0.16, 0.2, new THREE.MeshLambertMaterial({ color: 0xff3b3b }), 0, 1.02, 0.34);
  add(0.12, 0.1, 0.16, new THREE.MeshLambertMaterial({ color: 0xffaa22 }), 0, 0.8, 0.54);
  const legM = new THREE.MeshLambertMaterial({ color: 0xffaa22 });
  add(0.08, 0.3, 0.08, legM, -0.12, 0.15, 0); add(0.08, 0.3, 0.08, legM, 0.12, 0.15, 0);
  g.position.set(x, 0, z); scene.add(g);
  return { g, hx: x, hz: z, phase: Math.random() * 6, t: Math.random() * 6 };
}
for (let i = 0; i < 6; i++) animals.push(buildChicken(-12 + Math.random()*24, -10 + Math.random()*20));

// ── 비(날씨) ───────────────────────────────────────────────────────────────
let raining = false;
const rainGroup = new THREE.Group(); rainGroup.visible = false; scene.add(rainGroup);
const drops = [];
{
  const rg = new THREE.BoxGeometry(0.03, 0.55, 0.03), rm = new THREE.MeshBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.5 });
  for (let i = 0; i < 180; i++) { const d = new THREE.Mesh(rg, rm); d.position.set((Math.random()-0.5)*44, Math.random()*22, (Math.random()-0.5)*44); rainGroup.add(d); drops.push(d); }
}
function toggleRain() { raining = !raining; rainGroup.visible = raining; toast(raining ? '🌧️ 비가 내립니다' : '☀️ 비가 그쳤습니다'); }

// ── 수중 화면 오버레이 ─────────────────────────────────────────────────────
const uwOverlay = document.createElement('div');
uwOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(40,110,200,0.32);pointer-events:none;z-index:8;display:none;';
document.body.appendChild(uwOverlay);

// ── AVATAR BUILDER ────────────────────────────────────────────────────────
function hexColor(hex) { return new THREE.MeshLambertMaterial({ color: hex }); }

function buildAvatar(colorHex, name, isLocal = false) {
  const g = new THREE.Group();
  const mc = hexColor(colorHex);
  const skin = hexColor(0xffd080);

  function part(w, h, d, m, x, y, z) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    p.position.set(x, y, z); p.castShadow = true; g.add(p); return p;
  }

  const body = part(0.8, 1.2, 0.4, mc, 0, 1.1, 0);
  const head = part(0.8, 0.8, 0.8, skin, 0, 2.1, 0);

  // Face plane for camera texture
  const faceGeo = new THREE.PlaneGeometry(0.75, 0.75);
  if (isLocal) {
    const uvs = faceGeo.attributes.uv.array;
    for (let i = 0; i < uvs.length; i += 2) uvs[i] = 1 - uvs[i];
  }
  const faceMat = new THREE.MeshBasicMaterial({ color: 0xffd080 });
  const facePlane = new THREE.Mesh(faceGeo, faceMat);
  facePlane.position.set(0, 0, 0.41); head.add(facePlane);

  const LA = part(0.3, 1.0, 0.3, skin, -0.6, 1.0, 0);
  const RA = part(0.3, 1.0, 0.3, skin, 0.6, 1.0, 0);
  const LL = part(0.38, 1.0, 0.38, mc, -0.21, 0.5, 0);
  const RL = part(0.38, 1.0, 0.38, mc, 0.21, 0.5, 0);

  // Name tag
  const tag = document.createElement('div');
  tag.className = 'name-tag' + (isLocal ? ' me' : '');
  tag.textContent = name;
  document.body.appendChild(tag);

  return { g, head, facePlane, LA, RA, LL, RL, tag, phase: 0, tx: 0, tz: 0, trY: 0, name, colorHex, bubble: null, vid: null };
}

// ── BLOCKS ────────────────────────────────────────────────────────────────
const blockMeshes = {};
let selectedBlock = 'grass'; // 핫바 선택 블록
function placeBlockMesh(x, y, z, type = 'dirt') {
  const k = `${x},${y},${z}`; if (blockMeshes[k]) return;
  const m = addBox(1, 1, 1, blockById(type).mats(), x, y + 0.5, z);
  m.userData.isBlock = true; m.userData.bk = k; m.userData.type = type;
  blockMeshes[k] = m;
}
function removeBlockMesh(x, y, z) {
  const k = `${x},${y},${z}`;
  if (blockMeshes[k]) { scene.remove(blockMeshes[k]); blockMeshes[k].geometry.dispose(); delete blockMeshes[k]; }
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
window.addEventListener('mousedown', e => {
  if (!player || document.getElementById('hud').style.display === 'none') return;
  if (e.target.closest('.mc-panel, .mc-btn, .glass-modal, #blockbar')) return;
  // 1인칭인데 시점 잠금 전이면 클릭으로 잠금만
  if (firstPerson && document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock?.(); return; }
  if (e.button !== 0 && e.button !== 2) return;
  if (firstPerson) { mouse.x = 0; mouse.y = 0; } else { mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = -(e.clientY / innerHeight) * 2 + 1; }
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children);
  if (!hits.length || hits[0].distance > 9) return;   // 도달 거리 제한(마크식)
  const pt = hits[0].point, n = hits[0].face.normal;
  if (e.button === 0) {
    const bx = Math.round(pt.x - n.x * .5), by = Math.floor(pt.y - n.y * .5), bz = Math.round(pt.z - n.z * .5);
    if (socket) socket.emit('break_block', { x: bx, y: by, z: bz });
  } else {
    const bx = Math.round(pt.x + n.x * .5), by = Math.floor(pt.y + n.y * .5), bz = Math.round(pt.z + n.z * .5);
    if (by >= 0 && socket) socket.emit('place_block', { x: bx, y: by, z: bz, type: selectedBlock });
    if (by >= 0 && selectedBlock === 'tnt') startFuse(bx, by, bz);
  }
});
window.addEventListener('contextmenu', e => { if (player) e.preventDefault(); });

// ── UI: COLORS ────────────────────────────────────────────────────────────
let myColor = 0x226622;
const PALETTE = [0x226622, 0x222266, 0x662222, 0x665522, 0x226666, 0x662266];

function initColors() {
  const cr = document.getElementById('color-row'); if (!cr) return;
  PALETTE.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'color-swatch' + (i === 0 ? ' sel' : '');
    d.style.background = '#' + c.toString(16).padStart(6, '0');
    d.onclick = () => {
      cr.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('sel'));
      d.classList.add('sel'); myColor = c;
    };
    cr.appendChild(d);
  });
}

// ── UI: CHAT ──────────────────────────────────────────────────────────────
const chatLog = document.getElementById('chat-log');
const chatIn  = document.getElementById('chat-in');

function appendChat(who, msg, type) {
  if (!chatLog) return;
  const d = document.createElement('div');
  const cls = type === 'me' ? 'msg-me' : type === 'npc' ? 'msg-npc' : 'msg-sys';
  d.innerHTML = type === 'sys'
    ? `<span class="${cls}">▶ ${msg}</span>`
    : `<span class="${cls}">&lt;${who}&gt;</span> ${msg}`;
  chatLog.appendChild(d);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function showBubble(id, msg) {
  const target = socket && id === socket.id ? player : remotePlayers[id];
  if (!target) return;
  if (target.bubble) target.bubble.remove();
  const b = document.createElement('div');
  b.className = 'chat-bubble'; b.textContent = msg;
  document.body.appendChild(b);
  target.bubble = b;
  setTimeout(() => { if (target.bubble === b) { b.remove(); target.bubble = null; } }, 4000);
}

document.getElementById('send-btn')?.addEventListener('click', () => {
  const t = chatIn?.value.trim(); if (!t || !socket) return;
  socket.emit('chat', { msg: t }); if (chatIn) chatIn.value = '';
});
chatIn?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('send-btn')?.click(); });

// ── UI: VPANEL ────────────────────────────────────────────────────────────
function updateVPanel() {
  const list = document.getElementById('vpanel-list'); if (!list) return;
  list.innerHTML = '';
  const rvals = Object.values(remotePlayers);
  if (!rvals.length) { list.innerHTML = '<div class="vpanel-empty">접속자 없음</div>'; return; }
  rvals.forEach(r => {
    const near = player && player.g.position.distanceTo(r.g.position) < 6;
    const slot = document.createElement('div');
    slot.className = 'vslot' + (near ? ' near' : '');
    slot.innerHTML = `<div class="vdot"></div><div class="vname">${r.name}</div>${near ? '<div class="vbadge">근처</div>' : ''}`;
    list.appendChild(slot);
  });
}

function updateUCnt() {
  const el = document.getElementById('ucnt');
  if (el) el.textContent = `${Object.keys(remotePlayers).length + 1}명 접속`;
}

// ── CONTROLS: MIC / CAM / SHARE / BOARD ───────────────────────────────────
document.getElementById('btn-mic')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-mic');
  if (audioListener.context.state === 'suspended') audioListener.context.resume();
  // 카메라 없이도 마이크 단독 활성화
  if (!localStream) {
    try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return toast('마이크 권한을 허용해주세요.'); }
    Object.keys(remotePlayers).forEach(id => startCamCall(id));
    const at = localStream.getAudioTracks()[0]; if (at) at.enabled = true;
    btn.textContent = '🎤 ON'; btn.classList.add('on');
    toast('마이크 ON');
    return;
  }
  const t = localStream.getAudioTracks()[0];
  if (!t) return toast('마이크를 찾을 수 없어요.');
  t.enabled = !t.enabled;
  btn.textContent = t.enabled ? '🎤 ON' : '🎤 마이크';
  btn.classList.toggle('on', t.enabled);
});

document.getElementById('btn-cam')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-cam');
  const micBtn = document.getElementById('btn-mic');
  if (!camOn) {
    if (audioListener.context.state === 'suspended') audioListener.context.resume();
    try {
      // 기존(마이크 단독) 스트림이 있으면 정리 후 영상+음성 새로 확보
      if (localStream) { localStream.getTracks().forEach(t => t.stop()); Object.values(camPeers).forEach(p => p.close()); camPeers = {}; }
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const vid = Object.assign(document.createElement('video'), { autoplay: true, muted: true });
      vid.srcObject = localStream;
      vid.onloadedmetadata = () => {
        const tex = new THREE.VideoTexture(vid);
        tex.minFilter = THREE.LinearFilter;
        if (player) player.facePlane.material = new THREE.MeshBasicMaterial({ map: tex });
      };
      camOn = true; btn.textContent = '📷 ON'; btn.classList.add('on');
      // 마이크도 함께 켜진 상태로 버튼 동기화
      if (micBtn) { micBtn.textContent = '🎤 ON'; micBtn.classList.add('on'); }
      toast('카메라 연결됨');
      Object.keys(remotePlayers).forEach(id => startCamCall(id));
    } catch { toast('카메라 권한을 허용해주세요.'); }
  } else {
    localStream.getTracks().forEach(t => t.stop()); localStream = null;
    if (player) player.facePlane.material = new THREE.MeshBasicMaterial({ color: 0xffd080 });
    camOn = false; btn.textContent = '📷 카메라'; btn.classList.remove('on');
    if (micBtn) { micBtn.textContent = '🎤 마이크'; micBtn.classList.remove('on'); }
    Object.values(camPeers).forEach(p => p.close()); camPeers = {};
    toast('카메라 OFF');
  }
});

document.getElementById('btn-share')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-share');
  if (!screenStream) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStream.getVideoTracks()[0].onended = stopShare;
      btn.textContent = '💻 공유 중'; btn.classList.add('on');
      Object.keys(remotePlayers).forEach(id => startScreenCall(id));
      if (socket) socket.emit('screen_share_start');
      toast('화면 공유 시작');
    } catch { /* user cancelled */ }
  } else stopShare();
});

function stopShare() {
  if (!screenStream) return;
  screenStream.getTracks().forEach(t => t.stop()); screenStream = null;
  const btn = document.getElementById('btn-share');
  btn.textContent = '💻 화면공유'; btn.classList.remove('on');
  Object.values(screenPeers).forEach(p => p.close()); screenPeers = {};
  if (socket) socket.emit('screen_share_stop');
  toast('화면 공유 중지');
}

document.getElementById('close-screen')?.addEventListener('click', () => {
  document.getElementById('screen-share-ui').style.display = 'none';
});

// ── WHITEBOARD ────────────────────────────────────────────────────────────
const bCanvas = document.getElementById('board-canvas');
const bCtx = bCanvas?.getContext('2d');
let isDrawing = false, lastX = 0, lastY = 0, drawColor = '#000000';

document.getElementById('btn-board')?.addEventListener('click', () => {
  const ui = document.getElementById('board-ui');
  ui.style.display = 'flex';
  if (bCanvas) { bCanvas.width = bCanvas.clientWidth; bCanvas.height = bCanvas.clientHeight; }
});
document.getElementById('close-board')?.addEventListener('click', () => {
  document.getElementById('board-ui').style.display = 'none';
});
document.querySelectorAll('.board-color').forEach(el => {
  el.onclick = () => {
    document.querySelectorAll('.board-color').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel'); drawColor = el.style.background;
  };
});
bCanvas?.addEventListener('mousedown', e => { isDrawing = true; lastX = e.offsetX; lastY = e.offsetY; });
window.addEventListener('mouseup', () => { isDrawing = false; });
bCanvas?.addEventListener('mousemove', e => {
  if (!isDrawing) return;
  const [nx, ny] = [e.offsetX, e.offsetY];
  const [w, h] = [bCanvas.width, bCanvas.height];
  drawLine(lastX / w, lastY / h, nx / w, ny / h, drawColor);
  if (socket) socket.emit('draw', { x0: lastX / w, y0: lastY / h, x1: nx / w, y1: ny / h, color: drawColor });
  lastX = nx; lastY = ny;
});
function drawLine(x0, y0, x1, y1, c) {
  if (!bCtx || !bCanvas) return;
  bCtx.beginPath(); bCtx.moveTo(x0 * bCanvas.width, y0 * bCanvas.height);
  bCtx.lineTo(x1 * bCanvas.width, y1 * bCanvas.height);
  bCtx.strokeStyle = c; bCtx.lineWidth = 2; bCtx.stroke();
}

// ── EXIT ──────────────────────────────────────────────────────────────────
document.getElementById('btn-exit')?.addEventListener('click', () => {
  if (socket) { socket.disconnect(); socket = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  Object.values(camPeers).forEach(p => p.close()); camPeers = {};
  Object.values(screenPeers).forEach(p => p.close()); screenPeers = {};
  if (player) { scene.remove(player.g); player.tag.remove(); player = null; }
  Object.values(remotePlayers).forEach(r => { scene.remove(r.g); r.tag.remove(); if (r.bubble) r.bubble.remove(); if (r.vid) r.vid.remove(); if (r.audioEl) r.audioEl.remove(); });
  remotePlayers = {};
  document.getElementById('hud').style.display = 'none';
  document.getElementById('xhair').style.display = 'none';
  if (window._joystick) window._joystick.style.display = 'none';
  if (window._blockbar) window._blockbar.style.display = 'none';
  if (window._emotebar) window._emotebar.style.display = 'none';
  firstPerson = false; flying = false; document.exitPointerLock?.();
  document.getElementById('login-ui').style.display = 'block';
  document.getElementById('screen-share-ui').style.display = 'none';
  document.getElementById('board-ui').style.display = 'none';
  if (chatLog) chatLog.innerHTML = '';
  camOn = false;
  const btn = document.getElementById('btn-cam');
  if (btn) { btn.textContent = '📷 카메라'; btn.classList.remove('on'); }
});

// ── LOGIN & SOCKET ────────────────────────────────────────────────────────
document.getElementById('login-btn')?.addEventListener('click', startSession);
document.getElementById('login-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') startSession(); });

function startSession() {
  const nameEl = document.getElementById('login-name');
  const name = nameEl?.value.trim();
  if (!name) return toast('이름을 입력하세요!');

  document.getElementById('login-ui').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  document.getElementById('xhair').style.display = 'block';
  if (window._joystick) window._joystick.style.display = 'block';
  if (window._blockbar) window._blockbar.style.display = 'flex';
  if (window._emotebar) window._emotebar.style.display = 'flex';
  document.getElementById('net-dot').className = 'dot off';

  player = buildAvatar(myColor, name, true);
  player.g.position.set(0, 0, 5);
  scene.add(player.g);

  socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    document.getElementById('net-dot').className = 'dot';
    socket.emit('join', { name, color: myColor });
    toast(`서버 연결 완료!`);
  });
  socket.on('connect_error', () => {
    document.getElementById('net-dot').className = 'dot off';
    toast('서버 연결 실패');
  });

  socket.on('init_players', (players) => {
    Object.values(players).forEach(p => { if (p.id !== socket.id) addRemote(p); });
    updateUCnt(); updateVPanel();
  });
  socket.on('player_joined', p => {
    addRemote(p); updateUCnt(); updateVPanel(); toast(`${p.name} 입장`);
    // 내가 이미 켜둔 카메라/마이크·화면공유를 새 입장자에게도 전송 (late-joiner 동기화)
    setTimeout(() => {
      if (localStream && remotePlayers[p.id]) startCamCall(p.id);
      if (screenStream && remotePlayers[p.id]) startScreenCall(p.id);
    }, 700);
  });
  socket.on('player_moved', d => {
    const r = remotePlayers[d.id];
    if (r) { r.tx = d.x; r.ty = d.y; r.tz = d.z; r.trY = d.ry; }
  });
  socket.on('player_left', id => {
    const r = remotePlayers[id]; if (!r) return;
    scene.remove(r.g); r.tag.remove(); if (r.bubble) r.bubble.remove();
    if (r.vid) r.vid.remove(); if (r.audioEl) r.audioEl.remove();
    toast(`${r.name} 퇴장`); delete remotePlayers[id];
    if (camPeers[id]) { camPeers[id].close(); delete camPeers[id]; }
    if (screenPeers[id]) { screenPeers[id].close(); delete screenPeers[id]; }
    updateUCnt(); updateVPanel();
  });
  socket.on('chat', d => {
    if (d.type === 'sys') appendChat(null, d.msg, 'sys');
    else { appendChat(d.who, d.msg, d.id === socket.id ? 'me' : 'npc'); showBubble(d.id, d.msg); }
  });

  // WebRTC - Cam
  socket.on('webrtc_offer', async d => {
    const pc = createCamPeer(d.source);
    await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    socket.emit('webrtc_answer', { target: d.source, sdp: ans });
  });
  socket.on('webrtc_answer', async d => { if (camPeers[d.source]) await camPeers[d.source].setRemoteDescription(new RTCSessionDescription(d.sdp)); });
  socket.on('webrtc_ice', async d => { if (camPeers[d.source] && d.ice) await camPeers[d.source].addIceCandidate(new RTCIceCandidate(d.ice)).catch(() => {}); });

  // WebRTC - Screen
  socket.on('screen_offer', async d => {
    const pc = new RTCPeerConnection(rtcConfig); screenPeers[d.source] = pc;
    pc.onicecandidate = e => { if (e.candidate) socket.emit('screen_ice', { target: d.source, ice: e.candidate }); };
    pc.ontrack = e => {
      const vid = document.getElementById('screen-share-vid');
      vid.srcObject = e.streams[0];
      document.getElementById('screen-share-ui').style.display = 'flex';
      toast('화면 공유 수신 중');
    };
    await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
    const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
    socket.emit('screen_answer', { target: d.source, sdp: ans });
  });
  socket.on('screen_answer', async d => { if (screenPeers[d.source]) await screenPeers[d.source].setRemoteDescription(new RTCSessionDescription(d.sdp)); });
  socket.on('screen_ice', async d => { if (screenPeers[d.source] && d.ice) await screenPeers[d.source].addIceCandidate(new RTCIceCandidate(d.ice)).catch(() => {}); });
  socket.on('screen_share_stop', () => { document.getElementById('screen-share-ui').style.display = 'none'; });
  socket.on('screen_share_start', id => { if (id !== socket.id) toast('누군가 화면을 공유 중'); });

  // Blocks & Draw
  socket.on('init_blocks', b => Object.keys(b).forEach(k => { const [x,y,z] = k.split(',').map(Number); placeBlockMesh(x,y,z, b[k].type); }));
  socket.on('block_placed', d => { placeBlockMesh(d.x, d.y, d.z, d.type); sfx('place'); });
  socket.on('block_broken', d => { spawnBreak(d.x, d.y, d.z); removeBlockMesh(d.x, d.y, d.z); sfx('break'); });
  socket.on('draw', d => drawLine(d.x0, d.y0, d.x1, d.y1, d.color));
}

function addRemote(p) {
  const r = buildAvatar(p.color, p.name);
  r.g.position.set(p.x || 0, p.y || 0, p.z || 0);
  scene.add(r.g); remotePlayers[p.id] = r;
}

// ── WEBRTC HELPERS ────────────────────────────────────────────────────────
function createCamPeer(id) {
  if (camPeers[id]) { try { camPeers[id].close(); } catch {} } // 재협상 시 기존 피어 정리(누수 방지)
  const pc = new RTCPeerConnection(rtcConfig); camPeers[id] = pc;
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate && socket) socket.emit('webrtc_ice', { target: id, ice: e.candidate }); };
  pc.ontrack = e => {
    const r = remotePlayers[id]; if (!r) return;
    if (e.track.kind === 'video' && !r.vid) {
      const v = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted: true });
      v.srcObject = e.streams[0]; v.style.cssText = 'position:absolute;opacity:0;width:1px;height:1px;pointer-events:none;';
      document.body.appendChild(v); r.vid = v;
      v.onloadedmetadata = () => {
        const tex = new THREE.VideoTexture(v); tex.minFilter = THREE.LinearFilter;
        r.facePlane.material = new THREE.MeshBasicMaterial({ map: tex });
      };
    }
    if (e.track.kind === 'audio' && !r.hasAudio) {
      r.hasAudio = true;
      try {
        const pAudio = new THREE.PositionalAudio(audioListener);
        const src = audioListener.context.createMediaStreamSource(e.streams[0]);
        pAudio.setNodeSource(src);
        pAudio.setRefDistance(4); pAudio.setMaxDistance(22); pAudio.setRolloffFactor(2);
        r.g.add(pAudio); r.audio = pAudio;
        // Chrome 워크어라운드: MediaStream 오디오를 <audio>에도 연결해야 Web Audio 파이프라인 활성화
        const a = Object.assign(document.createElement('audio'), { autoplay: true, muted: true });
        a.srcObject = e.streams[0]; a.style.display = 'none'; document.body.appendChild(a); r.audioEl = a;
      } catch { /* 공간 음향 실패 시 무시 */ }
    }
  };
  return pc;
}

async function startCamCall(id) {
  const pc = createCamPeer(id);
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  if (socket) socket.emit('webrtc_offer', { target: id, sdp: offer });
}

async function startScreenCall(id) {
  if (!screenStream) return;
  const pc = new RTCPeerConnection(rtcConfig); screenPeers[id] = pc;
  screenStream.getTracks().forEach(t => pc.addTrack(t, screenStream));
  pc.onicecandidate = e => { if (e.candidate && socket) socket.emit('screen_ice', { target: id, ice: e.candidate }); };
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  if (socket) socket.emit('screen_offer', { target: id, sdp: offer });
}

// ── TAG POSITIONING ───────────────────────────────────────────────────────
const _wp = new THREE.Vector3();
function posTag(el, worldPos) {
  if (!el) return;
  const p = worldPos.clone().project(camera);
  if (p.z > 1) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.left = ((p.x * 0.5 + 0.5) * innerWidth) + 'px';
  el.style.top  = ((-p.y * 0.5 + 0.5) * innerHeight) + 'px';
}
function headTop(av) {
  av.head.getWorldPosition(_wp); _wp.y += 0.55; return _wp.clone();
}

// ── MINIMAP ───────────────────────────────────────────────────────────────
function drawMinimap() {
  const mm = document.getElementById('mm'); if (!mm || !player) return;
  const ctx = mm.getContext('2d'), cx = 74, cy = 74, scale = 3;
  ctx.clearRect(0, 0, 148, 148);
  // 설치된 블록 (갈색 점)
  ctx.fillStyle = '#9a6a3a';
  for (const k in blockMeshes) {
    const c = k.split(',');
    const dx = (+c[0] - player.g.position.x) * scale, dz = (+c[2] - player.g.position.z) * scale;
    if (Math.abs(dx) < 72 && Math.abs(dz) < 72) ctx.fillRect(cx + dx - 1, cy + dz - 1, 2, 2);
  }
  ctx.fillStyle = '#55ff55'; ctx.fillRect(cx - 2, cy - 2, 4, 4);
  Object.values(remotePlayers).forEach(r => {
    const dx = (r.g.position.x - player.g.position.x) * scale;
    const dz = (r.g.position.z - player.g.position.z) * scale;
    ctx.fillStyle = '#ffff55';
    ctx.fillRect(cx + dx - 2, cy + dz - 2, 4, 4);
  });
}

// ── INPUT ─────────────────────────────────────────────────────────────────
const keys = {};
let firstPerson = false, yaw = 0, pitch = 0, flying = false;

function toggleView() {
  if (!player) return;
  if (!firstPerson && !renderer.domElement.requestPointerLock) { toast('1인칭 시점은 PC(마우스)에서 가능해요'); return; }
  firstPerson = !firstPerson;
  if (firstPerson) { yaw = player.g.rotation.y; pitch = -0.1; renderer.domElement.requestPointerLock?.(); toast('1인칭 — 클릭으로 시점 잠금, ESC로 해제'); }
  else { document.exitPointerLock?.(); toast('3인칭 시점'); }
}
document.getElementById('btn-view')?.addEventListener('click', toggleView);

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.key] = true;
  if (e.key === 't' || e.key === 'T') { e.preventDefault(); chatIn?.focus(); }
  if (e.key === ' ') e.preventDefault();                       // 점프 (스크롤 방지)
  if (e.key >= '1' && e.key <= '9') { const b = BLOCKS[+e.key - 1]; if (b) selectBlock(b.id); }
  if (e.key === '0') { const b = BLOCKS[9]; if (b) selectBlock(b.id); }
  if (e.key === 'v' || e.key === 'V') toggleView();
  if (e.key === 'm' || e.key === 'M') { muted = !muted; toast(muted ? '🔇 효과음 끔' : '🔊 효과음 켬'); }
  if (e.key === 'f' || e.key === 'F') { flying = !flying; vy = 0; toast(flying ? '✈️ 날기 모드 (Space 상승 · Shift 하강)' : '🚶 걷기 모드'); }
  if (e.key === 'n' || e.key === 'N') { dayT += Math.PI; toast('🕒 낮/밤 전환'); }
  if (e.key === 'b' || e.key === 'B') toggleBGM();
  if (e.key === 'r' || e.key === 'R') toggleRain();
  if (e.key === 'y' || e.key === 'Y') firework();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

// 1인칭 마우스 시점
document.addEventListener('mousemove', e => {
  if (!firstPerson || document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.0025;
  pitch = Math.max(-1.3, Math.min(1.3, pitch - e.movementY * 0.0025));
});
document.addEventListener('pointerlockchange', () => {
  if (firstPerson && document.pointerLockElement !== renderer.domElement) { firstPerson = false; toast('3인칭 시점'); }
});

// ── MOBILE JOYSTICK (터치 기기 전용) ──────────────────────────────────────
(function initJoystick() {
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!isTouch) return;
  const base = document.createElement('div');
  base.style.cssText = 'position:fixed;left:18px;bottom:100px;width:108px;height:108px;border-radius:50%;background:rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.25);z-index:30;touch-action:none;display:none;';
  const knob = document.createElement('div');
  knob.style.cssText = 'position:absolute;left:50%;top:50%;width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.55);transform:translate(-50%,-50%);';
  base.appendChild(knob); document.body.appendChild(base);
  window._joystick = base; // startSession/exit에서 표시 토글
  let active = false, cx = 0, cy = 0;
  const setDir = (nx, nz) => { keys['w'] = nz < -0.3; keys['s'] = nz > 0.3; keys['a'] = nx < -0.3; keys['d'] = nx > 0.3; };
  const clearDir = () => { keys['w'] = keys['a'] = keys['s'] = keys['d'] = false; };
  base.addEventListener('touchstart', e => { active = true; const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
  base.addEventListener('touchmove', e => {
    if (!active) return; const t = e.touches[0];
    const dx = t.clientX - cx, dy = t.clientY - cy, d = Math.hypot(dx, dy) || 1, cl = Math.min(d, 40);
    const nx = dx / d, ny = dy / d;
    knob.style.left = (50 + (nx * cl) / 108 * 100) + '%';
    knob.style.top = (50 + (ny * cl) / 108 * 100) + '%';
    setDir(nx, ny); e.preventDefault();
  }, { passive: false });
  const end = () => { active = false; clearDir(); knob.style.left = '50%'; knob.style.top = '50%'; };
  base.addEventListener('touchend', end); base.addEventListener('touchcancel', end);
})();

// ── BLOCK HOTBAR (블록 선택 · 1~8키) ──────────────────────────────────────
function selectBlock(id) {
  selectedBlock = id;
  document.querySelectorAll('#blockbar .blockslot').forEach(s => {
    const sel = s.dataset.id === id;
    s.style.borderColor = sel ? '#fff' : '#333';
    s.style.boxShadow = sel ? '0 0 8px rgba(255,255,255,.6)' : 'none';
    s.style.transform = sel ? 'translateY(-4px)' : 'none';
  });
}
(function buildBlockBar() {
  const bar = document.createElement('div');
  bar.id = 'blockbar';
  bar.style.cssText = 'position:fixed;left:50%;bottom:58px;transform:translateX(-50%);display:none;gap:4px;z-index:20;padding:5px;background:rgba(0,0,0,.62);border:3px solid #555;';
  BLOCKS.forEach((b, i) => {
    const slot = document.createElement('div');
    slot.className = 'blockslot'; slot.dataset.id = b.id;
    slot.style.cssText = 'position:relative;width:42px;height:48px;display:flex;align-items:center;justify-content:center;border:2px solid #333;background:#1a1a1a;cursor:pointer;transition:transform .1s;';
    const cv = document.createElement('canvas'); cv.width = cv.height = 28; cv.style.cssText = 'image-rendering:pixelated;width:30px;height:30px;';
    const rep = b.id === 'grass' ? TEX.grassTop : b.id === 'log' ? TEX.logSide : TEX[b.id] || TEX.dirt;
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
    try { cx.drawImage(rep.image, 0, 0, 28, 28); } catch {}
    slot.appendChild(cv);
    const num = document.createElement('span');
    num.textContent = i + 1;
    num.style.cssText = 'position:absolute;top:1px;left:3px;font-size:9px;color:#fff;text-shadow:1px 1px 0 #000;';
    slot.appendChild(num);
    slot.onclick = () => selectBlock(b.id);
    bar.appendChild(slot);
  });
  document.body.appendChild(bar);
  window._blockbar = bar;
  selectBlock(selectedBlock);
})();

// ── EMOTE BAR (머리 위 반응 — 채팅 버블 재활용) ──────────────────────────
(function buildEmoteBar() {
  const bar = document.createElement('div');
  bar.id = 'emotebar';
  bar.style.cssText = 'position:fixed;right:10px;bottom:120px;display:none;gap:4px;z-index:20;';
  ['👍','❤️','😂','🎉','👋','🤔'].forEach(em => {
    const b = document.createElement('button');
    b.textContent = em;
    b.style.cssText = 'width:36px;height:36px;font-size:17px;background:rgba(0,0,0,.62);border:2px solid #555;cursor:pointer;';
    b.onmousedown = e => e.stopPropagation();
    b.onclick = () => { if (socket) socket.emit('chat', { msg: em }); };
    bar.appendChild(b);
  });
  document.body.appendChild(bar);
  window._emotebar = bar;
})();

// ── PHYSICS / TARGET HELPERS ──────────────────────────────────────────────
let vy = 0, onGround = true;
function groundHeightAt(x, z) {
  const rx = Math.round(x), rz = Math.round(z);
  let g = 0;
  for (let y = 0; y < 16; y++) if (blockMeshes[`${rx},${y},${rz}`]) g = Math.max(g, y + 1);
  return g;
}
// 조준 블록 하이라이트(테두리)
const hl = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
  new THREE.LineBasicMaterial({ color: 0x000000 })
);
hl.visible = false; scene.add(hl);
const hoverMouse = new THREE.Vector2(0, 0);
window.addEventListener('mousemove', e => { if (!firstPerson) { hoverMouse.x = (e.clientX / innerWidth) * 2 - 1; hoverMouse.y = -(e.clientY / innerHeight) * 2 + 1; } });
function updateHighlight() {
  if (!player || document.getElementById('hud').style.display === 'none') { hl.visible = false; return; }
  mouse.copy(firstPerson ? { x: 0, y: 0 } : hoverMouse);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children);
  if (hits.length && hits[0].distance <= 9 && hits[0].object.userData.isBlock) {
    const pt = hits[0].point, n = hits[0].face.normal;
    hl.position.set(Math.round(pt.x - n.x * .5), Math.floor(pt.y - n.y * .5) + 0.5, Math.round(pt.z - n.z * .5));
    hl.visible = true;
  } else hl.visible = false;
}

// ── SOUND FX (Web Audio 합성, 에셋 없음) ──────────────────────────────────
let muted = false;
function sfx(type) {
  if (muted) return;
  const ctx = audioListener.context; if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  if (type === 'place')      { o.type='square';   o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(90,t+0.1);  g.gain.setValueAtTime(0.07,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.12); o.start(t); o.stop(t+0.13); }
  else if (type === 'break') { o.type='sawtooth'; o.frequency.setValueAtTime(200,t); o.frequency.exponentialRampToValueAtTime(60,t+0.18); g.gain.setValueAtTime(0.08,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.2);  o.start(t); o.stop(t+0.21); }
  else if (type === 'jump')  { o.type='square';   o.frequency.setValueAtTime(330,t); o.frequency.exponentialRampToValueAtTime(560,t+0.12);g.gain.setValueAtTime(0.05,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.14); o.start(t); o.stop(t+0.15); }
  else if (type === 'step')  { o.type='sine';     o.frequency.setValueAtTime(85,t);  g.gain.setValueAtTime(0.025,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.08); o.start(t); o.stop(t+0.09); }
  else if (type === 'boom')  { o.type='sawtooth'; o.frequency.setValueAtTime(120,t); o.frequency.exponentialRampToValueAtTime(28,t+0.4); g.gain.setValueAtTime(0.18,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.45); o.start(t); o.stop(t+0.46); }
}

// 배경음악 (생성형 앰비언트 패드, 기본 OFF, B로 토글)
let bgmNodes = null;
function toggleBGM() {
  const ctx = audioListener.context; if (!ctx) return;
  if (bgmNodes) { bgmNodes.forEach(n => { try { n.stop && n.stop(); } catch {} try { n.disconnect(); } catch {} }); bgmNodes = null; toast('🎵 배경음악 끔'); return; }
  if (ctx.state === 'suspended') ctx.resume();
  const g = ctx.createGain(); g.gain.value = 0.035; g.connect(ctx.destination);
  const oscs = [130.81, 196.0, 261.63, 329.63].map((f, i) => {
    const o = ctx.createOscillator(); o.type = i === 3 ? 'triangle' : 'sine'; o.frequency.value = f;
    const og = ctx.createGain(); og.gain.value = i === 3 ? 0.35 : 1; o.connect(og); og.connect(g); o.start(); return o;
  });
  bgmNodes = [...oscs, g];
  toast('🎵 배경음악 켬 (B로 끄기)');
}

// ── BREAK PARTICLES ───────────────────────────────────────────────────────
const particles = [];
function spawnBreak(x, y, z) {
  const mesh = blockMeshes[`${x},${y},${z}`];
  const m = mesh ? (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) : LM(TEX.dirt);
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), m);
    p.position.set(x + (Math.random()-0.5), y + 0.5 + (Math.random()-0.5), z + (Math.random()-0.5));
    p.userData.v = new THREE.Vector3((Math.random()-0.5)*3, Math.random()*4+1.5, (Math.random()-0.5)*3);
    p.userData.life = 0.6; scene.add(p); particles.push(p);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.userData.life -= dt;
    if (p.userData.life <= 0) { scene.remove(p); p.geometry.dispose(); particles.splice(i, 1); continue; }
    p.userData.v.y -= 14 * dt;
    p.position.addScaledVector(p.userData.v, dt);
    p.scale.setScalar(Math.max(0.05, p.userData.life / 0.6));
  }
}

// ── 폭발 / 불꽃 / 카메라 흔들림 ────────────────────────────────────────────
let shakeAmt = 0;
function shake(a) { shakeAmt = Math.max(shakeAmt, a); }
function burst(x, y, z, color, n, spd, life) {
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ color }));
    p.position.set(x, y, z);
    p.userData.v = new THREE.Vector3((Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5)).normalize().multiplyScalar(spd * (0.5 + Math.random()));
    p.userData.life = life; scene.add(p); particles.push(p);
  }
}
function explodeTNT(x, y, z) {
  sfx('boom'); shake(0.6);
  burst(x, y + 0.5, z, 0xff7a1a, 26, 6, 0.55);
  burst(x, y + 0.5, z, 0x553322, 14, 4, 0.6);
  const R = 2;
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
    if (dx*dx + dy*dy + dz*dz > R*R + 1) continue;
    const k = `${x+dx},${y+dy},${z+dz}`;
    if (blockMeshes[k] && socket) socket.emit('break_block', { x: x+dx, y: y+dy, z: z+dz });
  }
}
function startFuse(x, y, z) { toast('💥 TNT 점화! (2.5초)'); setTimeout(() => explodeTNT(x, y, z), 2500); }
function firework() {
  if (!player) return;
  const cols = [0xff5555, 0x55ff88, 0x5599ff, 0xffdd44, 0xff66cc];
  burst(player.g.position.x, player.g.position.y + 9, player.g.position.z, cols[Math.floor(Math.random()*cols.length)], 30, 5, 0.9);
  sfx('jump'); toast('🎆 펑!');
}

// ── DAY/NIGHT ─────────────────────────────────────────────────────────────
let dayT = 1.2;
const SKY_DAY = new THREE.Color(0x87ceeb), SKY_NIGHT = new THREE.Color(0x0a1530);
const _sky = new THREE.Color();
const timeEl = document.createElement('span');
timeEl.style.cssText = 'color:#9fd6ff;font-size:11px;margin-left:6px;';
document.getElementById('topbar')?.appendChild(timeEl);
function updateDayNight(dt) {
  dayT += dt * 0.025;
  const day = (Math.sin(dayT) + 1) / 2;           // 0 밤 ~ 1 낮
  _sky.copy(SKY_NIGHT).lerp(SKY_DAY, day);
  if (raining) _sky.lerp(new THREE.Color(0x55606e), 0.5);   // 비 오면 잿빛
  renderer.setClearColor(_sky);
  scene.fog.color.copy(_sky);
  sun.intensity = (0.2 + day * 0.95) * (raining ? 0.55 : 1);
  ambient.intensity = (0.32 + day * 0.4) * (raining ? 0.75 : 1);
  sun.position.set(Math.cos(dayT) * 45, Math.max(6, Math.sin(dayT) * 45 + 8), 20);
  const frac = (dayT / (Math.PI * 2)) % 1, h = (Math.floor(frac * 24) + 6) % 24, m = Math.floor((frac * 24 * 60) % 60);
  timeEl.textContent = `${day > 0.5 ? '🌞' : '🌙'} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── RENDER LOOP ───────────────────────────────────────────────────────────
let lastT = performance.now(), frameN = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastT) / 1000, 0.05); lastT = now; frameN++;

  updateDayNight(dt);
  updateParticles(dt);
  for (const c of clouds) { c.position.x += dt * 1.2; if (c.position.x > 72) c.position.x = -72; }
  for (const a of animals) {
    a.t += dt;
    const tx = a.hx + Math.sin(a.t * 0.5 + a.phase) * 4, tz = a.hz + Math.cos(a.t * 0.37 + a.phase) * 4;
    const ddx = tx - a.g.position.x, ddz = tz - a.g.position.z;
    a.g.position.x += ddx * dt * 0.7; a.g.position.z += ddz * dt * 0.7;
    if (Math.abs(ddx) + Math.abs(ddz) > 0.01) a.g.rotation.y = Math.atan2(ddx, ddz);
    a.g.position.y = Math.abs(Math.sin(a.t * 6)) * 0.06;
  }
  if (raining && player) { rainGroup.position.set(player.g.position.x, 0, player.g.position.z); for (const d of drops) { d.position.y -= dt * 24; if (d.position.y < 0) d.position.y = 22; } }

  if (player) {
    const sprint = !!keys['Shift'];
    const speed = sprint ? 9 : 5;
    let ix = 0, iz = 0;
    if (keys['w'] || keys['ArrowUp'])    iz -= 1;
    if (keys['s'] || keys['ArrowDown'])  iz += 1;
    if (keys['a'] || keys['ArrowLeft'])  ix -= 1;
    if (keys['d'] || keys['ArrowRight']) ix += 1;
    const moving = ix !== 0 || iz !== 0;

    if (moving) {
      let mvx, mvz;
      if (firstPerson) {
        // 시점(yaw) 기준 전후좌우
        mvx = Math.sin(yaw) * -iz + Math.cos(yaw) * ix;
        mvz = Math.cos(yaw) * -iz - Math.sin(yaw) * ix;
        const l = Math.hypot(mvx, mvz) || 1; mvx /= l; mvz /= l;
        player.g.rotation.y = yaw;
      } else {
        const l = Math.hypot(ix, iz); mvx = ix / l; mvz = iz / l;
        player.g.rotation.y = Math.atan2(ix, iz);
      }
      player.g.position.x += mvx * speed * dt;
      player.g.position.z += mvz * speed * dt;
      player.phase += dt * (sprint ? 13 : 8);
      player.LA.rotation.x = Math.sin(player.phase) * 0.5; player.RA.rotation.x = -Math.sin(player.phase) * 0.5;
      player.LL.rotation.x = -Math.sin(player.phase) * 0.4; player.RL.rotation.x = Math.sin(player.phase) * 0.4;
    } else {
      player.LA.rotation.x *= 0.8; player.RA.rotation.x *= 0.8; player.LL.rotation.x *= 0.8; player.RL.rotation.x *= 0.8;
    }

    // 점프/중력/착지 — 또는 날기(크리에이티브)
    const gY = groundHeightAt(player.g.position.x, player.g.position.z);
    if (flying) {
      if (keys[' ']) player.g.position.y += 7 * dt;
      if (keys['Shift']) player.g.position.y -= 7 * dt;
      if (player.g.position.y < gY) player.g.position.y = gY;
      vy = 0; onGround = false;
    } else {
      if (onGround && keys[' ']) { vy = 7.2; onGround = false; sfx('jump'); }
      vy -= 23 * dt;
      player.g.position.y += vy * dt;
      if (player.g.position.y <= gY) {
        player.g.position.y = gY;
        const top = blockMeshes[`${Math.round(player.g.position.x)},${gY - 1},${Math.round(player.g.position.z)}`];
        if (top && top.userData.type === 'slime' && vy < -2) { vy = 12.5; onGround = false; sfx('jump'); }  // 점프대 튕김
        else { vy = 0; onGround = true; }
      } else onGround = false;
      if (moving && onGround && frameN % 18 === 0) sfx('step');
    }

    if (socket && frameN % 3 === 0) socket.emit('move', { x: player.g.position.x, y: player.g.position.y, z: player.g.position.z, ry: player.g.rotation.y });

    // 카메라 (1인칭 / 3인칭)
    if (firstPerson) {
      player.head.visible = false;
      const head = player.g.position.clone().add(new THREE.Vector3(0, 2.3, 0));
      camera.position.copy(head);
      camera.lookAt(head.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))));
    } else {
      player.head.visible = true;
      camera.position.lerp(player.g.position.clone().add(new THREE.Vector3(0, 9, 12)), 0.1);
      camera.lookAt(player.g.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
    }

    // 달리기 시 시야각(FOV) 살짝 넓힘 (질주감)
    const targetFov = (moving && sprint) ? 64 : 55;
    if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * 0.12; camera.updateProjectionMatrix(); }

    // 폭발 카메라 흔들림
    if (shakeAmt > 0.001) { camera.position.x += (Math.random()-0.5)*shakeAmt; camera.position.y += (Math.random()-0.5)*shakeAmt; camera.position.z += (Math.random()-0.5)*shakeAmt; shakeAmt *= 0.88; }

    document.getElementById('cx').textContent = Math.round(player.g.position.x);
    document.getElementById('cy').textContent = Math.round(player.g.position.y);
    document.getElementById('cz').textContent = Math.round(player.g.position.z);

    const px = player.g.position.x, pz = player.g.position.z;
    let room = '오픈 오피스';
    if (px > -10 && px < 0 && pz > -14 && pz < -5) room = '회의실 A';
    if (px > 0 && px < 10 && pz > -14 && pz < -5) room = '회의실 B';
    document.getElementById('room-lbl').textContent = room;

    // 수중 화면 효과 (머리가 물 블록 안일 때)
    const hk = `${Math.round(px)},${Math.floor(player.g.position.y + 1.6)},${Math.round(pz)}`;
    uwOverlay.style.display = (blockMeshes[hk] && blockMeshes[hk].userData.type === 'water') ? 'block' : 'none';

    if (firstPerson) player.tag.style.display = 'none'; else posTag(player.tag, headTop(player));
    if (player.bubble) posTag(player.bubble, headTop(player).add(new THREE.Vector3(0, 0.6, 0)));
    updateHighlight();
    if (frameN % 10 === 0) { drawMinimap(); updateVPanel(); }
  }

  Object.values(remotePlayers).forEach(r => {
    const dx = r.tx - r.g.position.x, dz = r.tz - r.g.position.z;
    const moving = Math.abs(dx) > 0.02 || Math.abs(dz) > 0.02;
    r.g.position.x += dx * dt * 12; r.g.position.z += dz * dt * 12;
    r.g.position.y += ((r.ty || 0) - r.g.position.y) * dt * 12; // 점프/높이 동기화
    r.g.rotation.y += (r.trY - r.g.rotation.y) * dt * 10;
    if (moving) {
      r.phase += dt * 8;
      r.LA.rotation.x = Math.sin(r.phase) * 0.5; r.RA.rotation.x = -Math.sin(r.phase) * 0.5;
      r.LL.rotation.x = -Math.sin(r.phase) * 0.4; r.RL.rotation.x = Math.sin(r.phase) * 0.4;
    } else {
      r.LA.rotation.x *= 0.8; r.RA.rotation.x *= 0.8; r.LL.rotation.x *= 0.8; r.RL.rotation.x *= 0.8;
    }
    posTag(r.tag, headTop(r));
    if (r.bubble) posTag(r.bubble, headTop(r).add(new THREE.Vector3(0, 0.6, 0)));
  });

  renderer.render(scene, camera);
}

// ── START ─────────────────────────────────────────────────────────────────
animate(performance.now());

}); // end DOMContentLoaded
