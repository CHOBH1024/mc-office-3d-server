// ── GLOBALS ──────────────────────────────────────────
let socket = null;
let player = null;
let remotePlayers = {};
// We will use relative path for Socket.io if deployed on Render (same origin).
// Or we fallback to the local/ngrok URL if running locally.
const BACKEND_URL = window.location.origin; 
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// WebRTC State
let localStream = null;
let camPeers = {}; 
let screenStream = null;
let screenPeers = {};

// ── UTILS ─────────────────────────────────────────────
function toast(msg) {
  const tw = document.getElementById('toast-wrap');
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg;
  tw.appendChild(d);
  setTimeout(() => { d.style.opacity='0'; setTimeout(()=>d.remove(),300); }, 3000);
}
function ntEl(name, color='#fff') {
  const tag = document.createElement('div');
  tag.className = 'name-tag';
  tag.textContent = name;
  if(color) tag.style.color = color;
  document.body.appendChild(tag);
  return tag;
}

// ── THREE.JS SETUP ────────────────────────────────────
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1a2b3c, 15, 60);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.1, 300);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'cv';
document.body.insertBefore(renderer.domElement, document.body.firstChild);

const audioListener = new THREE.AudioListener();
camera.add(audioListener);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
const sun = new THREE.DirectionalLight(0xfffff0, 1.0);
sun.position.set(20, 40, 20);
sun.castShadow = true;
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
scene.add(sun);

// ── ENVIRONMENT BUILDER ───────────────────────────────
function T(c) { const cv=document.createElement('canvas'); cv.width=cv.height=16; const cx=cv.getContext('2d'); cx.fillStyle=c; cx.fillRect(0,0,16,16); const t=new THREE.CanvasTexture(cv); t.magFilter=THREE.NearestFilter; return t; }
const M = (t) => new THREE.MeshLambertMaterial({ map: T(t) });

function box(w,h,d,m,x,y,z) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
  b.position.set(x,y,z); b.castShadow = true; b.receiveShadow = true;
  scene.add(b); return b;
}

// Floor
const floorGeo = new THREE.PlaneGeometry(100,100);
const floorMat = M('#606060');
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI/2; floor.receiveShadow = true;
scene.add(floor);

// Walls
const FW=40, FD=30;
box(FW,4,1, M('#aaaaaa'), 0,2,-FD/2); // N
box(FW,4,1, M('#aaaaaa'), 0,2,FD/2);  // S
box(1,4,FD, M('#aaaaaa'), -FW/2,2,0); // W
box(1,4,FD, M('#aaaaaa'), FW/2,2,0);  // E
// Rooms
box(10,4,0.5, M('#7d7d7d'), -10,2,-5); // Room A
box(10,4,0.5, M('#7d7d7d'), 10,2,-5);  // Room B

// ── AVATAR BUILDER ────────────────────────────────────
function buildAvatar(colorHex, name, isLocal=false) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: colorHex });
  const skin = new THREE.MeshLambertMaterial({ color: 0xffd080 });
  
  function part(w,h,d,m,x,y,z) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
    p.position.set(x,y,z); p.castShadow = true;
    g.add(p); return p;
  }
  
  part(0.8, 1.2, 0.4, mat, 0, 1.1, 0); // body
  const head = part(0.8, 0.8, 0.8, skin, 0, 2.1, 0); // head
  
  const faceGeo = new THREE.PlaneGeometry(0.8, 0.8);
  if(isLocal) {
    const uvs = faceGeo.attributes.uv.array;
    for(let i=0; i<uvs.length; i+=2) uvs[i] = 1 - uvs[i];
  }
  const facePlane = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ color: 0xffd080 }));
  facePlane.position.set(0, 0, 0.41);
  head.add(facePlane);

  const LA = part(0.3, 1.0, 0.3, skin, -0.6, 1.0, 0);
  const RA = part(0.3, 1.0, 0.3, skin, 0.6, 1.0, 0);
  const LL = part(0.38, 1.0, 0.38, mat, -0.21, 0.5, 0);
  const RL = part(0.38, 1.0, 0.38, mat, 0.21, 0.5, 0);

  const tag = ntEl(name, isLocal ? 'var(--green)' : '#fff');
  if(isLocal) tag.classList.add('me');

  return { g, head, facePlane, LA, RA, LL, RL, tag, phase:0, tx:0, tz:0, try:0, name, colorHex };
}

