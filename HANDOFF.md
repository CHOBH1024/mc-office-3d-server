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

## Claude 인수 후 작업 (2026-06-18) — 전부 완료·배포됨
- [x] 🎤 마이크 단독 활성화 (카메라 없이도)
- [x] 🔊 원격 음성 공간 음향(PositionalAudio, 거리별 볼륨)
- [x] 🐢 late-joiner 동기화 (내가 cam/share 켠 뒤 들어온 사람에게도 전송)
- [x] 📱 모바일 터치 조이스틱
- [x] vercel(mc-office-3d) → onrender 리다이렉트 (mc-office-deploy/index.html, deploy-mc-office.js sourceDir 변경)
- [x] GitHub push → Render 재배포 검증(PositionalAudio 서빙 확인), vercel 리다이렉트 검증

## 2026-06-18 마인크래프트화 라운드 (기능·조작·게임성 강화)
- [x] 픽셀 텍스처(잔디/흙/돌/조약돌/판자/통나무/벽돌/유리/잎/모래) — 단색 → 진짜 마크 텍스처
- [x] 월드 재구성: 잔디 평야 + 조약돌 외벽(타일 큰박스, 성능) + 나무 5그루 + 잔디 언덕
- [x] 블록 핫바 8종(1~8키/클릭 선택, 텍스처 미리보기), 선택 블록으로 설치(서버 type 동기화)
- [x] 점프(Space)+중력+블록 위 착지(쌓고 올라가기), 달리기(Shift)
- [x] 1인칭 전환(V/🔭버튼, 포인터락 마우스 시점, ESC 해제) ↔ 3인칭, 시점기준 이동
- [x] 조준 블록 하이라이트(테두리), 도달거리 9 제한
- [x] 원격 플레이어 Y(점프) 동기화
- ⚠️ 1인칭은 포인터락 지원(PC)에서만. 모바일은 조이스틱+3인칭.

## 2026-06-18 마인크래프트화 라운드 2 (분위기·게임필)
- [x] 낮/밤 사이클(하늘색·태양·앰비언트·안개 변화, 태양 궤도)
- [x] 효과음(Web Audio 합성, 에셋無): 블록 설치/파괴/점프/발소리. M키 음소거
- [x] 발광석(glow) 블록 추가 — emissive, 밤에 빛남. 핫바 9칸(1~9키)
- [x] 블록 파괴 파티클(블록 텍스처 조각 튐 + 중력 + 페이드)
- [x] 달리기 시 FOV 살짝 넓힘(질주감)

## 2026-06-18 마인크래프트화 라운드 3 (월드·소셜·크리에이티브)
- [x] 이모트 바(👍❤️😂🎉👋🤔 → 머리 위 버블, 채팅 이벤트 재활용, 서버 변경無)
- [x] 떠다니는 구름 14개
- [x] 물·용암 블록 추가(핫바 11종, 1~9 + 0키 / 용암은 클릭). 물=반투명, 용암=emissive
- [x] 크리에이티브 날기 모드(F) — Space 상승·Shift 하강, 중력 무시
- [x] 미니맵에 설치된 블록(갈색 점) 표시

## 배포 메모
- Render 새 코드 반영: `git push origin master` → render.yaml autoDeploy. 검증: `curl .../app.js | grep PositionalAudio`
- vercel 리다이렉트 재배포: `node scratch/deploy-mc-office.js` (sourceDir=mc-office-deploy)
- ⚠️ deploy-mc-office.js·deploy-sinang-inside.js 등에 Vercel 토큰이 평문 — 저장소 커밋 금지(scratch 로컬 전용)

## 주의
- localStream은 단일 스트림. cam↔mic 상호작용 시 피어 누수 주의(createCamPeer에서 기존 피어 close).
- Render 무료는 15분 미사용 시 슬립 → 첫 접속 지연.
