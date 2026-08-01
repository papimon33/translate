# 안내데스크 태블릿 접근제어 · 언어 12개 · 개인정보 고지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 안내데스크 손님 태블릿에서 ① 공개 목록의 뷰어 토큰 배포를 차단하고 ② 손님이 고를 수 있는 언어를 12개로 넓히고 ③ 언어 선택 직후 그 언어로 개인정보 고지·동의를 받는다.

**Architecture:** 서버는 `server.js` 한 파일, 손님 화면은 `client/public/desk.html` 한 파일(바닐라 JS, React 아님)에 모여 있다. 세 변경 모두 이 두 파일 안에서 끝난다. 검증은 `test/helpers/fake-soniox.mjs`(무과금 가짜 STT 엔진)를 쓰는 node:test E2E로 한다.

**Tech Stack:** Node 20+ / Express / ws / 바닐라 JS / node:test

**설계 문서:** `docs/superpowers/specs/2026-08-01-desk-tablet-access-language-consent-design.md`

## Global Constraints

- **`dist/`를 직접 수정하지 말 것.** `client/`를 고치고 `npm run build`. (CLAUDE.md)
- **번역 로직·프롬프트는 `server.js` 한 곳.** 임의로 파일을 쪼개지 말 것.
- **OpenAI/Soniox/Cartesia 실호출은 항상 과금된다.** 테스트는 `test/helpers/fake-soniox.mjs`만 쓴다. 실키로 세션을 열지 말 것.
- **`desk.html`은 태블릿에 캐시된 채 돌아간다.** 서버가 보내던 필드를 없애면 구버전 클라가 빈 화면을 띄운다. 새 메시지 타입·필드 추가는 안전, 제거는 금지.
- 손님 노출 언어 12개 (이 순서 그대로): `en ja zh vi th id ru tl es fr de ar`
- 몽골어(`mn`)는 넣지 않는다 — Soniox stt-rt-v5 미지원.
- 고지 문구 한국어 원문(변경 금지): `원활한 번역 서비스를 위해 음성 데이터가 외부 음성인식 서비스에서 처리될 수 있으며, 서비스 품질 개선을 위해 대화 내용이 저장될 수 있습니다.`
- 커밋 메시지는 한국어. 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| 파일 | 역할 | 이 계획에서의 변경 |
|---|---|---|
| `server.js` | 백엔드 전체 | 공개 목록에서 `t` 제거 · `startConversation` 언어 검증 · `deskLog.consentAt` |
| `client/public/desk.html` | 손님 태블릿 화면(독립 바닐라 JS) | 랜딩 선택 불가 · 언어 리스트 12개 · 고지 모달 + `UI` 사전 |
| `test/desk-access.test.mjs` | **신규** — 토큰 배포 차단 회귀 | Task 1에서 생성 |
| `test/desk-pipeline.test.mjs` | 기존 데스크 E2E | 토큰 취득 경로를 `/api/qr`로 교체 (Task 1 필수 동반) |
| `test/desk-host-recovery.test.mjs` | 기존 호스트 복구 E2E | 토큰 취득 경로 교체 (Task 1 필수 동반) |
| `test/desk-retry-cap.test.mjs` | 기존 재연결 상한 E2E | 토큰 취득 경로 교체 (Task 1 필수 동반) |
| `PROJECT_NOTES.md` · `README.md` | 문서 | Task 4 |

`client/src/`(React 호스트·관리자)는 건드리지 않는다. `android/`도 코드 변경 없음.

---

## Task 1: 공개 목록에서 뷰어 토큰 제거

`GET /api/desk-sessions`가 인증 없이 전 데스크의 뷰어 토큰을 배포한다. 그 토큰 하나로 승객 대화를 실시간 수신하고 `desk-end`로 응대를 원격 종료할 수 있다. 태블릿은 이미 인증 게이트가 있는 `GET /api/qr?session=..`로 프로비저닝하면 되므로, 목록에서 토큰만 빼면 된다.

**Files:**
- Modify: `server.js:1884`
- Modify: `client/public/desk.html:694-716` (`loadRooms`), `:230`
- Create: `test/desk-access.test.mjs`
- Modify: `test/desk-pipeline.test.mjs:36-39`, `test/desk-host-recovery.test.mjs`, `test/desk-retry-cap.test.mjs`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: 이후 모든 E2E 테스트가 쓰는 토큰 취득 헬퍼 `deskToken(base, cookie, sessionId) -> Promise<string>` (`test/helpers/boot.mjs`에 추가). 관리자 쿠키로 `/api/qr?session=..`를 호출해 응답 `url`의 `t` 쿼리를 파싱해 돌려준다.

- [ ] **Step 1: 토큰 취득 헬퍼를 `test/helpers/boot.mjs` 끝에 추가**

```js
/* 데스크 뷰어 접근 토큰 — 관리자만 열 수 있는 QR 라우트에서 받는다.
   공개 목록(/api/desk-sessions)은 토큰을 배포하지 않으므로 실제 프로비저닝과 같은 경로를 쓴다. */
export async function deskToken(base, cookie, sessionId) {
  const r = await fetch(`${base}/api/qr?session=${encodeURIComponent(sessionId)}`, { headers: { Cookie: cookie } });
  if (!r.ok) throw new Error(`QR 취득 실패 ${r.status}`);
  const { url } = await r.json();
  const t = new URL(url).searchParams.get('t');
  if (!t) throw new Error('QR URL 에 토큰이 없음: ' + url);
  return t;
}
```

- [ ] **Step 2: 실패하는 테스트를 작성한다 — `test/desk-access.test.mjs` (신규)**

