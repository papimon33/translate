import { getRoom, deskCtrl, maybeGcRoom, VIEWERS_PER_SESSION, VIEWERS_PER_IP } from './rooms.js';
import { getSession } from '../store/sessions.js';
import { deskCtlAllowed } from '../util/pipeline_util.js';

/* ----------------------------- 뷰어 ------------------------------- */
export function handleViewer(ws) {
  const room = getRoom(ws._session);
  // 접속 상한(무인증 QR DoS 방어). 호스트 화면의 패시브 뷰어(_hostView)는 상한에서 제외.
  if (!ws._hostView) {
    const realViewers = [...room.viewers].filter((v) => !v._hostView);
    if (realViewers.length >= VIEWERS_PER_SESSION) {
      try { ws.send(JSON.stringify({ type: 'error', code: 'room_full', message: '접속자가 많아 잠시 후 다시 시도해 주세요.' })); } catch {}
      try { ws.close(1013, 'room full'); } catch {}
      return;
    }
    if (ws._ip) {
      const sameIp = realViewers.filter((v) => v._ip === ws._ip).length;
      if (sameIp >= VIEWERS_PER_IP) {
        try { ws.send(JSON.stringify({ type: 'error', code: 'ip_limit', message: '동일 기기에서 접속이 너무 많습니다.' })); } catch {}
        try { ws.close(1013, 'ip limit'); } catch {}
        return;
      }
    }
  }
  room.viewers.add(ws);
  ws._audioWanted = false; // '음성 듣기' 구독 여부
  const s = getSession(ws._session);
  // tm(레이턴시)·toks(신뢰도)는 저장 전용 — 뷰어 스냅샷에서 제외(라이브 buildMsg 와 동일 규약)
  ws.send(JSON.stringify({ type: 'snapshot', items: s ? s.items.map(({ tm, toks, ...it }) => it) : [] }));
  ws.send(JSON.stringify({ type: 'host', active: room.hosts.size > 0 })); // 현재 호스트 활성 여부
  {
    const dc = deskCtrl.get(ws._session);
    const gs = dc && dc.guestSens ? dc.guestSens() : undefined;
    const m2 = dc && dc.mic2 ? dc.mic2() : undefined; // PC 호스트가 여객 마이크 공급 중이면 뷰어는 표출 전용
    if (s && s.sxInfo) ws.send(JSON.stringify({ type: 'meta', sxInfo: s.sxInfo, ...(gs != null ? { guestSens: gs } : {}), ...(m2 != null ? { mic2: m2 } : {}) })); // 접속/재접속 시 현재 상태 동기화
  }
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // 데스크 여객 태블릿 마이크(2채널) — desk-mic on 을 보낸 뷰어의 오디오는 여객 채널로
      // 그 외 뷰어 오디오는 버린다 — 뷰어 발화(PTT)는 폐지됐고, 뷰어 소켓이 유료 엔진을 여는 경로는 데스크 여객 마이크뿐이다.
      if (ws._deskMic) { const dc = deskCtrl.get(ws._session); if (dc && dc.feedGuest) { dc.feedGuest(data, ws); return; } }
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'audioSub') { ws._audioWanted = !!m.on; ws._audioLang = typeof m.lang === 'string' && /^[a-z]{2,3}$/.test(m.lang) ? m.lang : null; }
      else if (m.type === 'desk-start') {
        // 데스크: 손님이 태블릿에서 언어 선택 → 호스트 파이프라인에서 soniox 양방향 통역 시작
        if (!deskCtlAllowed(ws, room)) { ws.send(JSON.stringify({ type: 'status', message: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' })); return; }
        const ctrl = deskCtrl.get(ws._session);
        // consent: 손님이 태블릿 고지 모달에서 '동의하고 시작'을 누른 시점(감사 근거).
        // 구버전 캐시 클라는 이 필드를 안 보내므로 없으면 기록만 생략한다(하위 호환).
        if (ctrl) ctrl.start(String(m.lang || '').toLowerCase(), m.consent ? Date.now() : null);
        else ws.send(JSON.stringify({ type: 'status', message: '안내원이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.' }));
      } else if (m.type === 'desk-end') {
        // 데스크: 손님 화면의 종료(✕) — 대화 종료 후 대기 모드로
        if (!deskCtlAllowed(ws, room)) return;
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl) ctrl.end();
      } else if (m.type === 'desk-keepalive') {
        // 데스크: 종료 예고 배너 터치 → 무음 타이머 연장
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl && ctrl.keepalive) ctrl.keepalive();
      } else if (m.type === 'desk-mic') {
        // 데스크: 여객 태블릿 마이크 채널 on/off — 2채널 화자 귀속
        if (!deskCtlAllowed(ws, room, true)) return; // on 마다 여객 엔진 재체결(과금)이 따르므로 난사 차단(간격 제한은 제외)
        ws._deskMic = !!m.on;
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl && ctrl.guestMic) ctrl.guestMic(!!m.on, ws);
      }
    } catch {}
  });
  ws.on('close', () => {
    room.viewers.delete(ws);
    if (ws._deskMic) { const dc = deskCtrl.get(ws._session); if (dc && dc.guestMic) dc.guestMic(false, ws); } // 여객 마이크 이탈 → 단일 채널 폴백
    maybeGcRoom(ws._session);
  });
}
