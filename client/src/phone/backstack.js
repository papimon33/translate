/* 폰 화면 뒤로가기(안드로이드 하드웨어 버튼 = 웹 history.back) — 시트·확인 창이 떠 있으면 화면 이동 대신 그 창만 닫는다.
   창이 하나라도 열려 있으면 history 에 항목 하나를 더 쌓아 두고, 뒤로가기가 그 항목을 꺼내면 맨 위 창을 닫는다.
   화면에서 닫으면(바깥 탭·취소) 그 항목을 우리가 꺼낸다. 시트 → 시트로 바로 바뀌는 경우(세션 설정 → 언어)는 닫힘과 열림이
   같은 순간이라 꺼냈다 다시 쌓지 않는다(history.back 은 비동기라 바로 pushState 하면 순서가 꼬인다).
   이 모듈은 MobileApp 보다 먼저 popstate 를 듣는다(import 시점 등록) — 창 닫기에 쓴 popstate 는 다른 리스너로 넘기지 않는다. */
const stack = []; // [{ id, close }] 열린 순서
let seq = 0;
let entry = false; // 창 닫기용 history 항목이 맨 위에 있는가
let ignore = 0;    // 우리가 부른 history.back 이 만들 popstate 수
let dropTimer = null;

function ensureEntry() {
  if (entry) return;
  try { window.history.pushState({ ...(window.history.state || {}), overlay: true }, ''); entry = true; } catch {}
}
function scheduleDrop() {
  clearTimeout(dropTimer);
  dropTimer = setTimeout(() => {
    if (stack.length || !entry) return;
    entry = false;
    ignore++;
    try { window.history.back(); } catch { ignore--; }
  }, 0);
}

export function openOverlay(close) {
  const id = ++seq;
  stack.push({ id, close });
  clearTimeout(dropTimer);
  ensureEntry();
  return id;
}
export function closeOverlay(id) {
  const i = stack.findIndex((x) => x.id === id);
  if (i < 0) return;
  stack.splice(i, 1);
  if (!stack.length) scheduleDrop();
}

// 화면 이동(pushState) — 창 항목이 남아 있으면 그 자리를 덮어써 뒤로가기 한 번이 빈 항목에 먹히지 않게
export function pushNav(state) {
  clearTimeout(dropTimer);
  try {
    if (entry) { entry = false; window.history.replaceState(state, ''); } else window.history.pushState(state, '');
  } catch {}
}
// 화면 하나 뒤로(열린 창들은 곧 함께 사라진다 — 창 항목까지 한 번에 꺼냄)
export function backNav() {
  clearTimeout(dropTimer);
  stack.length = 0;
  const n = entry ? 2 : 1;
  entry = false;
  try { window.history.go(-n); } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    if (ignore > 0) { ignore--; e.stopImmediatePropagation(); return; }
    if (!entry || !stack.length) return; // 일반 화면 이동 — MobileApp 이 처리
    entry = false;
    e.stopImmediatePropagation();
    const top = stack.pop();
    try { top.close(); } catch {}
    if (stack.length) ensureEntry(); // 아래에 창이 더 있으면 다음 뒤로가기도 창 닫기
  });
}
