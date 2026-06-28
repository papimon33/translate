/* 데스크 길안내 — 시설 카테고리 사전 + 위치 의도어.
 *
 * 목적: 손님 발화의 '한국어 번역문'에서 어떤 시설을 찾는지 알아내 map.showRoute() 로 안내.
 * 설계:
 *   - 카테고리 ID(슬러그) = 언어중립 enum. 사전/LLM 출력이 이 ID로 떨어짐(한글명 모호성 제거).
 *   - 한 카테고리 → 여러 인스턴스를 'match'(시설 name 부분일치) + 맵 데이터의 'tags' 로 흡수.
 *   - 매칭은 '한국어 번역문'에만 돌리므로 한국어 동의어(syn)만 관리.
 *
 * 사용(서버):
 *   const { detectCategory, INTENT_WORDS, CATEGORIES } = require('./wayfind_dict');
 *   const hit = detectCategory(koText);         // 직매칭 → {id, ...} | null  (AI 0회)
 *   const isQuestion = INTENT_WORDS.some(w => koText.includes(w)); // 위치 의도어
 *   // 직매칭 실패 + 의도어 있음 → 그때만 gpt-mini 로 CATEGORIES.map(c=>c.id) 중 분류(폴백)
 *
 * 시설 해석(맵): 카테고리 → 인스턴스
 *   facilitiesOfFloor.filter(f => cat.match.some(m => f.name.includes(m)) || (f.tags||[]).includes(cat.id))
 *   → 데스크 층에 있으면 그 층 전부, 없으면 다른 층(가까운 순/전부).  ['탑승구'는 번호와 함께 특수 처리]
 */

const CATEGORIES = [
  // id            한글표시        match(시설 name 부분일치)            syn(번역문에서 찾을 한국어 동의어)
  { id: 'restroom',   ko: '화장실',     match: ['화장실'],                 syn: ['화장실', '변소', '볼일', '세면', '용변', '소변', '대변'] },
  { id: 'smoking',    ko: '흡연장',     match: ['흡연'],                   syn: ['흡연', '담배', '끽연', '흡연실', '흡연구역'] },
  { id: 'pharmacy',   ko: '약국',       match: ['약국'],                   syn: ['약국', '약방', '상비약', '진통제', '두통약', '약 사', '약 좀', '약 어디'] },
  { id: 'convenience',ko: '편의점',     match: ['편의점', 'CU'],            syn: ['편의점', '씨유', '시유', '물 사', '간식'] },
  { id: 'exchange',   ko: '환전소',     match: ['환전'],                   syn: ['환전', '환전소', '바꾸', '달러', '엔화', '외화', '환율', 'atm', '현금', '인출', '출금'] },
  { id: 'charging',   ko: '휴대폰 충전소', match: ['충전'],                 syn: ['충전', '충전기', '배터리', '콘센트', '폰 충전', '휴대폰 충전'] },
  { id: 'lounge',     ko: '라운지',     match: ['라운지'],                 syn: ['라운지', '쉴 곳', '쉬는 곳', '휴식'] },
  { id: 'nursing',    ko: '유아휴게실', match: ['유아휴게', '수유'],        syn: ['유아휴게실', '수유실', '기저귀', '아기', '젖먹', '유아실'] },
  { id: 'prayer',     ko: '기도실',     match: ['기도실'],                 syn: ['기도실', '기도', '예배', '무슬림'] },
  { id: 'water',      ko: '음수대',     match: ['음수대'],                 syn: ['음수대', '정수기', '식수', '물 마시', '물 좀'] },
  { id: 'security',   ko: '보안검색',   match: ['보안검색'],               syn: ['보안검색', '검색대', '보안검사', '엑스레이', '짐 검사'] },
  { id: 'immigration',ko: '출입국 심사', match: ['출국심사', '입국심사'],   syn: ['출국심사', '입국심사', '심사대', '여권 심사', '이민국'] },
  { id: 'customs',    ko: '세관',       match: ['세관'],                   syn: ['세관', '신고', '관세', '면세 한도'] },
  { id: 'duty_free',  ko: '면세점',     match: ['면세'],                   syn: ['면세점', '면세', '듀티프리', '인도장', '면세품'] },
  { id: 'info_desk',  ko: '안내데스크', match: ['안내데스크'],             syn: ['안내데스크', '안내소', '인포메이션', '문의'] },
  { id: 'baggage',    ko: '수하물 수취', match: ['수화물', '수하물'],        syn: ['수하물', '수화물', '짐 찾', '캐리어', '벨트', '짐 어디'] },
  { id: 'gate',       ko: '탑승구',     match: ['탑승구'],                 syn: ['탑승구', '게이트', '탑승', '보딩'] }, // 번호와 함께 특수 처리
  { id: 'food',       ko: '식당',       match: ['키친', '파리바게뜨', '스타벅스', '파스쿠찌', '에그드랍', '공차', '던킨', '마리짱', '하늘찬', '대청마루', '옐로우인더화이트', '정테이블', '카페'], syn: ['식당', '밥', '먹을', '맛집', '음식', '배고', '레스토랑', '카페', '커피', '마실'] },
  { id: 'ticket',     ko: '버스 매표소', match: ['버스매표소', '매표소'],    syn: ['버스', '매표소', '버스표', '공항버스', '리무진'] },
  { id: 'wheelchair', ko: '휠체어 대여', match: ['휠체어'],                 syn: ['휠체어', '거동', '다리 불편'] },
  { id: 'stroller',   ko: '유모차 대여', match: ['유모차'],                 syn: ['유모차', '아기 차'] },
  { id: 'aed',        ko: '자동제세동기', match: ['제세동기'],              syn: ['제세동기', '심장', '응급', '심정지'] },
  { id: 'elevator',   ko: '엘리베이터', match: ['엘리베이터'],             syn: ['엘리베이터', '승강기', '리프트'] },
  { id: 'escalator',  ko: '에스컬레이터', match: ['에스컬레이터'],          syn: ['에스컬레이터', '에스컬'] },
  { id: 'stairs',     ko: '계단',       match: ['계단'],                   syn: ['계단', '층계'] },
];

