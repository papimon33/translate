/* 실시간(WebSocket) 진입 — 업그레이드 인증·연결 분기(뷰어/호스트)·하트비트. index.js 가 attachRealtime(server) 로 붙인다. */
import { WebSocketServer, WebSocket } from 'ws';
import { TARGET_LANG } from '../config.js';
import { authFromReq, currentUser, viewerTokenValid, permsOf, canUseSession } from '../auth/index.js';
import { getSession } from '../store/sessions.js';
import { logErr } from '../metrics.js';
import { rooms } from './rooms.js';
import { handleViewer } from './viewer.js';
import { handleHost } from './host.js';

/* ------------------------------------------------------------------ */
/*  WebSocket 라우팅                                                     */
/*   /ws/host?session=ID&src=mic|system&out=ko                          */
/*   /ws/viewer?session=ID                                              */
/* ------------------------------------------------------------------ */
export const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 }); // 1MB — 무인증 뷰어의 초대형 프레임 메모리 스파이크 방지

// 하트비트: 절전·망 단절로 FIN 없이 사라진 소켓을 주기 감지·정리.
// 없으면 죽은 연결이 데스크 active 표시와 room 을 영구 점유한다.
const HEARTBEAT_MS = 30000;

// 번역 중인 호스트 연결의 로그인 토큰(jti) — 다른 기기 로그인으로 토큰이 끊겨도, 진행 중인 번역은 중지할 때까지 이어진다.
// 같은 세션에 그 토큰의 연결이 살아 있거나 끊긴 지 2분 안(망 끊김 재접속·2채널 두 번째 연결)일 때만 통과시킨다 — 새 번역 시작은 막힌다.
const HOST_GRACE_MS = 2 * 60 * 1000;
const hostJti = new Map(); // jti -> { sessionId, open, closedAt }
function hostGraceOk(jti, sessionId) {
  const r = hostJti.get(jti);
  return !!r && r.sessionId === sessionId && (r.open > 0 || Date.now() - r.closedAt < HOST_GRACE_MS);
}
function trackHostJti(ws, jti) {
  if (!jti) return;
  for (const [k, r] of hostJti) if (!r.open && Date.now() - r.closedAt > HOST_GRACE_MS) hostJti.delete(k); // 오래된 기록 정리
  const r = hostJti.get(jti) || { sessionId: ws._session, open: 0, closedAt: 0 };
  r.sessionId = ws._session; r.open++;
  hostJti.set(jti, r);
  ws.on('close', () => { r.open--; r.closedAt = Date.now(); });
}
// 뷰어 생존 신호(앱 메시지) — 브라우저는 위 프로토콜 ping 을 JS 에 보여 주지 않아, 망 전환·절전 복귀 후 '열린 채 죽은' 연결을
// 뷰어가 스스로 알아챌 수 없다(호스트는 번역 중인데 뷰어 화면만 멈춤). 15초마다 보내고 뷰어는 35초 무수신이면 새로 연결한다.
const VIEWER_HB_MS = Number(process.env.VIEWER_HB_MS) || 15000; // 테스트에서만 짧게
const VIEWER_HB_MSG = JSON.stringify({ type: 'hb' });

