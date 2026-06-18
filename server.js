const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 정적 파일 제공 (public 폴더 내의 index.html 등을 서빙)
app.use(express.static(path.join(__dirname, 'public')));

// 헬스체크 (Render 호스팅 상태 확인용)
app.get('/health', (_req, res) => res.json({ ok: true, players: Object.keys(players).length }));

// 플레이어들의 상태를 저장할 객체
const players = {};
let blocks = {};

io.on('connection', (socket) => {
  console.log('클라이언트 접속:', socket.id);

  // 플레이어 입장
  socket.on('join', (data) => {
    console.log(`플레이어 참가: ${data.name} (${socket.id})`);
    
    players[socket.id] = {
      id: socket.id,
      name: data.name,
      color: data.color || 0x226622,
      x: data.x || 0,
      y: data.y || 0,
      z: data.z || 0,
      ry: data.ry || 0, // rotation Y
      phase: Math.random() * Math.PI * 2 // 애니메이션 위상 오프셋
    };

    // 새로 접속한 사람에게 현재 접속 중인 모든 플레이어 정보 전송
    socket.emit('init_players', players);
    socket.emit('init_blocks', blocks);

    // 다른 모든 사람에게 새 플레이어 입장 알림
    socket.broadcast.emit('player_joined', players[socket.id]);
    
    // 시스템 메시지 브로드캐스트
    io.emit('chat', {
      type: 'sys',
      msg: `${data.name} 님이 입장했습니다.`
    });
  });

  // 플레이어 이동 (위치 동기화)
  socket.on('move', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].ry = data.ry;
      
      // 나를 제외한 다른 플레이어들에게 내 위치 브로드캐스트
      socket.broadcast.emit('player_moved', {
        id: socket.id,
        x: data.x,
        y: data.y,
        z: data.z,
        ry: data.ry
      });
    }
  });

  // 채팅 메시지
  // WebRTC Signaling
  socket.on('webrtc_offer', (data) => {
    socket.to(data.target).emit('webrtc_offer', { source: socket.id, sdp: data.sdp });
  });
  socket.on('webrtc_answer', (data) => {
    socket.to(data.target).emit('webrtc_answer', { source: socket.id, sdp: data.sdp });
  });
  socket.on('webrtc_ice', (data) => {
    socket.to(data.target).emit('webrtc_ice', { source: socket.id, ice: data.ice });
  });

  // Sandbox Blocks
  socket.on('place_block', (data) => {
    const key = `${data.x},${data.y},${data.z}`;
    blocks[key] = { type: data.type };
    io.emit('block_placed', data);
  });
  socket.on('break_block', (data) => {
    const key = `${data.x},${data.y},${data.z}`;
    delete blocks[key];
    io.emit('block_broken', data);
  });

  socket.on('screen_offer', (data) => { data.source = socket.id; socket.to(data.target).emit('screen_offer', data); });
  socket.on('screen_answer', (data) => { data.source = socket.id; socket.to(data.target).emit('screen_answer', data); });
  socket.on('screen_ice', (data) => { data.source = socket.id; socket.to(data.target).emit('screen_ice', data); });
  socket.on('screen_share_start', () => io.emit('screen_share_start', socket.id));
  socket.on('screen_share_stop', () => io.emit('screen_share_stop', socket.id));
  socket.on('draw', (data) => socket.broadcast.emit('draw', data));
  socket.on('chat', (data) => {
    if (players[socket.id]) {
      io.emit('chat', {
        type: 'user',
        id: socket.id,
        who: players[socket.id].name,
        msg: data.msg
      });
    }
  });

  // 플레이어 퇴장
  socket.on('disconnect', () => {
    console.log('클라이언트 접속 해제:', socket.id);
    if (players[socket.id]) {
      const name = players[socket.id].name;
      delete players[socket.id];
      
      // 다른 사람들에게 퇴장 알림
      io.emit('player_left', socket.id);
      io.emit('chat', {
        type: 'sys',
        msg: `${name} 님이 퇴장했습니다.`
      });
    }
  });
});

const PORT = process.env.PORT || 3050;
server.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