```js
/* 데스크 뷰어 접근제어 회귀 — 공개 목록이 뷰어 토큰을 배포하면 안 된다.
   배포하면 인터넷에서 누구나 승객 대화를 실시간 수신하고 desk-end 로 응대를 종료할 수 있다.
   태블릿은 관리자만 열 수 있는 /api/qr 로 1회 프로비저닝한다(안내원 조작 0회). */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { bootServer, loginAdmin, deskToken } from './helpers/boot.mjs';

test('데스크 공개 목록은 뷰어 토큰을 배포하지 않는다', { timeout: 60000 }, async (t) => {
  const srv = await bootServer();
  t.after(async () => { await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const reg = await fetch(`${srv.base}/api/desk-registry`, { method: 'PUT', ...auth, body: JSON.stringify({ desks: [{ name: '접근제어 데스크', floor: '1F', side: 'S' }] }) }).then((r) => r.json());
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '접근제어', pipeline: 'desk', inLang: 'auto', deskId: reg.desks[0].id }) }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  // 목록은 계속 공개다(id·제목·가동 여부는 비밀이 아니다). 다만 토큰은 없어야 한다.
  const list = await fetch(`${srv.base}/api/desk-sessions`).then((r) => r.json());
  const row = list.find((x) => x.id === sess.id);
  assert.ok(row, '데스크가 목록에 보여야 함');
  assert.equal(row.t, undefined, '공개 목록에 뷰어 토큰(t)이 실리면 안 됨');
  assert.equal(row.title, '접근제어', '제목은 계속 노출');

  // 로그인 없이는 QR(=토큰)도 못 받는다
  const anon = await fetch(`${srv.base}/api/qr?session=${sess.id}`);
  assert.equal(anon.status, 403, '무인증 QR 요청은 403 이어야 함');

  // 관리자는 받는다 — 이게 태블릿 프로비저닝 경로다
  const tok = await deskToken(srv.base, cookie, sess.id);
  assert.ok(tok.length >= 8, '관리자 QR 은 토큰을 포함해야 함');

  // 그 토큰으로는 뷰어 접속이 되고, 토큰 없이는 안 된다
  const wsBase = srv.base.replace('http', 'ws');
  const ok = new WebSocket(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await new Promise((res, rej) => { ok.once('open', res); ok.once('error', rej); });
  ok.close();

  const bad = new WebSocket(`${wsBase}/ws/viewer?session=${sess.id}`);
  const err = await new Promise((res) => { bad.once('open', () => res(null)); bad.once('error', (e) => res(e)); });
  assert.ok(err, '토큰 없는 뷰어 접속은 거부돼야 함');
});
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `node --test test/desk-access.test.mjs`
Expected: FAIL — `공개 목록에 뷰어 토큰(t)이 실리면 안 됨` (현재는 `t`가 실려 있음)

- [ ] **Step 4: 서버에서 `t` 제거**

`server.js:1882-1884`의 주석 3줄과 map 을 아래로 교체한다.

```js
    // t(뷰어 접근 토큰)는 여기서 내려보내지 않는다 — 이 라우트는 무인증 공개라, 토큰을 실으면
    // 인터넷에서 누구나 진행 중인 승객 대화를 수신하고 desk-end 로 응대를 종료할 수 있다.
    // 태블릿은 관리자만 열 수 있는 GET /api/qr?session=.. 로 1회 프로비저닝한다(안내원 조작 0회).
    .map((s) => ({ id: s.id, title: s.title || '안내데스크', active: !!(rooms.get(s.id) && rooms.get(s.id).hosts.size > 0) }));
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test test/desk-access.test.mjs`
Expected: PASS (1/1)

- [ ] **Step 6: 기존 E2E 3개의 토큰 취득 경로를 교체한다**

`test/desk-pipeline.test.mjs` — import 에 `deskToken` 추가하고, 아래 4줄을

```js
  // 실제 손님 뷰어처럼 공개 디렉터리에서 접근 토큰을 받아 접속(뷰어 라우트는 토큰 필수)
  const dl = await fetch(`${srv.base}/api/desk-sessions`).then((r) => r.json());
  const tok = dl.find((x) => x.id === sess.id)?.t;
  assert.ok(tok, '데스크 세션 토큰 취득 실패: ' + JSON.stringify(dl));
```

이렇게 바꾼다.

```js
  // 실제 태블릿 프로비저닝과 같은 경로로 토큰을 받는다(관리자 QR — 공개 목록은 토큰을 주지 않는다)
  const tok = await deskToken(srv.base, cookie, sess.id);
```

`test/desk-retry-cap.test.mjs`와 `test/desk-host-recovery.test.mjs`도 같은 방식으로 바꾼다. 두 파일의 현재 코드는

```js
  const dl = await fetch(`${srv.base}/api/desk-sessions`).then((r) => r.json());
  const tok = dl.find((x) => x.id === sess.id)?.t;
```

이고, `test/desk-host-recovery.test.mjs`에는 이 2줄이 **테스트 2개에 각각 한 번씩, 총 2군데** 있다. 전부 아래로 바꾼다.

```js
  const tok = await deskToken(srv.base, cookie, sess.id);
```

세 파일 모두 import 줄을 `import { bootServer, loginAdmin, until, wait, deskToken } from './helpers/boot.mjs';` 로 갱신한다(`desk-pipeline`은 `wait`를 안 쓰면 빼도 된다 — 기존 import 목록에 `deskToken`만 더한다).

- [ ] **Step 7: 클라이언트 랜딩을 선택 불가로 바꾼다**

`client/public/desk.html:230`의 주석을 갱신한다.

```js
let token = params.get('t') || ''; // 뷰어 접근 토큰 — 관리자 QR 로 설치된 URL 에 실려 온다
```

`loadRooms()`(`:694-716`) 전체를 아래로 교체한다.

```js
/* ---- 랜딩(세션 없이 열렸을 때) ----
   목록은 어떤 데스크가 등록·가동 중인지 보여주기만 한다. 여기서 입장은 불가능하다 —
   뷰어 접근 토큰은 관리자만 열 수 있는 QR 로만 배포되고, 태블릿은 그 URL 로 1회 설치된다. */