// ── BLOCKS & RAYCASTER ────────────────────────────────
let blockMeshes = {};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function placeBlockMesh(x,y,z, type) {
  const k = \`\${x},\${y},\${z}\`;
  if(blockMeshes[k]) return;
  blockMeshes[k] = box(1,1,1, M('#86592d'), x, y+0.5, z);
}
function removeBlockMesh(x,y,z) {
  const k = \`\${x},\${y},\${z}\`;
  if(blockMeshes[k]) { scene.remove(blockMeshes[k]); blockMeshes[k].geometry.dispose(); delete blockMeshes[k]; }
}

window.addEventListener('mousedown', e => {
  if(document.getElementById('hud').style.display === 'none') return;
  if(e.target.closest('.mc-panel') || e.target.closest('.mc-btn') || e.target.closest('.glass-modal')) return;
  
  if(e.button !== 0 && e.button !== 2) return;
  mouse.x = (e.clientX / window.innerWidth)*2-1;
  mouse.y = -(e.clientY / window.innerHeight)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);
  if(intersects.length > 0) {
    const pt = intersects[0].point; const n = intersects[0].face.normal;
    if(e.button === 0) {
      const bx = Math.round(pt.x - n.x*0.5), by = Math.floor(pt.y - n.y*0.5), bz = Math.round(pt.z - n.z*0.5);
      if(socket) socket.emit('break_block', {x:bx, y:by, z:bz});
    } else if(e.button === 2) {
      const bx = Math.round(pt.x + n.x*0.5), by = Math.floor(pt.y + n.y*0.5), bz = Math.round(pt.z + n.z*0.5);
      if(by >= 0 && socket) socket.emit('place_block', {x:bx, y:by, z:bz, type:'dirt'});
    }
  }
});

// ── LOADING ANIMATION ─────────────────────────────────
let pLoad = 0;
const ldInterval = setInterval(() => {
  pLoad += Math.random()*20;
  if(pLoad>100) pLoad=100;
  document.getElementById('ld-fill').style.width = pLoad+'%';
  if(pLoad>=100) {
    clearInterval(ldInterval);
    setTimeout(() => {
      document.getElementById('loading').style.opacity = '0';
      setTimeout(() => {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('login-ui').style.display = 'block';
        initColors();
      }, 500);
    }, 400);
  }
}, 100);

let myColor = '#226622';
function initColors() {
  const cr = document.getElementById('color-row');
  const colors = ['#226622','#222266','#662222','#666622','#226666','#662266'];
  colors.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'color-swatch' + (i===0?' sel':''); d.style.background = c;
    d.onclick = () => {
      cr.querySelectorAll('.color-swatch').forEach(el=>el.classList.remove('sel'));
      d.classList.add('sel'); myColor = c;
    };
    cr.appendChild(d);
  });
}

// ── UI LOGIC (Chat, HUD) ──────────────────────────────
const chatLog = document.getElementById('chat-log');
const chatIn = document.getElementById('chat-in');

function appendChat(who, msg, type) {
  const d = document.createElement('div');
  const cls = type==='me'?'msg-me':type==='npc'?'msg-npc':'msg-sys';
  d.innerHTML = type==='sys' ? \`<span class="\${cls}">▶ \${msg}</span>\` : \`<span class="\${cls}">&lt;\${who}&gt;</span> \${msg}\`;
  chatLog.appendChild(d); chatLog.scrollTop = chatLog.scrollHeight;
}
function showBubble(id, msg) {
  const target = id === socket.id ? player : remotePlayers[id];
  if(!target) return;
  if(target.bubble) target.bubble.remove();
  target.bubble = document.createElement('div');
  target.bubble.className = 'chat-bubble';
  target.bubble.textContent = msg;
  document.body.appendChild(target.bubble);
  setTimeout(() => { if(target.bubble) { target.bubble.remove(); target.bubble=null; } }, 4000);
}

document.getElementById('send-btn').addEventListener('click', () => {
  const t = chatIn.value.trim(); if(!t) return;
  if(socket) socket.emit('chat', { msg: t });
  chatIn.value='';
});
chatIn.addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('send-btn').click(); });

function updateVPanel() {
  const list = document.getElementById('vpanel-list');
  list.innerHTML = '';
  const rvals = Object.values(remotePlayers);
  if(rvals.length===0) { list.innerHTML = '<div class="vpanel-empty">접속자가 없습니다.</div>'; return; }
  
  rvals.forEach(r => {
    const slot = document.createElement('div'); slot.className = 'vslot';
    if(player && player.g.position.distanceTo(r.g.position) < 5) slot.classList.add('near');
    slot.innerHTML = \`<div class="vdot"></div><div class="vname">\${r.name}</div>\`;
    if(slot.classList.contains('near')) slot.innerHTML += \`<div class="vbadge">근처</div>\`;
    list.appendChild(slot);
  });
}

// Controls
let camOn=false, micOn=false;
const btnCam = document.getElementById('btn-cam'), btnMic = document.getElementById('btn-mic');

btnMic.addEventListener('click', () => {
  if(!localStream) return toast('먼저 카메라를 켜주세요.');
  const audioTrack = localStream.getAudioTracks()[0];
  if(audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    micOn = audioTrack.enabled;
    btnMic.textContent = micOn ? '🎤 ON' : '🎤 마이크';
    btnMic.classList.toggle('on', micOn);
  }
});

btnCam.addEventListener('click', async () => {
  if(!camOn) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const vid = document.createElement('video');
      vid.autoplay=true; vid.muted=true; vid.srcObject=localStream;
      vid.onloadedmetadata = () => {
        const tex = new THREE.VideoTexture(vid);
        tex.minFilter = THREE.LinearFilter;
        if(player) player.facePlane.material = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
      };
      camOn=true; btnCam.textContent='📷 ON'; btnCam.classList.add('on');
      toast('카메라가 연결되었습니다.');
      Object.keys(remotePlayers).forEach(async id => {
        const pc = createCamPeer(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', {target:id, sdp:offer});
      });
    } catch(e) { toast('카메라 권한을 허용해주세요.'); }
  } else {
    localStream.getTracks().forEach(t=>t.stop()); localStream=null;
    if(player) player.facePlane.material = new THREE.MeshBasicMaterial({ color: 0xffd080 });
    camOn=false; btnCam.textContent='📷 카메라'; btnCam.classList.remove('on');
    Object.values(camPeers).forEach(pc => pc.close()); camPeers={};
    toast('카메라를 껐습니다.');
  }
});

document.getElementById('btn-share').addEventListener('click', async () => {
  const btn = document.getElementById('btn-share');
  if(!screenStream) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStream.getVideoTracks()[0].onended = stopScreenShare;
      btn.textContent = '💻 공유 중'; btn.classList.add('on');
      Object.keys(remotePlayers).forEach(async id => {
        const pc = new RTCPeerConnection(rtcConfig);
        screenPeers[id] = pc;
        screenStream.getTracks().forEach(t => pc.addTrack(t, screenStream));
        pc.onicecandidate = e => { if(e.candidate) socket.emit('screen_ice', {target:id, ice:e.candidate}); };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('screen_offer', {target:id, sdp:offer});
      });
      if(socket) socket.emit('screen_share_start');
      toast('화면을 다른 사람들에게 공유합니다.');
    } catch(e) {}
  } else stopScreenShare();
});

function stopScreenShare() {
  if(!screenStream) return;
  screenStream.getTracks().forEach(t=>t.stop()); screenStream=null;
  const btn = document.getElementById('btn-share');
  btn.textContent='💻 화면공유'; btn.classList.remove('on');
  Object.values(screenPeers).forEach(pc=>pc.close()); screenPeers={};
  if(socket) socket.emit('screen_share_stop');
  toast('화면 공유가 중지되었습니다.');
}

document.getElementById('close-screen').addEventListener('click', () => {
  document.getElementById('screen-share-ui').style.display = 'none';
});

// Board
const bCanvas = document.getElementById('board-canvas');
const bCtx = bCanvas.getContext('2d');
let isDrawing = false, lastX=0, lastY=0;
let drawColor = '#000';

document.getElementById('btn-board').addEventListener('click', () => {
  document.getElementById('board-ui').style.display = 'flex';
  bCanvas.width = bCanvas.clientWidth; bCanvas.height = bCanvas.clientHeight;
});
document.getElementById('close-board').addEventListener('click', () => {
  document.getElementById('board-ui').style.display = 'none';
});
document.querySelectorAll('.board-color').forEach(el => {
  el.onclick = () => {
    document.querySelectorAll('.board-color').forEach(e=>e.classList.remove('sel'));
    el.classList.add('sel'); drawColor = el.style.background;
  };
});
bCanvas.addEventListener('mousedown', e => { isDrawing=true; lastX=e.offsetX; lastY=e.offsetY; });
window.addEventListener('mouseup', () => isDrawing=false);
bCanvas.addEventListener('mousemove', e => {
  if(!isDrawing) return;
  const nx=e.offsetX, ny=e.offsetY, w=bCanvas.width, h=bCanvas.height;
  drawLine(lastX/w, lastY/h, nx/w, ny/h, drawColor);
  if(socket) socket.emit('draw', {x0:lastX/w, y0:lastY/h, x1:nx/w, y1:ny/h, color:drawColor});
  lastX=nx; lastY=ny;
});
function drawLine(x0,y0,x1,y1,c) {
  const w=bCanvas.width, h=bCanvas.height;
  bCtx.beginPath(); bCtx.moveTo(x0*w,y0*h); bCtx.lineTo(x1*w,y1*h);
  bCtx.strokeStyle=c; bCtx.lineWidth=2; bCtx.stroke();
}

// Exit
document.getElementById('btn-exit').addEventListener('click', () => {
  if(socket) { socket.disconnect(); socket=null; }
  document.getElementById('login-ui').style.display='block';
  document.getElementById('hud').style.display='none';
  document.getElementById('xhair').style.display='none';
  if(player) { scene.remove(player.g); player.tag.remove(); player=null; }
  Object.values(remotePlayers).forEach(n=>{ scene.remove(n.g); n.tag.remove(); if(n.vid) n.vid.remove(); });
  remotePlayers = {}; chatLog.innerHTML='';
  document.getElementById('screen-share-ui').style.display = 'none';
  document.getElementById('board-ui').style.display = 'none';
  if(localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
  if(screenStream) { screenStream.getTracks().forEach(t=>t.stop()); screenStream=null; }
  toast('접속을 종료했습니다.');
});


// ── NETWORKING & WEBRTC ───────────────────────────────
document.getElementById('login-btn').addEventListener('click', () => {
  const name = document.getElementById('login-name').value.trim();
  if(!name) return toast('이름을 입력하세요!');
  
  document.getElementById('login-ui').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  document.getElementById('xhair').style.display = 'block';
  
  const cHex = parseInt(myColor.replace('#','0x'));
  player = buildAvatar(cHex, name, true);
  scene.add(player.g);
  
  document.getElementById('net-dot').className = 'dot';
  
  socket = io(BACKEND_URL, {
    transports: ['websocket', 'polling'],
    extraHeaders: { "ngrok-skip-browser-warning": "1" }
  });
  
  socket.on('connect', () => {
    socket.emit('join', { name, color: cHex });
  });

  socket.on('connect_error', () => {
    document.getElementById('net-dot').className = 'dot off';
    toast('서버 연결 실패');
  });

  socket.on('init_players', (players) => {
    Object.values(players).forEach(p => { if(p.id !== socket.id) addRemotePlayer(p); });
    document.getElementById('ucnt').textContent = \`\${Object.keys(players).length}명 접속\`;
    updateVPanel();
  });
  
  socket.on('player_joined', (p) => {
    addRemotePlayer(p);
    document.getElementById('ucnt').textContent = \`\${Object.keys(remotePlayers).length + 1}명 접속\`;
    updateVPanel(); toast(\`\${p.name} 님이 참가했습니다.\`);
  });
  
  socket.on('player_moved', (data) => {
    const r = remotePlayers[data.id];
    if(r) { r.tx = data.x; r.tz = data.z; r.try = data.ry; }
  });
  
  socket.on('chat', (data) => {
    if(data.type==='sys') appendChat(null, data.msg, 'sys');
    else { appendChat(data.who, data.msg, data.id===socket.id?'me':'npc'); showBubble(data.id, data.msg); }
  });
  
  socket.on('player_left', (id) => {
    const r = remotePlayers[id];
    if(r) {
      scene.remove(r.g); r.tag.remove();
      if(r.bubble) r.bubble.remove(); if(r.vid) r.vid.remove();
      toast(\`\${r.name} 님이 나갔습니다.\`);
      delete remotePlayers[id];
      document.getElementById('ucnt').textContent = \`\${Object.keys(remotePlayers).length + 1}명 접속\`;
      updateVPanel();
    }
    if(camPeers[id]) { camPeers[id].close(); delete camPeers[id]; }
    if(screenPeers[id]) { screenPeers[id].close(); delete screenPeers[id]; }
  });

  // WebRTC - Camera
  socket.on('webrtc_offer', async (data) => {
    const pc = createCamPeer(data.source);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { target: data.source, sdp: answer });
  });
  socket.on('webrtc_answer', async (data) => { if(camPeers[data.source]) await camPeers[data.source].setRemoteDescription(new RTCSessionDescription(data.sdp)); });
  socket.on('webrtc_ice', async (data) => { if(camPeers[data.source] && data.ice) await camPeers[data.source].addIceCandidate(new RTCIceCandidate(data.ice)); });

  // WebRTC - Screen
  socket.on('screen_offer', async (data) => {
    const pc = new RTCPeerConnection(rtcConfig);
    screenPeers[data.source] = pc;
    pc.onicecandidate = e => { if(e.candidate) socket.emit('screen_ice', {target:data.source, ice:e.candidate}); };
    pc.ontrack = e => {
      document.getElementById('screen-share-vid').srcObject = e.streams[0];
      document.getElementById('screen-share-ui').style.display = 'flex';
      toast('누군가 화면 공유를 시작했습니다.');
    };
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('screen_answer', {target:data.source, sdp:answer});
  });
  socket.on('screen_answer', async (data) => { if(screenPeers[data.source]) await screenPeers[data.source].setRemoteDescription(new RTCSessionDescription(data.sdp)); });
  socket.on('screen_ice', async (data) => { if(screenPeers[data.source] && data.ice) await screenPeers[data.source].addIceCandidate(new RTCIceCandidate(data.ice)); });
  socket.on('screen_share_stop', () => { document.getElementById('screen-share-ui').style.display='none'; document.getElementById('screen-share-vid').srcObject=null; });

  // Blocks & Draw
  socket.on('init_blocks', (b) => Object.keys(b).forEach(k => { const [x,y,z]=k.split(',').map(Number); placeBlockMesh(x,y,z,b[k].type); }));
  socket.on('block_placed', (d) => placeBlockMesh(d.x, d.y, d.z, d.type));
  socket.on('block_broken', (d) => removeBlockMesh(d.x, d.y, d.z));
  socket.on('draw', d => drawLine(d.x0, d.y0, d.x1, d.y1, d.color));
});

function createCamPeer(id) {
  const pc = new RTCPeerConnection(rtcConfig);
  camPeers[id] = pc;
  if(localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if(e.candidate) socket.emit('webrtc_ice', {target:id, ice:e.candidate}); };
  pc.ontrack = e => {
    const r = remotePlayers[id]; if(!r) return;
    if(e.track.kind==='audio' && !r.hasAudio) {
      r.hasAudio=true; const audio = new THREE.PositionalAudio(audioListener);
      const source = audioListener.context.createMediaStreamSource(e.streams[0]);
      audio.setNodeSource(source); audio.setRefDistance(2); r.g.add(audio);
    }
    if(e.track.kind==='video' && !r.vid) {
      const vid = document.createElement('video');
      vid.autoplay=true; vid.playsInline=true; vid.srcObject=e.streams[0];
      vid.style.cssText='width:1px;height:1px;position:absolute;opacity:0;pointer-events:none;';
      document.body.appendChild(vid); r.vid=vid;
      vid.onloadedmetadata = () => {
        const tex = new THREE.VideoTexture(vid); tex.minFilter = THREE.LinearFilter;
        r.facePlane.material = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
      };
    }
  };
  return pc;
}

function addRemotePlayer(p) {
  const r = buildAvatar(p.color, p.name);
  r.g.position.set(p.x, p.y, p.z); scene.add(r.g);
  remotePlayers[p.id] = r;
}

// ── RENDER LOOP & PHYSICS ─────────────────────────────
const keys = {};
document.addEventListener('keydown', e => { if(e.target.tagName !== 'INPUT') keys[e.key]=true; });
document.addEventListener('keyup', e => { keys[e.key]=false; });

const _wp = new THREE.Vector3();
function getWorldTop(m) { m.getWorldPosition(_wp); _wp.y+=0.6; return _wp.clone(); }

function posTag(el, pos) {
  if(!el) return;
  const p = pos.clone().project(camera);
  const hw=window.innerWidth/2, hh=window.innerHeight/2;
  if(p.z>1) { el.style.display='none'; return; }
  el.style.display='block';
  el.style.left = (p.x*hw + hw) + 'px';
  el.style.top  = (-p.y*hh + hh) + 'px';
}

function drawMinimap() {
  const mm = document.getElementById('mm');
  if(!mm || !player) return;
  const ctx = mm.getContext('2d');
  ctx.clearRect(0,0,148,148);
  ctx.fillStyle='#55ff55'; ctx.fillRect(74-2,74-2,4,4);
  Object.values(remotePlayers).forEach(r => {
    ctx.fillStyle='#ffff55';
    ctx.fillRect(74+(r.g.position.x - player.g.position.x)*2 -1, 74+(r.g.position.z - player.g.position.z)*2 -1, 2, 2);
  });
}

let lastT = performance.now();
let frameCount = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now-lastT)/1000, 0.05); lastT=now;

  if(player) {
    let dx=0, dz=0;
    if(keys['w']||keys['ArrowUp']) dz-=1; if(keys['s']||keys['ArrowDown']) dz+=1;
    if(keys['a']||keys['ArrowLeft']) dx-=1; if(keys['d']||keys['ArrowRight']) dx+=1;
    if(dx!==0||dz!==0) {
      const len=Math.sqrt(dx*dx+dz*dz);
      player.g.position.x += dx/len*5*dt; player.g.position.z += dz/len*5*dt;
      player.g.rotation.y = Math.atan2(dx,dz);
      player.phase += dt*8;
      player.g.position.y = Math.abs(Math.sin(player.phase))*0.07;
      player.LA.rotation.x = Math.sin(player.phase)*0.5; player.RA.rotation.x = -Math.sin(player.phase)*0.5;
      player.LL.rotation.x = -Math.sin(player.phase)*0.4; player.RL.rotation.x = Math.sin(player.phase)*0.4;
      if(socket) socket.emit('move', {x:player.g.position.x, y:player.g.position.y, z:player.g.position.z, ry:player.g.rotation.y});
    } else {
      player.g.position.y *= 0.85; player.LA.rotation.x*=0.85; player.RA.rotation.x*=0.85; player.LL.rotation.x*=0.85; player.RL.rotation.x*=0.85;
    }
    camera.position.lerp(player.g.position.clone().add(new THREE.Vector3(0,9,11)), 0.07);
    camera.lookAt(player.g.position.clone().add(new THREE.Vector3(0,1,0)));
    
    // UI Updates
    document.getElementById('cx').textContent=Math.round(player.g.position.x); document.getElementById('cy').textContent=Math.round(player.g.position.y); document.getElementById('cz').textContent=Math.round(player.g.position.z);
    
    // Rooms
    let curRoom = '오픈 오피스';
    if(player.g.position.x>-10 && player.g.position.x<0 && player.g.position.z>-5 && player.g.position.z<0) curRoom='회의실 A';
    if(player.g.position.x>0 && player.g.position.x<10 && player.g.position.z>-5 && player.g.position.z<0) curRoom='회의실 B';
    document.getElementById('room-lbl').textContent = curRoom;

    posTag(player.tag, getWorldTop(player.head));
    if(player.bubble) posTag(player.bubble, getWorldTop(player.head).add(new THREE.Vector3(0,0.5,0)));
    drawMinimap();

    frameCount++;
    if(frameCount % 10 === 0) updateVPanel(); // 10프레임마다 근처 감지 업데이트
  }

  Object.values(remotePlayers).forEach(n => {
    const dx=n.tx-n.g.position.x, dz=n.tz-n.g.position.z;
    if(Math.abs(dx)>0.05 || Math.abs(dz)>0.05) {
      n.g.position.x+=dx*dt*10; n.g.position.z+=dz*dt*10; n.g.rotation.y+=(n.try-n.g.rotation.y)*dt*10;
      n.phase+=dt*8; n.g.position.y=Math.abs(Math.sin(n.phase))*0.07;
      n.LA.rotation.x=Math.sin(n.phase)*0.5; n.RA.rotation.x=-Math.sin(n.phase)*0.5;
      n.LL.rotation.x=-Math.sin(n.phase)*0.4; n.RL.rotation.x=Math.sin(n.phase)*0.4;
    } else {
      n.g.position.y*=0.85; n.LA.rotation.x*=0.85; n.RA.rotation.x*=0.85; n.LL.rotation.x*=0.85; n.RL.rotation.x*=0.85;
    }
    posTag(n.tag, getWorldTop(n.head));
    if(n.bubble) posTag(n.bubble, getWorldTop(n.head).add(new THREE.Vector3(0,0.5,0)));
  });

  renderer.render(scene, camera);
}