/* HTTP 서버에 WS 업그레이드·연결 처리·하트비트 타이머를 붙인다(구 server.js 와 같은 시점 — 라우트 등록 뒤, listen 전) */
export function attachRealtime(server) {
  server.on('upgrade', (req, socket, head) => {
    try {
    const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = searchParams.get('session') || '';
    const sess = getSession(sessionId);
    const isDesk = sess?.pipeline === 'desk';
    const hostAuth = pathname === '/ws/host'
      ? authFromReq(req, { grace: (t, reason) => reason === 'replaced' && hostGraceOk(t.jti, sessionId) })
      : null;
    const hostUser = hostAuth ? hostAuth.user : null;
    if (pathname === '/ws/host' && !hostUser) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    // 안내데스크 운영은 그 데스크의 주인(안내데스크 권한 필요) 또는 관리자만
    if (pathname === '/ws/host' && isDesk && !canUseSession(hostUser, sess)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    // 공개 뷰어: 유효 토큰(QR 에 포함) 또는 로그인 사용자만. id 열거로 무단 접속하는 것을 막는다(안내데스크는 로그인만으론 안 되고 주인·관리자만).
    if (pathname === '/ws/viewer' && !viewerTokenValid(sessionId, searchParams.get('t'))) {
      const u = currentUser(req);
      if (!u || (isDesk && !canUseSession(u, sess))) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    if (pathname === '/ws/host' || pathname === '/ws/viewer') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws._kind = pathname === '/ws/host' ? 'host' : 'viewer';
        ws._ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim(); // 뷰어 IP당 접속 상한용
        ws._userId = hostUser ? hostUser.id : null;
        ws._perms = hostUser ? permsOf(hostUser) : {}; // 호스트 권한(tts·desk) — 연결 시점 기준
        ws._jti = hostAuth ? hostAuth.jti : null; // 로그인 토큰 — 번역 중 재접속 허용 판단(hostGraceOk)
        ws._session = searchParams.get('session') || 'default';
        ws._hostView = searchParams.get('role') === 'host'; // 호스트 화면의 패시브 뷰어 — 데스크 현황판 '뷰어 수'에서 제외
        ws._src = searchParams.get('src') || 'mic'; // mic | system
        ws._out = searchParams.get('out') || TARGET_LANG;
        ws._in = searchParams.get('in'); // 입력 언어 코드 | 'auto' | null
        ws._pipeline = searchParams.get('pipeline'); // 'whisper' | 'translate' | null
        ws._audioOut = searchParams.get('audioOut') === '1'; // translate 번역 음성 재생 여부
        ws._sxSens = searchParams.get('sxSens');       // soniox endpoint_sensitivity (-1~1)
        ws._sxMaxDelay = searchParams.get('sxMaxDelay'); // soniox max_endpoint_delay_ms (500~3000)
        ws._sxLatency = searchParams.get('sxLatency');   // soniox endpoint_latency_adjustment_level (0~3)
        ws._sxMode = searchParams.get('sxMode');     // soniox 번역 방향 'one'|'two'
        ws._sxTarget = searchParams.get('sxTarget'); // 단방향 타깃 언어
        ws._sxA = searchParams.get('sxA');           // 양방향 언어 A
        ws._sxB = searchParams.get('sxB');           // 양방향 언어 B
        ws._tts = searchParams.get('tts');           // soniox 실시간 TTS on('1')
        ws._gender = searchParams.get('gender');     // 음성 성별 'm' | 'f'
        ws._diar = searchParams.get('diar');         // 화자 구분 on('1')
        ws._deskLangs = searchParams.get('deskLangs'); // desk 후보 언어(콤마구분) — 취항국
        ws._deskIdle = searchParams.get('deskIdle');   // desk 외국어 무음 리셋(ms)
        ws._deskGuestSens = searchParams.get('deskGuestSens'); // desk 여객 태블릿 마이크 민감도(0~100)
        ws._dropAcks = searchParams.get('dropAcks');   // 단독 응답어(네/Yes) 기록 생략(고급옵션)
        ws._confFix = searchParams.get('confFix');     // 저신뢰 자동 교정(고급옵션)
        // 실시간 번역 채널 분리(양방향 통역을 채널별 단방향으로): 시스템+마이크, 스테레오 마이크 2채널.
        ws._role = searchParams.get('role');           // 'me'(내 채널) | 'them'(상대 채널) | null(단일 채널)
        ws._drop = searchParams.get('drop');           // 이 채널에서 인식되면 버릴 언어(=반대 채널의 언어 → 스피커·핀마이크로 샌 소리)
        ws._pair = searchParams.get('pair');           // 'a,b' — 세션 표시용 언어쌍(뷰어가 내 언어/상대 언어로 정렬)
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
    } catch (e) {
      // 비정상 Host 헤더(URL 파싱 실패)·깨진 % 쿠키 등 동기 예외 시 TCP 소켓을 방치하지 않는다(FD 누수 방지)
      logErr('ws-upgrade', e);
      try { socket.destroy(); } catch {}
    }
  });

  wss.on('connection', (ws) => {
    ws._alive = true;
    ws.on('error', (e) => logErr('ws-' + (ws._kind || '?'), e)); // ECONNRESET 등 — error 후 close 가 이어져 락 해제는 기존 경로로
    ws.on('pong', () => { ws._alive = true; });
    if (ws._kind === 'viewer') return handleViewer(ws);
    trackHostJti(ws, ws._jti);
    return handleHost(ws);
  });

  // 하트비트(HEARTBEAT_MS)·뷰어 생존 신호(VIEWER_HB_MS) — 위 상수 설명 참고
  const hbTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws._alive === false) { try { ws.terminate(); } catch {} continue; } // pong 미응답 → 강제 종료(close 핸들러가 락 해제)
      ws._alive = false;
      try { ws.ping(); } catch {}
    }
  }, HEARTBEAT_MS);
  hbTimer.unref();
  const viewerHbTimer = setInterval(() => {
    for (const r of rooms.values()) {
      for (const v of r.viewers) { if (!v._hostView && v.readyState === WebSocket.OPEN) { try { v.send(VIEWER_HB_MSG); } catch {} } }
    }
  }, VIEWER_HB_MS);
  viewerHbTimer.unref();
}