let roomsPoll = null;
async function loadRooms(){
  const box = $('rooms');
  try {
    const list = await fetch('/api/desk-sessions').then(r => r.json());
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div id="roomsEmpty">등록된 안내데스크가 없습니다.</div>'; return; }
    list.forEach(s => {
      const b = document.createElement('div');
      b.className = 'room off';
      b.innerHTML = esc(s.title) + '<span class="tag">' + (s.active ? '가동 중' : '안내원 준비 중') + '</span>';
      box.appendChild(b);
    });
    const note = document.createElement('div');
    note.id = 'roomsEmpty';
    note.textContent = '설치용 QR은 관리자에게 요청하세요 · Ask staff for the setup QR';
    box.appendChild(note);
  } catch { box.innerHTML = '<div id="roomsEmpty">목록을 불러오지 못했습니다.</div>'; }
}
```

`.room` CSS의 `cursor:pointer`는 `.room.off`의 `cursor:not-allowed`가 덮으므로 그대로 둔다.

- [ ] **Step 8: 전체 테스트 통과 확인**

Run: `npm test`
Expected: PASS — `tests 29 / pass 29 / fail 0` (기존 28 + 신규 1)

- [ ] **Step 9: 커밋**

```bash
git add server.js client/public/desk.html test/desk-access.test.mjs test/helpers/boot.mjs test/desk-pipeline.test.mjs test/desk-retry-cap.test.mjs test/desk-host-recovery.test.mjs
git commit -m "$(cat <<'EOF'
안내데스크 공개 목록에서 뷰어 토큰 제거

GET /api/desk-sessions 가 인증 없이 전 데스크의 뷰어 토큰을 배포하고 있었다.
그 토큰 하나로 진행 중인 승객 대화를 실시간 수신하고 desk-end 로 응대를 원격
종료할 수 있었다(조달 심사 등급 A1).

토큰은 만료가 없는 세션 파생 HMAC 이라 태블릿에 한 번 박아두면 영구 유효하다.
바꾼 것은 토큰의 수명이 아니라 얻는 경로다 — 이미 인증 게이트가 있는
GET /api/qr?session=.. 로만 배포한다. 랜딩 목록 선택은 오히려 매 부팅 탭을
요구했으므로, 없애면 안내원 조작이 늘지 않고 줄어든다.

- 목록은 계속 공개(id·제목·가동 여부는 비밀이 아님), t 필드만 제거
- desk.html 랜딩은 표시 전용 + '설치용 QR은 관리자에게' 안내
- test/helpers/boot.mjs 에 deskToken() 추가, 기존 E2E 3개를 이 경로로 이관

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 손님 언어 선택 12개 (스크롤 리스트)

손님이 고를 수 있는 언어가 화면상 3개뿐이다. 실효 커버리지는 자동감지로 60개지만 심사는 화면을 본다. 또 `GUEST_LANGS`(10개) 밖의 언어를 고르면 **아무 안내 없이 영어로 바뀐다**.

**Files:**
- Modify: `server.js:3913-3914` (`startConversation`)
- Modify: `client/public/desk.html:69-77` (CSS), `:195-200` (마크업), `:711-714` (이벤트)
- Modify: `test/desk-pipeline.test.mjs` (아랍어 선택 케이스 추가)

**Interfaces:**
- Consumes: Task 1의 `deskToken(base, cookie, sessionId)`
- Produces: `desk.html`의 `DESK_LANGS` 배열(12개 코드, 표시 순서) — Task 3의 고지 모달이 같은 배열을 언어 키로 쓴다.

- [ ] **Step 1: 실패하는 테스트를 `test/desk-pipeline.test.mjs` 끝에 추가**

파일 맨 아래에 새 테스트를 붙인다.

```js
test('데스크: GUEST_LANGS 밖의 언어를 골라도 영어로 바뀌지 않는다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const reg = await fetch(`${srv.base}/api/desk-registry`, { method: 'PUT', ...auth, body: JSON.stringify({ desks: [{ name: '언어 데스크', floor: '1F', side: 'S' }] }) }).then((r) => r.json());
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '언어 확장', pipeline: 'desk', inLang: 'auto', deskId: reg.desks[0].id }) }).then((r) => r.json());

  const wsBase = srv.base.replace('http', 'ws');
  const host = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host.ready;
  const tok = await deskToken(srv.base, cookie, sess.id);
  const viewer = wsClient(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await viewer.ready;
  await until(() => viewer.messages.some((m) => m.type === 'host' && m.active), { desc: '호스트 활성' });

  // ar 은 GUEST_LANGS(자동감지 힌트 10개)에 없지만 SONIOX_LANGS(60개)에는 있다
  viewer.send({ type: 'desk-start', lang: 'ar' });
  const conn = await fake.nextConnection();
  const config = await conn.waitConfig;
  assert.ok(config.language_hints.includes('ar'), '고른 언어(ar)가 힌트에 있어야 함: ' + JSON.stringify(config.language_hints));
  assert.equal(config.translation?.language_b, 'ar', 'two_way 상대 언어가 ar 이어야 함(en 으로 바뀌면 안 됨)');
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test test/desk-pipeline.test.mjs`
Expected: FAIL — `고른 언어(ar)가 힌트에 있어야 함: ["ko","en"]` (현재는 `'en'`으로 폴백)

- [ ] **Step 3: 서버 언어 검증을 고친다**

`server.js:3911-3915`를 아래로 교체한다.

```js
    const startConversation = (B) => {
      if (closed) return;
      // 명시 선택은 엔진 지원 전체(SONIOX_LANGS 60개)로 검증한다. 미지원 값이면 영어로 바꾸지 않고
      // 자동감지로 넘긴다 — 손님이 고른 언어가 아닌 언어로 조용히 통역되는 것보다 낫다.
      // (GUEST_LANGS 는 자동감지 language_hints 전용이라 여기 쓰지 않는다. 늘리면 힌트가 희석된다.)
      const lang = B !== 'auto' && SONIOX_LANGS.includes(B) ? B : null;
      const auto = !lang; // 'auto' 선택 또는 미지원 값 → 첫 발화로 감지
      if (phase === 'active' && !auto && lang === lockedB) return;
```

