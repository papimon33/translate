import fs from 'fs';
import { OPENAI_API_KEY } from '../config.js';
import { CATEGORIES } from './wayfind_dict.js';

/* ------------------------------------------------------------------ */
/*  데스크 길안내 — 시설 데이터 로드 + 카테고리→인스턴스 해석                */
/* ------------------------------------------------------------------ */
let _facilities = null; // { '1F':[{name,x,y,in_secure,...}], ... }
function loadFacilities() {
  if (_facilities) return _facilities;
  try {
    let s = fs.readFileSync(new URL('../../assets/map/wayfinding_data.js', import.meta.url), 'utf8');
    s = s.replace(/^\s*window\.AIRPORT_DATA\s*=/, '').replace(/;\s*$/, '');
    const d = JSON.parse(s);
    _facilities = d.facilities || {};
  } catch (e) { console.warn('[wayfind] 시설 데이터 로드 실패:', e.message); _facilities = {}; }
  return _facilities;
}
const DESK_FLOORS = ['1F', '2F', '3F', '4F'];
const catById = (id) => CATEGORIES.find((c) => c.id === id);
// 카테고리 ID → 목적지 배열. 보안구역(in_secure) 시설은 안내 대상에서 제외(일반구역만).
// 데스크 층 우선(그 층 일반구역 시설 전부), 없으면 층번호상 가까운 층 순.
export function resolveCategoryDests(catId, deskFloor) {
  const cat = catById(catId);
  if (!cat) return null;
  const fac = loadFacilities();
  const base = DESK_FLOORS.includes(deskFloor) ? deskFloor : '1F';
  const order = DESK_FLOORS.slice().sort((a, b) => Math.abs(DESK_FLOORS.indexOf(a) - DESK_FLOORS.indexOf(base)) - Math.abs(DESK_FLOORS.indexOf(b) - DESK_FLOORS.indexOf(base)));
  for (const fk of order) {
    const list = (fac[fk] || []).filter((f) => !f.in_secure && cat.match.some((m) => String(f.name).includes(m)));
    if (list.length) {
      // 같은(또는 거의 같은) 좌표의 중복 데이터 제거 — 지도에 경로가 겹쳐 2개 그려지던 문제
      const seen = new Set();
      const dests = [];
      for (const f of list) {
        const k = Math.round(f.x / 5) + ',' + Math.round(f.y / 5);
        if (seen.has(k)) continue;
        seen.add(k);
        dests.push({ floor: fk, x: f.x, y: f.y, name: f.name });
      }
      return { category: cat.id, ko: cat.ko, floor: fk, sameFloor: fk === base, dests };
    }
  }
  return null; // 일반구역에 해당 시설 없음 → 안내 안 함
}
// 직매칭 실패 + 위치 의도어 있을 때만 호출: gpt-5.4-mini 로 카테고리 분류(닫힌 집합)
// questionKo(직전 손님 질문의 한국어 번역)를 함께 주면 "저쪽 끝에 있어요"류 시설명 생략 답변도 분류 가능.
export async function classifyFacility(koText, questionKo) {
  if (!OPENAI_API_KEY) return null;
  const enumList = CATEGORIES.map((c) => `${c.id}(${c.ko})`).join(', ');
  const sys = `공항 안내 대화에서 언급된 시설을 아래 목록 중 하나의 id로만 분류한다.\n목록: ${enumList}\n부정("없다", "~말고")된 시설이나 해당 없음이면 none. 출력은 JSON {"id":"..."} 하나만.`;
  const user = questionKo ? `손님 질문: ${questionKo}\n안내원 답변: ${koText}` : koText;
  try {
    const body = { model: 'gpt-5.4-mini', messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], max_completion_tokens: 20, response_format: { type: 'json_object' }, reasoning_effort: 'none' };
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    const d = await r.json();
    const id = (JSON.parse(d?.choices?.[0]?.message?.content || '{}').id || '').trim();
    return catById(id) ? id : null;
  } catch { return null; }
}
