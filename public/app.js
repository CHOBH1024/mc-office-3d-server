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
scene.fog = new THREE.Fog(0x1a2b3c, 15, 80);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.domElement.id = 'cv';
document.body.insertBefore(renderer.domElement, document.body.firstChild);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xfffff0, 1.0);
sun.position.set(20, 40, 20); sun.castShadow = true;
scene.add(sun);

// ── MAP BUILDER ───────────────────────────────────────────────────────────
function colorTex(hex) {
  const c = document.createElement('canvas'); c.width = c.height = 4;
  const cx = c.getContext('2d'); cx.fillStyle = hex; cx.fillRect(0,0,4,4);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}
function mat(hex) { return new THREE.MeshLambertMaterial({ map: colorTex(hex) }); }
function addBox(w, h, d, m, x, y, z) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; scene.add(b); return b;
}

// Floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), mat('#5a5a5a'));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

// Office walls
addBox(40, 4, 1, mat('#888'), 0, 2, -15);
addBox(40, 4, 1, mat('#888'), 0, 2, 15);
addBox(1, 4, 30, mat('#888'), -20, 2, 0);
addBox(1, 4, 30, mat('#888'), 20, 2, 0);

// Desks
[[-8,0,-8],[-4,0,-8],[0,0,-8],[4,0,-8],[8,0,-8]].forEach(([x,,z]) => {
  addBox(3, 0.2, 1.5, mat('#86592d'), x, 1, z);
});

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
function placeBlockMesh(x, y, z) {
  const k = `${x},${y},${z}`; if (blockMeshes[k]) return;
  blockMeshes[k] = addBox(1, 1, 1, mat('#86592d'), x, y + 0.5, z);
}
function removeBlockMesh(x, y, z) {
  const k = `${x},${y},${z}`;
  if (blockMeshes[k]) { scene.remove(blockMeshes[k]); blockMeshes[k].geometry.dispose(); delete blockMeshes[k]; }
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
window.addEventListener('mousedown', e => {
  if (!player || document.getElementById('hud').style.display === 'none') return;
  if (e.target.closest('.mc-panel, .mc-btn, .glass-modal')) return;
  if (e.button !== 0 && e.button !== 2) return;
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children);
  if (!hits.length) return;
  const pt = hits[0].point, n = hits[0].face.normal;
  if (e.button === 0) {
    const bx = Math.round(pt.x - n.x * .5), by = Math.floor(pt.y - n.y * .5), bz = Math.round(pt.z - n.z * .5);
    if (socket) socket.emit('break_block', { x: bx, y: by, z: bz });
  } else {
    const bx = Math.round(pt.x + n.x * .5), by = Math.floor(pt.y + n.y * .5), bz = Math.round(pt.z + n.z * .5);
    if (by >= 0 && socket) socket.emit('place_block', { x: bx, y: by, z: bz, type: 'dirt' });
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
document.getElementById('btn-mic')?.addEventListener('click', () => {
  if (!localStream) return toast('먼저 카메라를 켜주세요.');
  const t = localStream.getAudioTracks()[0]; if (!t) return;
  t.enabled = !t.enabled;
  const btn = document.getElementById('btn-mic');
  btn.textContent = t.enabled ? '🎤 ON' : '🎤 마이크';
  btn.classList.toggle('on', t.enabled);
});

document.getElementById('btn-cam')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-cam');
  if (!camOn) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const vid = Object.assign(document.createElement('video'), { autoplay: true, muted: true });
      vid.srcObject = localStream;
      vid.onloadedmetadata = () => {
        const tex = new THREE.VideoTexture(vid);
        tex.minFilter = THREE.LinearFilter;
        if (player) player.facePlane.material = new THREE.MeshBasicMaterial({ map: tex });
      };
      camOn = true; btn.textContent = '📷 ON'; btn.classList.add('on');
      toast('카메라 연결됨');
      Object.keys(remotePlayers).forEach(id => startCamCall(id));
    } catch { toast('카메라 권한을 허용해주세요.'); }
  } else {
    localStream.getTracks().forEach(t => t.stop()); localStream = null;
    if (player) player.facePlane.material = new THREE.MeshBasicMaterial({ color: 0xffd080 });
    camOn = false; btn.textContent = '📷 카메라'; btn.classList.remove('on');
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
  Object.values(remotePlayers).forEach(r => { scene.remove(r.g); r.tag.remove(); if (r.bubble) r.bubble.remove(); });
  remotePlayers = {};
  document.getElementById('hud').style.display = 'none';
  document.getElementById('xhair').style.display = 'none';
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
  socket.on('player_joined', p => { addRemote(p); updateUCnt(); updateVPanel(); toast(`${p.name} 입장`); });
  socket.on('player_moved', d => {
    const r = remotePlayers[d.id];
    if (r) { r.tx = d.x; r.tz = d.z; r.trY = d.ry; }
  });
  socket.on('player_left', id => {
    const r = remotePlayers[id]; if (!r) return;
    scene.remove(r.g); r.tag.remove(); if (r.bubble) r.bubble.remove();
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
  socket.on('init_blocks', b => Object.keys(b).forEach(k => { const [x,y,z] = k.split(',').map(Number); placeBlockMesh(x,y,z); }));
  socket.on('block_placed', d => placeBlockMesh(d.x, d.y, d.z));
  socket.on('block_broken', d => removeBlockMesh(d.x, d.y, d.z));
  socket.on('draw', d => drawLine(d.x0, d.y0, d.x1, d.y1, d.color));
}

function addRemote(p) {
  const r = buildAvatar(p.color, p.name);
  r.g.position.set(p.x || 0, p.y || 0, p.z || 0);
  scene.add(r.g); remotePlayers[p.id] = r;
}

// ── WEBRTC HELPERS ────────────────────────────────────────────────────────
function createCamPeer(id) {
  const pc = new RTCPeerConnection(rtcConfig); camPeers[id] = pc;
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate && socket) socket.emit('webrtc_ice', { target: id, ice: e.candidate }); };
  pc.ontrack = e => {
    const r = remotePlayers[id]; if (!r) return;
    if (e.track.kind === 'video' && !r.vid) {
      const v = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true });
      v.srcObject = e.streams[0]; v.style.cssText = 'position:absolute;opacity:0;width:1px;height:1px;';
      document.body.appendChild(v); r.vid = v;
      v.onloadedmetadata = () => {
        const tex = new THREE.VideoTexture(v); tex.minFilter = THREE.LinearFilter;
        r.facePlane.material = new THREE.MeshBasicMaterial({ map: tex });
      };
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
document.addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT') { keys[e.key] = true; if (e.key === 't' || e.key === 'T') { e.preventDefault(); chatIn?.focus(); } } });
document.addEventListener('keyup', e => { keys[e.key] = false; });

// ── RENDER LOOP ───────────────────────────────────────────────────────────
let lastT = performance.now(), frameN = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastT) / 1000, 0.05); lastT = now; frameN++;

  if (player) {
    let dx = 0, dz = 0;
    if (keys['w'] || keys['ArrowUp'])    dz -= 1;
    if (keys['s'] || keys['ArrowDown'])  dz += 1;
    if (keys['a'] || keys['ArrowLeft'])  dx -= 1;
    if (keys['d'] || keys['ArrowRight']) dx += 1;

    const moving = dx !== 0 || dz !== 0;
    if (moving) {
      const len = Math.sqrt(dx * dx + dz * dz);
      player.g.position.x += (dx / len) * 5 * dt;
      player.g.position.z += (dz / len) * 5 * dt;
      player.g.rotation.y = Math.atan2(dx, dz);
      player.phase += dt * 8;
      player.g.position.y = Math.abs(Math.sin(player.phase)) * 0.07;
      player.LA.rotation.x = Math.sin(player.phase) * 0.5;
      player.RA.rotation.x = -Math.sin(player.phase) * 0.5;
      player.LL.rotation.x = -Math.sin(player.phase) * 0.4;
      player.RL.rotation.x = Math.sin(player.phase) * 0.4;
      if (socket && frameN % 3 === 0) socket.emit('move', { x: player.g.position.x, y: player.g.position.y, z: player.g.position.z, ry: player.g.rotation.y });
    } else {
      player.g.position.y *= 0.8;
      player.LA.rotation.x *= 0.8; player.RA.rotation.x *= 0.8;
      player.LL.rotation.x *= 0.8; player.RL.rotation.x *= 0.8;
    }

    // Camera follow
    const camTarget = player.g.position.clone().add(new THREE.Vector3(0, 9, 12));
    camera.position.lerp(camTarget, 0.07);
    camera.lookAt(player.g.position.clone().add(new THREE.Vector3(0, 1, 0)));

    // Coords HUD
    document.getElementById('cx').textContent = Math.round(player.g.position.x);
    document.getElementById('cy').textContent = Math.round(player.g.position.y);
    document.getElementById('cz').textContent = Math.round(player.g.position.z);

    // Room detection
    const px = player.g.position.x, pz = player.g.position.z;
    let room = '오픈 오피스';
    if (px > -10 && px < 0 && pz > -14 && pz < -5) room = '회의실 A';
    if (px > 0 && px < 10 && pz > -14 && pz < -5) room = '회의실 B';
    document.getElementById('room-lbl').textContent = room;

    // Name/bubble tags
    posTag(player.tag, headTop(player));
    if (player.bubble) posTag(player.bubble, headTop(player).add(new THREE.Vector3(0, 0.6, 0)));

    if (frameN % 10 === 0) { drawMinimap(); updateVPanel(); }
  }

  Object.values(remotePlayers).forEach(r => {
    const dx = r.tx - r.g.position.x, dz = r.tz - r.g.position.z;
    const moving = Math.abs(dx) > 0.02 || Math.abs(dz) > 0.02;
    r.g.position.x += dx * dt * 12; r.g.position.z += dz * dt * 12;
    r.g.rotation.y += (r.trY - r.g.rotation.y) * dt * 10;
    if (moving) {
      r.phase += dt * 8; r.g.position.y = Math.abs(Math.sin(r.phase)) * 0.07;
      r.LA.rotation.x = Math.sin(r.phase) * 0.5; r.RA.rotation.x = -Math.sin(r.phase) * 0.5;
      r.LL.rotation.x = -Math.sin(r.phase) * 0.4; r.RL.rotation.x = Math.sin(r.phase) * 0.4;
    } else {
      r.g.position.y *= 0.8;
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
