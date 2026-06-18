# 🔄 Agent Handoff State — mc-office (메타버스 오피스)

> ⚠️ **소유권: Claude Code (2026-06-18부터)**
> 뻠뻠 지시로 Claude Code가 이 프로젝트를 인수했습니다.
> **Antigravity는 이 프로젝트(mc-office-server / mc-office-deploy) 파일을 수정하지 마세요.**
> 두 에이전트가 같은 파일을 동시 편집해 충돌·버그가 반복됐기에 단일 소유권으로 전환합니다.

- **작업 주도권**: Antigravity ➡️ Claude Code
- **GitHub**: https://github.com/CHOBH1024/mc-office-3d-server.git (push → Render 자동배포)
- **라이브(진짜 앱)**: https://mc-office.onrender.com  (서버가 클라이언트까지 같은 출처로 서빙)
- **옛 URL**: https://mc-office-3d.vercel.app → Render 앱으로 리다이렉트 예정 (vercel `mc-office-deploy/` + `scratch/deploy-mc-office.js`)

## 구조
- `server.js` — Express + socket.io (이동/채팅/WebRTC 시그널링/블록 동기화) + `/health` + CORS. public/ 서빙.
- `public/index.html` + `style.css` + `app.js` — 예쁜 Minecraft 테마 + 진짜 멀티(같은 출처 `io(window.location.origin)`).
- 배포: GitHub push → Render(render.yaml, npm start) 자동.

## Claude 인수 후 작업 (2026-06-18)
- [ ] 🎤 마이크 단독 활성화 (카메라 없이도)
- [ ] 🔊 원격 음성 공간 음향(PositionalAudio, 거리별 볼륨)
- [ ] 🐢 late-joiner 동기화 (내가 cam/share 켠 뒤 들어온 사람에게도 전송)
- [ ] 📱 모바일 터치 조이스틱
- [ ] vercel(mc-office-3d) → onrender 리다이렉트

## 주의
- localStream은 단일 스트림. cam↔mic 상호작용 시 피어 누수 주의(createCamPeer에서 기존 피어 close).
- Render 무료는 15분 미사용 시 슬립 → 첫 접속 지연.