이후 줄(`if (phase === 'active') endConversation(false);` …)은 그대로 둔다. `lockedB = lang; autoDetect = auto;`도 그대로 동작한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/desk-pipeline.test.mjs`
Expected: PASS (2/2)

- [ ] **Step 5: 손님 화면을 스크롤 리스트로 바꾼다 — CSS**

`client/public/desk.html:69-77`의 `#langBtns` · `#otherLangBtn` 규칙 전체를 아래로 교체한다.

```css
  /* 언어 선택: 세로 스크롤 리스트 — 상위 3개(en/ja/zh)는 스크롤 없이 보이게 높이를 잡는다.
     드럼 휠 대신 리스트인 이유: 김포 국제선은 en/ja/zh 가 대다수인데 휠은 그 손님까지
     스핀+확인 2동작을 요구한다. 리스트는 흔한 경우 1탭이고 드문 언어만 스크롤한다. */
  #langList { width:100%; margin-top:26px; max-height:46vh; overflow-y:auto; -webkit-overflow-scrolling:touch;
    display:flex; flex-direction:column; gap:8px; }
  #langList button { border:1px solid var(--line); border-radius:16px; background:var(--card); color:var(--fg);
    font-size:calc(21px * var(--fs)); font-weight:800; min-height:60px; padding:14px 20px; cursor:pointer;
    text-align:left; width:100%; }
  #langList button:active { background:var(--chip); }
  /* 기타 언어: 넓은 단일 버튼 — 누르면 바로 발화 화면, 첫 발화로 언어 자동 감지 */
  #otherLangBtn { width:100%; margin-top:12px; border:1px dashed var(--line); border-radius:16px; background:transparent;
    color:var(--muted); font-size:calc(17px * var(--fs)); font-weight:800; padding:18px 10px; cursor:pointer; }
  #otherLangBtn:active { background:var(--chip); }
```

- [ ] **Step 6: 마크업을 바꾼다**

`client/public/desk.html:195-199`의 `<div id="langBtns">…</div>` 블록(버튼 3개 포함) 전체를 아래 한 줄로 교체한다. `#otherLangBtn` 줄은 그대로 둔다.

```html
      <div id="langList"></div>
```

- [ ] **Step 7: 언어 배열과 렌더 함수를 추가한다**

`desk.html`의 `const LANGNAME = { … };` 줄 **바로 다음**에 아래를 넣는다.

```js
/* 손님이 고를 수 있는 언어(표시 순서). 전부 Soniox stt-rt-v5 지원 + LANGNAME 자국어 표기 보유.
   몽골어(mn)는 LANGNAME 에는 있으나 엔진이 지원하지 않아 넣지 않는다(자동감지로도 불가).
   상위 3개는 김포 국제선 실제 취항 기준 — 스크롤 없이 보이도록 리스트 최상단에 둔다. */
const DESK_LANGS = ['en','ja','zh','vi','th','id','ru','tl','es','fr','de','ar'];
function renderLangList(){
  const box = $('langList');
  box.innerHTML = '';
  for (const lg of DESK_LANGS) {
    const b = document.createElement('button');
    b.dataset.lang = lg;
    b.setAttribute('lang', lg);
    b.textContent = LANGNAME[lg] || lg;
    box.appendChild(b);
  }
}
renderLangList();
```

- [ ] **Step 8: 이벤트 바인딩을 새 컨테이너로 옮긴다**

`client/public/desk.html:712-713`의

```js
const pickLang = (e) => { const b = e.target.closest('button[data-lang]'); if (!b) return; startWithLang(b.dataset.lang); };
$('langBtns').addEventListener('click', pickLang);
```

를 아래로 바꾼다.

```js
const pickLang = (e) => { const b = e.target.closest('button[data-lang]'); if (!b) return; startWithLang(b.dataset.lang); };
$('langList').addEventListener('click', pickLang);
```

- [ ] **Step 9: 빌드하고 전체 테스트를 돌린다**

Run: `npm run build && npm test`
Expected: 빌드 성공(`✓ built in ...`), `tests 30 / pass 30 / fail 0`

- [ ] **Step 10: 커밋**