// 위치 의도어(질문 기준). 외국인 질문에서 직매칭 실패 시 이 신호가 있을 때만 LLM 폴백.
const INTENT_WORDS = [
  '어디', '어딨', '어느 쪽', '어느쪽', '가는 길', '가려면', '가고 싶', '가야', '가 보',
  '위치', '찾고', '찾아', '찾는', '어떻게 가', '로 가', '으로 가', '가까운', '근처', '있나요', '있어요',
];

// 위치 안내 단서(답변 기준). 안내원의 '한국어 답변'에서 직매칭 실패 시 이 신호가 있을 때만 LLM 폴백.
// 직원이 길을 알려줄 때 쓰는 방향·층 표현. (질문형 어디/어딨 등은 답변엔 거의 없음)
const ANSWER_WORDS = [
  '층', '오른쪽', '왼쪽', '이쪽', '저쪽', '쪽으로', '쪽에',
  '직진', '쭉', '끝', '코너', '모퉁이', '맞은편', '건너',
  '가시면', '가세요', '가시고', '올라가', '내려가', '내려오', '걸어가', '가다 보면', '가다보면',
  '지나', '보이', '나오', '방향', '이용하시', '이용 가능', '가능합니다',
];

// 번역문에서 직매칭(AI 0회). 여러 개 걸리면 모두 반환(가장 먼저=주 후보).
function detectCategory(koText) {
  if (!koText) return [];
  const t = String(koText).toLowerCase();
  const hits = [];
  for (const c of CATEGORIES) {
    if (c.syn.some((s) => t.includes(String(s).toLowerCase()))) hits.push(c);
  }
  return hits;
}
function isLocationQuestion(koText) {
  if (!koText) return false;
  const t = String(koText);
  return INTENT_WORDS.some((w) => t.includes(w));
}
// 안내원 답변이 '위치/길안내' 성격인지(직매칭 폴백 게이트). 방향·층 단서가 하나라도 있으면 true.
function isLocationAnswer(koText) {
  if (!koText) return false;
  const t = String(koText);
  return ANSWER_WORDS.some((w) => t.includes(w));
}

export { CATEGORIES, INTENT_WORDS, ANSWER_WORDS, detectCategory, isLocationQuestion, isLocationAnswer };
