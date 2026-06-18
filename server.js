const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 플레이어 및 블록 상태
const players = {};
let blocks = {};

// 헬스체크 (Render 용)
app.get('/health', (_req, res) => {
  res.json({ ok: true, players: Object.keys(players).length });
});

// 전역 에러 핸들러
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

io.on('connection', (socket) => {
  console.log('접속:', socket.id);

  socket.on('join', (data) => {
    if (!data || !data.name) return;
    console.log(`참가: ${data.name} (${socket.id})`);
    players[socket.id] = {
      id: socket.id, name: data.name,
      color: data.color || 0x226622,
      x: 0, y: 0, z: 5, ry: 0
    };
    socket.emit('init_players', players);
    socket.emit('init_blocks', blocks);
    socket.broadcast.emit('player_joined', players[socket.id]);
    io.emit('chat', { type: 'sys', msg: `${data.name} 님이 입장했습니다.` });
  });

  socket.on('move', (data) => {
    if (!players[socket.id] || !data) return;
    players[socket.id].x = data.x;
    players[socket.id].y = data.y;
    players[socket.id].z = data.z;
    players[socket.id].ry = data.ry;
    socket.broadcast.emit('player_moved', { id: socket.id, x: data.x, y: data.y, z: data.z, ry: data.ry });
  });

  socket.on('chat', (data) => {
    if (!players[socket.id] || !data) return;
    io.emit('chat', { type: 'user', id: socket.id, who: players[socket.id].name, msg: data.msg });
  });

  // WebRTC - Camera
  socket.on('webrtc_offer',  (d) => { if (d && d.target) socket.to(d.target).emit('webrtc_offer',  { source: socket.id, sdp: d.sdp }); });
  socket.on('webrtc_answer', (d) => { if (d && d.target) socket.to(d.target).emit('webrtc_answer', { source: socket.id, sdp: d.sdp }); });
  socket.on('webrtc_ice',    (d) => { if (d && d.target) socket.to(d.target).emit('webrtc_ice',    { source: socket.id, ice: d.ice }); });

  // WebRTC - Screen Share
  socket.on('screen_offer',  (d) => { if (d && d.target) socket.to(d.target).emit('screen_offer',  { source: socket.id, sdp: d.sdp }); });
  socket.on('screen_answer', (d) => { if (d && d.target) socket.to(d.target).emit('screen_answer', { source: socket.id, sdp: d.sdp }); });
  socket.on('screen_ice',    (d) => { if (d && d.target) socket.to(d.target).emit('screen_ice',    { source: socket.id, ice: d.ice }); });
  socket.on('screen_share_start', () => io.emit('screen_share_start', socket.id));
  socket.on('screen_share_stop',  () => io.emit('screen_share_stop',  socket.id));

  // Whiteboard
  socket.on('draw', (d) => { if (d) socket.broadcast.emit('draw', d); });

  // Blocks
  socket.on('place_block', (d) => {
    if (!d) return;
    const key = `${d.x},${d.y},${d.z}`;
    blocks[key] = { type: d.type || 'dirt' };
    io.emit('block_placed', d);
  });
  socket.on('break_block', (d) => {
    if (!d) return;
    delete blocks[`${d.x},${d.y},${d.z}`];
    io.emit('block_broken', d);
  });

  socket.on('disconnect', () => {
    console.log('퇴장:', socket.id);
    if (players[socket.id]) {
      const name = players[socket.id].name;
      delete players[socket.id];
      io.emit('player_left', socket.id);
      io.emit('chat', { type: 'sys', msg: `${name} 님이 퇴장했습니다.` });
    }
  });
});

// Heartbeat — 30초마다 로그 출력 (프로세스 유지)
setInterval(() => {
  const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  console.log(`[heartbeat] 접속자: ${Object.keys(players).length}명 | 메모리: ${mem}MB`);
}, 30000);

const PORT = process.env.PORT || 3050;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