```bash
git add server.js client/public/desk.html test/desk-pipeline.test.mjs
git commit -m "$(cat <<'EOF'
손님 언어 선택을 스크롤 리스트 12개로 확대

화면상 3개(en/ja/zh)뿐이라 정량 심사에서 카운트되지 않았다. 실효 커버리지는
자동감지로 Soniox 60개 전부지만 심사는 화면을 본다.

- desk.html: 버튼 3개 → 세로 스크롤 리스트 12개
  en ja zh vi th id ru tl es fr de ar (자국어 표기, 최소 높이 60px)
  상위 3개는 스크롤 없이 보이게 배치 — 흔한 경우 1탭 유지
  몽골어는 Soniox 미지원이라 제외(자동감지로도 불가)
- server.js: GUEST_LANGS(10) 밖의 선택이 조용히 'en' 으로 바뀌던 폴백 제거.
  명시 선택은 SONIOX_LANGS(60)로 검증하고 미지원이면 자동감지로 넘긴다 —
  고른 언어가 아닌 언어로 통역되는 것보다 낫다.
  GUEST_LANGS 는 자동감지 힌트 전용이라 그대로 둔다(늘리면 힌트가 희석됨).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 개인정보 고지 모달

손님 음성을 수집하면서 고지·동의 문구가 화면에 없다(조달 심사 등급 A2). 언어를 먼저 고르게 해서 **손님이 읽을 수 있는 언어로** 고지한다.

**Files:**
- Modify: `client/public/desk.html` — CSS · 마크업 · `UI` 사전 · `show()` · `startWithLang()` · `sendStart()`
- Modify: `server.js:2925` (`desk-start` 수신), `:3883` (deskLog 아카이브)
- Modify: `test/desk-pipeline.test.mjs` (동의 기록 단언 추가)

**Interfaces:**
- Consumes: Task 2의 `DESK_LANGS`, 기존 `t(key)` 사전 조회 함수, 기존 `show(id)` 화면 전환
- Produces: 뷰어→서버 `{type:'desk-start', lang, consent:true}`의 `consent` 필드 · `deskLog[].consentAt`(epoch ms, 없을 수 있음)

- [ ] **Step 1: 실패하는 테스트를 `test/desk-pipeline.test.mjs`에 추가**

파일 맨 아래에 붙인다.

```js
test('데스크: 손님 동의 시각이 응대 기록에 남는다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const reg = await fetch(`${srv.base}/api/desk-registry`, { method: 'PUT', ...auth, body: JSON.stringify({ desks: [{ name: '동의 데스크', floor: '1F', side: 'S' }] }) }).then((r) => r.json());
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '동의 기록', pipeline: 'desk', inLang: 'auto', deskId: reg.desks[0].id }) }).then((r) => r.json());

  const wsBase = srv.base.replace('http', 'ws');
  const host = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host.ready;
  const tok = await deskToken(srv.base, cookie, sess.id);
  const viewer = wsClient(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await viewer.ready;
  await until(() => viewer.messages.some((m) => m.type === 'host' && m.active), { desc: '호스트 활성' });

  const before = Date.now();
  viewer.send({ type: 'desk-start', lang: 'en', consent: true });
  const conn = await fake.nextConnection();
  await conn.waitConfig;
  conn.sendTokens([
    { text: 'Hello', is_final: true, language: 'en', confidence: 0.98 },
    { text: '안녕하세요', is_final: true, translation_status: 'translation' },
  ]);
  conn.end();
  await until(() => viewer.messages.some((m) => m.type === 'sentence' && m.source === 'Hello'), { desc: '카드 확정' });

  host.ws.close(); // 응대 종료 → deskLog 아카이브
  await until(async () => {
    const l = await fetch(`${srv.base}/api/admin/logs`, { headers: { Cookie: cookie } }).then((r) => r.json());
    return ((l.desks || []).find((d) => d.id === sess.id)?.logs || []).length === 1;
  }, { desc: '응대 아카이브' });

  const detail = await fetch(`${srv.base}/api/admin/logs/desk/${sess.id}/0`, { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.ok(detail.consentAt >= before, '동의 시각이 기록돼야 함: ' + JSON.stringify(detail).slice(0, 200));
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test test/desk-pipeline.test.mjs`
Expected: FAIL — `동의 시각이 기록돼야 함` (`consentAt`이 `undefined`)

- [ ] **Step 3: 서버가 동의 시각을 받아 보관한다**

`server.js:2925`의

```js
        if (ctrl) ctrl.start(String(m.lang || '').toLowerCase());
```

를 아래로 바꾼다.

```js
        // consent: 손님이 태블릿 고지 모달에서 '동의하고 시작'을 누른 시점(감사 근거).
        // 구버전 캐시 클라는 이 필드를 안 보내므로 없으면 기록만 생략한다(하위 호환).
        if (ctrl) ctrl.start(String(m.lang || '').toLowerCase(), m.consent ? Date.now() : null);
```

`server.js:3911`의 `startConversation = (B) => {`를 `startConversation = (B, consentAt) => {`로 바꾸고, 같은 함수 안 `sxFails = 0; gsxFails = 0;` 줄 **바로 다음**에 아래를 넣는다.

```js
      convConsentAt = consentAt || null; // 이 응대의 손님 동의 시각(아카이브에 함께 저장)
```

`server.js:3767`(`let convStartedAt = 0;` 줄) 다음에 선언을 추가한다.

```js
    let convConsentAt = null;   // 현재 응대의 손님 동의 시각(고지 모달 '동의하고 시작')
```

`server.js:3883`의 deskLog push 를 아래로 바꾼다.

```js
          session.deskLog.push({ startedAt: convStartedAt || null, endedAt: Date.now(), lang: convLang, ...(convConsentAt ? { consentAt: convConsentAt } : {}), items: session.items, stats: { ...chStats } });
```

`ctrl` 객체(`server.js:4211`)의 `start: startConversation,`는 그대로 둔다 — 인자가 그대로 전달된다.

- [ ] **Step 4: 로그 상세 API가 `consentAt`을 반환하게 한다**

`server.js:1077`은 필드를 골라 내려주므로 `consentAt`을 명시적으로 더해야 한다. 그 줄을 아래로 바꾼다.

```js
  res.json({ startedAt: e.startedAt || null, endedAt: e.endedAt || null, lang: e.lang || null, consentAt: e.consentAt || null, stats: e.stats || null, items: e.items || [] });
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test test/desk-pipeline.test.mjs`
Expected: PASS (3/3)

- [ ] **Step 6: 고지 모달 CSS를 추가한다**

`client/public/desk.html`의 `#otherLangBtn:active { background:var(--chip); }` 줄 **다음**에 넣는다.

```css
  /* 개인정보 고지 — 언어 선택 직후, 그 언어로 표시하고 동의를 받는다 */
  #consentWrap { flex-direction:column; align-items:center; justify-content:center;
    padding:6vh 6vw calc(6vh + env(safe-area-inset-bottom)); background:var(--bg); }
  .consentCard { width:100%; max-width:640px; background:var(--card); border:1px solid var(--line);
    border-radius:22px; padding:30px 26px; text-align:left; }
  .consentCard h2 { margin:0 0 14px; font-size:calc(20px * var(--fs)); font-weight:800; color:var(--fg); }
  /* pre-line: 자동감지 경로에서 한국어+영어를 \n\n 로 병기한다 */
  .consentCard p { margin:0; font-size:calc(17px * var(--fs)); line-height:1.65; color:var(--fg); word-break:keep-all;
    white-space:pre-line; }
  #consentWrap[dir="rtl"] .consentCard { text-align:right; }
  #consentOk { width:100%; max-width:640px; margin-top:18px; border:none; cursor:pointer; color:#fff; font-weight:800;
    background:#4f46e5; border-radius:20px; padding:22px 20px; font-size:calc(21px * var(--fs)); }
  #consentOk:active { filter:brightness(.92); }
```

- [ ] **Step 7: 고지 모달 마크업을 추가한다**

`client/public/desk.html`의 `<!-- 무음 종료 예고(터치로 연장) -->` 주석 **바로 앞**에 넣는다.

```html
  <!-- 개인정보 고지: 언어 선택 → 그 언어로 고지 → 동의 → 발화 대기 -->
  <div id="consentWrap" class="screen">
    <div class="consentCard">
      <h2 id="consentTitle"></h2>
      <p id="consentBody"></p>
    </div>
    <button id="consentOk"></button>
  </div>
```

- [ ] **Step 8: `UI` 사전에 3개 키를 추가한다**

`client/public/desk.html`의 `UI` 객체 안, `walk:` 줄 **앞**에 넣는다. 한국어 원문은 변경 금지.

```js
  consentTitle: { ko:'안내', en:'Privacy notice', ja:'ご案内', zh:'须知', vi:'Thông báo', th:'ประกาศ', id:'Pemberitahuan', ru:'Уведомление', tl:'Paunawa', es:'Aviso', fr:'Information', de:'Hinweis', ar:'إشعار' },
  consentBody: {
    ko:'원활한 번역 서비스를 위해 음성 데이터가 외부 음성인식 서비스에서 처리될 수 있으며, 서비스 품질 개선을 위해 대화 내용이 저장될 수 있습니다.',
    en:'To provide translation, your voice data may be processed by an external speech recognition service, and conversation content may be stored to improve service quality.',
    ja:'翻訳サービスのため、音声データが外部の音声認識サービスで処理される場合があり、サービス品質向上のため会話内容が保存される場合があります。',
    zh:'为提供翻译服务，您的语音数据可能由外部语音识别服务处理，且为改善服务质量，对话内容可能会被保存。',
    vi:'Để cung cấp dịch vụ phiên dịch, dữ liệu giọng nói của bạn có thể được xử lý bởi dịch vụ nhận dạng giọng nói bên ngoài, và nội dung cuộc trò chuyện có thể được lưu để cải thiện chất lượng dịch vụ.',
    th:'เพื่อให้บริการแปลภาษา ข้อมูลเสียงของท่านอาจถูกประมวลผลโดยบริการรู้จำเสียงภายนอก และเนื้อหาการสนทนาอาจถูกจัดเก็บเพื่อปรับปรุงคุณภาพบริการ',
    id:'Untuk menyediakan layanan penerjemahan, data suara Anda dapat diproses oleh layanan pengenalan suara eksternal, dan isi percakapan dapat disimpan untuk meningkatkan kualitas layanan.',
    ru:'Для предоставления услуг перевода ваши голосовые данные могут обрабатываться внешним сервисом распознавания речи, а содержание разговора может сохраняться для улучшения качества обслуживания.',
    tl:'Upang maibigay ang serbisyo ng pagsasalin, ang iyong datos ng boses ay maaaring iproseso ng panlabas na serbisyo ng pagkilala sa boses, at maaaring itago ang nilalaman ng usapan upang mapabuti ang kalidad ng serbisyo.',
    es:'Para ofrecer el servicio de traducción, sus datos de voz pueden ser procesados por un servicio externo de reconocimiento de voz, y el contenido de la conversación puede almacenarse para mejorar la calidad del servicio.',
    fr:'Pour assurer le service de traduction, vos données vocales peuvent être traitées par un service externe de reconnaissance vocale, et le contenu de la conversation peut être conservé afin d\'améliorer la qualité du service.',
    de:'Zur Bereitstellung der Übersetzung können Ihre Sprachdaten von einem externen Spracherkennungsdienst verarbeitet und Gesprächsinhalte zur Verbesserung der Servicequalität gespeichert werden.',
    ar:'لتقديم خدمة الترجمة، قد تتم معالجة بياناتك الصوتية بواسطة خدمة خارجية للتعرف على الكلام، وقد يتم حفظ محتوى المحادثة لتحسين جودة الخدمة.',
  },
  consentBtn: { ko:'동의하고 시작', en:'Agree and start', ja:'同意して開始', zh:'同意并开始', vi:'Đồng ý và bắt đầu', th:'ยอมรับและเริ่ม', id:'Setuju dan mulai', ru:'Принять и начать', tl:'Sumang-ayon at magsimula', es:'Aceptar y comenzar', fr:'Accepter et commencer', de:'Zustimmen und starten', ar:'الموافقة والبدء' },
```

- [ ] **Step 9: `show()`에 새 화면을 등록한다**

`client/public/desk.html:240-241`의

```js
function show(id){
  ['landing','enterWrap','touchWrap','stage'].forEach(s => $(s).classList.toggle('show', s===id));
```

를 아래로 바꾼다.

```js
function show(id){
  ['landing','enterWrap','touchWrap','consentWrap','stage'].forEach(s => $(s).classList.toggle('show', s===id));
```

- [ ] **Step 10: 흐름을 언어 선택 → 고지 → 동의 → 시작으로 바꾼다**

`client/public/desk.html:670-680`의 `startWithLang` 함수 전체를 아래로 교체한다.

```js
/* 언어 선택 → 개인정보 고지(그 언어로) → 동의 → 발화 대기.
   손님당 1회이며, 응대가 끝나 대기 화면으로 돌아오면 다음 손님에게 다시 표시된다. */
let pendingLang = null;
function startWithLang(lang){
  if (started) return;
  pendingLang = lang;
  curLang = lang; // t() 가 이 언어로 사전을 조회한다
  const auto = lang === 'auto';
  // 자동감지는 아직 손님 언어를 모른다 → 한국어+영어 병기
  $('consentTitle').textContent = auto ? UI.consentTitle.ko + ' · ' + UI.consentTitle.en : t('consentTitle');
  $('consentBody').textContent = auto ? UI.consentBody.ko + '\n\n' + UI.consentBody.en : t('consentBody');
  $('consentOk').textContent = auto ? UI.consentBtn.ko + ' · ' + UI.consentBtn.en : t('consentBtn');
  $('consentWrap').setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  show('consentWrap');
}
function consentAndStart(){
  const lang = pendingLang;
  if (!lang || started) return;
  pendingLang = null;
  curLang = lang; gotActive = false; pendingStart = true;
  clearAll();
  setSvcConnecting();
  show('stage');
  ensureWs();
  if (ws && ws.readyState === WebSocket.OPEN) sendStart();
  clearTimeout(activeGuard);
  activeGuard = setTimeout(() => { if (pendingStart && !gotActive) { toast('안내원이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.'); backToTouch(); } }, 8000);
}
```

- [ ] **Step 11: 동의 버튼을 배선하고 `desk-start`에 `consent`를 싣는다**

`client/public/desk.html:476`의

```js
function sendStart(){ try { ws && ws.send(JSON.stringify({ type:'desk-start', lang: curLang })); } catch {} }
```

를 아래로 바꾼다.

```js
// consent: 손님이 고지 모달에서 '동의하고 시작'을 눌렀다는 표시 — 서버가 응대 기록에 시각을 남긴다
function sendStart(){ try { ws && ws.send(JSON.stringify({ type:'desk-start', lang: curLang, consent: true })); } catch {} }
```

`$('langList').addEventListener('click', pickLang);` 줄 **다음**에 아래를 넣는다.

```js
$('consentOk').addEventListener('click', consentAndStart);
```

- [ ] **Step 12: 취소 경로를 확인한다 — 고지 화면에서 응대가 시작되면 안 된다**

`backToTouch()`(`:497`)에 `pendingLang = null;`을 추가한다. `clearTimeout(activeGuard);` 줄 다음에 넣는다.

```js
  pendingLang = null; // 고지 화면에서 이탈했을 때 선택이 남지 않게
```

- [ ] **Step 13: 빌드하고 전체 테스트를 돌린다**

Run: `npm run build && npm test`
Expected: 빌드 성공, `tests 31 / pass 31 / fail 0`

- [ ] **Step 14: 커밋**

```bash
git add server.js client/public/desk.html test/desk-pipeline.test.mjs
git commit -m "$(cat <<'EOF'
손님 화면에 개인정보 고지·동의 추가

승객 음성을 수집하면서 고지 문구가 화면 어디에도 없었다(조달 심사 등급 A2).

언어 선택 → 그 언어로 된 고지 모달 → [동의하고 시작] → 발화 대기.
손님이 읽을 수 있는 언어로 고지하기 위해 언어 선택을 먼저 두었다.
자동감지 경로는 언어가 아직 없으므로 한국어+영어 병기, 아랍어는 dir=rtl.

동의 시각은 desk-start 의 consent 필드로 올려 deskLog[].consentAt 에 남긴다
(감사 근거). 구버전 캐시 클라는 이 필드를 안 보내므로 없으면 기록만 생략한다.

문구에 'AI 학습'은 쓰지 않았다 — 실제로 학습에 쓰지 않고, 그렇게 쓰면 별도
동의가 필요한 처리로 해석될 여지가 있다. 보유기간·국외이전 업체명을 포함한
전체 처리방침은 기관 산출물이며 이 화면의 범위 밖이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 문서 갱신 + 실기동 검증

세 변경이 실제 태블릿 흐름에서 이어지는지 브라우저로 한 번 훑고, 근거를 문서에 남긴다.

**Files:**
- Modify: `PROJECT_NOTES.md` (운영/보안 섹션 상단)
- Modify: `README.md` (안내데스크 기능 표의 언어 수)

**Interfaces:**
- Consumes: Task 1~3의 모든 변경
- Produces: 없음 (종결)

- [ ] **Step 1: 서버를 띄우고 공개 목록에 토큰이 없음을 확인한다**

```bash
npm start
```

다른 터미널에서:

```bash
curl -s http://localhost:3001/api/desk-sessions
```

Expected: `[{"id":"...","title":"...","active":false}]` — `"t"` 키가 없어야 한다.

- [ ] **Step 2: 손님 태블릿 흐름을 브라우저로 훑는다**

관리자로 로그인(`admin`/`admin`) → 데스크 세션의 QR URL을 복사 → 새 창에서 열고 아래를 확인한다.

1. 대기 화면에 언어 12개가 리스트로 보이고, 상단 3개(English/日本語/中文)가 스크롤 없이 보인다
2. `العربية`를 탭 → 고지 모달이 **아랍어로, 오른쪽 정렬**로 뜬다
3. `الموافقة والبدء` 탭 → 발화 대기 화면으로 넘어간다
4. ✕ 로 종료 → 대기 화면 복귀 → 다시 탭하면 고지가 **또 뜬다**(손님당 1회)
5. `Other languages — just speak` 탭 → 고지가 **한국어+영어 병기**로 뜬다
6. 12개 언어를 차례로 탭해 문구가 잘리거나 카드를 넘치지 않는지 본다(태국어·아랍어 줄높이 주의)

- [ ] **Step 3: 세션 없이 열었을 때 입장이 불가능함을 확인한다**

브라우저에서 `http://localhost:3001/desk.html` (쿼리 없이) 열기.
Expected: 데스크 목록이 보이지만 **클릭해도 아무 일도 일어나지 않고**, 아래에 "설치용 QR은 관리자에게 요청하세요"가 보인다.

- [ ] **Step 4: `PROJECT_NOTES.md`에 기록을 추가한다**

`## 운영/보안 (SECURITY_GUIDE.md 참고)` 섹션에서 `- **과금 폭주 방어 + 시범 데이터 손실 차단(2026-08-01…` 항목 **바로 앞**에 아래를 넣는다.

```markdown
- **안내데스크 태블릿 3건(2026-08-01, 설계 `docs/superpowers/specs/2026-08-01-desk-tablet-access-language-consent-design.md`)**:
  ① **공개 목록에서 뷰어 토큰 제거** — `GET /api/desk-sessions` 가 무인증인데 `t: viewerToken(s.id)` 를 실어
  보내, 인터넷에서 누구나 진행 중인 승객 대화를 수신하고 `desk-end` 로 응대를 원격 종료할 수 있었다
  (`deskCtlAllowed` 는 빈도만 제한). 토큰은 세션 파생 HMAC 이라 만료가 없다 — 바꾼 것은 수명이 아니라
  **얻는 경로**로, 이미 인증 게이트(`viewerAccessOk`)가 있는 `GET /api/qr?session=..` 로만 배포한다.
  ⚠ 랜딩 목록 선택 경로가 사라지지만 **안내원 부담은 줄어든다** — 그 경로는 매 부팅 데스크를 탭해야 했고,
  세션 QR 로 설치한 태블릿은 부팅하면 바로 그 데스크다. 회귀 테스트 `test/desk-access.test.mjs`,
  헬퍼 `deskToken()`(`test/helpers/boot.mjs`) — 기존 데스크 E2E 3개도 이 경로로 이관.
  ② **손님 언어 12개 스크롤 리스트** — `en ja zh vi th id ru tl es fr de ar`. 드럼 휠 대신 리스트인 이유:
  김포 국제선은 en/ja/zh 가 대다수인데 휠은 그 손님까지 스핀+확인 2동작을 요구한다. ⚠ **몽골어(mn)는 제외** —
  `LANGNAME` 에는 있으나 `SONIOX_LANGS` 에 없어 명시 선택도 자동감지도 불가(엔진 제약, 벤더를 바꿔도 동일).
  함께: `startConversation` 이 `GUEST_LANGS` 밖 선택을 조용히 `'en'` 으로 바꾸던 폴백 제거 → `SONIOX_LANGS`
  (60개)로 검증하고 미지원이면 자동감지로. **`GUEST_LANGS` 는 그대로 둔다** — 자동감지 `language_hints`
  전용이라 늘리면 힌트가 희석된다.
  ③ **개인정보 고지 모달** — 언어 선택 → 그 언어로 고지 → `[동의하고 시작]` → 발화 대기. 손님당 1회
  (응대 종료 후 다음 손님에게 다시). 자동감지 경로는 한국어+영어 병기, 아랍어는 `dir=rtl`.
  동의 시각은 `desk-start` 의 `consent` 필드 → `deskLog[].consentAt`(구버전 캐시 클라는 안 보내므로 생략 허용).
  문구에 **'AI 학습'은 쓰지 않았다** — 실제로 학습에 쓰지 않고, 그렇게 쓰면 별도 동의가 필요한 처리로
  해석될 여지가 있다. 보유기간·국외이전 업체명을 담은 전체 처리방침은 기관 산출물(범위 밖).
  ④ **코드로 해결 못 하는 운영 사항** — 안내원이 **노트북을 덮으면 그 데스크가 오프라인**이 된다. OS 절전으로
  마이크 캡처와 WS 가 끊기고 손님 화면은 '안내원 준비 중'이 된다. 덮개를 열면 조작 없이 복구되는 것은
  `test/desk-host-recovery.test.mjs` 로 확인했으나(급이탈·승계 두 경우 모두), 덮혀 있는 동안은 죽어 있다.
  게다가 하트비트가 30초(`HEARTBEAT_MS`)라 서버가 이탈을 알아채기 전 최대 30초 동안 태블릿은 데스크를
  '가동 중'으로 표시하고, 그 사이 손님이 언어를 고르면 Soniox 가 열려 과금된 채 무음 종료를 기다린다.
  → 전원 설정에서 "덮개를 닫을 때: 아무 것도 안 함" 으로 두거나 화면만 끄도록 운영 지침에 넣을 것.
```

- [ ] **Step 5: `README.md:12`의 안내데스크 설명을 갱신한다**

현재 줄:

```markdown
| **데스크 안내** | 안내데스크 상시 운영: 손님이 태블릿에서 언어 터치 → 양방향 통역. 지향성 마이크 2대(PC 직결) 또는 태블릿 마이크 2채널, 길안내 지도(호스트 승인제), TTS |
```

아래로 바꾼다. **"TTS"는 오기다** — `runDesk` 전 구간에 Cartesia 호출이 0건이고 `desk.html`에도 재생 코드가 없다(조달 심사 B8). 언어 수와 함께 정정한다.

```markdown
| **데스크 안내** | 안내데스크 상시 운영: 손님이 태블릿에서 12개 언어 중 선택(그 외 언어는 자동 감지) → 개인정보 고지·동의 → 양방향 통역. 지향성 마이크 2대(PC 직결) 또는 태블릿 마이크 2채널, 길안내 지도(호스트 승인제) |
```

- [ ] **Step 6: 전체 테스트와 빌드를 마지막으로 확인한다**

Run: `npm test && npm run build`
Expected: `pass 31 / fail 0`, 빌드 성공

- [ ] **Step 7: 커밋**

```bash
git add PROJECT_NOTES.md README.md
git commit -m "$(cat <<'EOF'
문서: 안내데스크 태블릿 3건 기록(접근제어·언어 12개·고지)

PROJECT_NOTES 운영/보안 섹션에 근거와 함정을 남긴다.
- 토큰 제거가 안내원 부담을 늘리지 않는 이유(랜딩 선택이 오히려 탭을 요구했다)
- 몽골어를 못 넣는 이유(Soniox 미지원 — 벤더를 바꿔도 동일)
- GUEST_LANGS 를 늘리면 안 되는 이유(자동감지 힌트 희석)
- 고지 문구에 'AI 학습'을 쓰지 않은 이유

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 완료 조건

- `npm test` 31/31 통과, `npm run build` 성공
- `curl /api/desk-sessions` 응답에 `t` 없음
- 태블릿 QR URL 로 열면: 언어 12개 리스트 → 고지(선택 언어) → 동의 → 발화 대기
- 세션 없이 `desk.html` 을 열면 입장 불가 + 관리자 QR 안내
- 커밋 4개
