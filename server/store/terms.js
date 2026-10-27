/* 고유명사/번역 설정(용어, v3 통합 모델) — 스키마·기본 시드·정규화·구형 마이그레이션 + 부팅 시 시드/병합.
   상태(termsConfig)와 저장(persistTermsConfig)은 store/index.js 가 소유한다. */
import { termsConfig, setTermsConfig, persistTermsConfig } from './index.js';

/* ---- 고유명사/번역설정 스키마 ----
   terms: { airline: string[], aviation: string[], etc: string[] } — 카테고리별 인식(STT) 힌트.
   translationTerms: [{ ko, en?, ja?, zh?, es?, fr?, pt?, ar? }] — 한 행 = 한 용어의 다국어 표기.
     세션 연결 시 활성 언어쌍의 표기만 골라 Soniox context 로 조립(비면 en → ko 폴백).
   구형(terms 배열 / {source,target} 쌍)은 로드·저장 시 자동 마이그레이션. */
export const TERM_LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'pt', 'ar'];
export const TERM_CATEGORIES = ['airline', 'aviation', 'facility', 'etc']; // 항공사·항공용어·시설·기타
export const DEFAULT_SERVED_LANGS = ['ko', 'en', 'ja', 'zh'];         // 필수 입력 대상(운영 언어) — 관리자가 변경
// 카테고리별 적용 대상: 데스크(손님 응대)엔 항공용어 불필요(예산 낭비) → 기본 제외
const DEFAULT_CATEGORY_SCOPE = {
  airline:  { desk: true,  session: true },
  aviation: { desk: false, session: true },
  facility: { desk: true,  session: true },
  etc:      { desk: true,  session: true },
};

// ── 통합 용어 모델(v3) ──
// termsConfig = { version:3, servedLangs, categoryScope, entries:[], updatedAt }
// entry = { id, category, scope:['*']|['zh',...], names:{ko(필수),en,ja,...}, mode }
//   mode 'pair'      : 활성 언어쌍 양방향 번역 + 인식
//   mode 'inputOnly' : 외국어 표기 → 한국어 단방향 번역 + 인식 (약칭·오인식 교정)
//   mode 'recognize' : 언어무관 인식 힌트만(번역쌍 없음) — 약어·고유명사(예: ICAO)
// scope: '*' 아니면 그 언어 세션에만 주입되고, 그 언어만 필수.

// 기본 시드(KAC 항공 도메인) — 저장된 설정이 없을 때만 1회 주입
const DEFAULT_TERMS_AVIATION = ['ICAO','IATA','FAA','KAC','IIAC','FIDS','CIQ','BHS','NOTAM','PBB','VDGS','FOD','A-CDM','MRO','ILS','AWOS','SCADA','AODB','EIRP','FIS','ASDE','BMS','AVSM'];
// 취항 항공사 다국어 표기 — es/fr/pt/ar 는 통상 영문 명칭을 쓰므로 비워 두면 en 으로 폴백된다.
// alt = 현지에서 통용되는 축약/구어 표기(언어별 배열). 인식(terms) 힌트로 쓰이고,
//        "축약형 → 한국어 정식명" 단방향 번역으로도 강제된다(예: 国航 → 중국국제항공).
// (파라타/섬에어 등 신생 항공사의 외국어 표기 일부는 미확정 — 원어민 검수 권장)
const DEFAULT_AIRLINES = [
  { ko: '대한항공', en: 'Korean Air', ja: '大韓航空', zh: '大韩航空' },
  { ko: '아시아나항공', en: 'Asiana Airlines', ja: 'アシアナ航空', zh: '韩亚航空' },
  { ko: '제주항공', en: 'Jeju Air', ja: 'チェジュ航空', zh: '济州航空' },
  { ko: '진에어', en: 'Jin Air', ja: 'ジンエアー', zh: '真航空' },
  { ko: '티웨이항공', en: "T'way Air", ja: 'ティーウェイ航空', zh: '德威航空' },
  { ko: '에어부산', en: 'Air Busan', ja: 'エアプサン', zh: '釜山航空' },
  { ko: '이스타항공', en: 'Eastar Jet', ja: 'イースター航空', zh: '易斯达航空' },
  { ko: '에어서울', en: 'Air Seoul', ja: 'エアソウル', zh: '首尔航空' },
  { ko: '에어로케이', en: 'Aero K', ja: 'エアロK' },
  { ko: '파라타항공', en: 'Parata Air', ja: 'パラタ航空', zh: '帕拉塔航空' }, // ja/zh 는 잠정 음역 — 검수 필요
  { ko: '섬에어' },
  { ko: '일본항공', en: 'Japan Airlines', ja: '日本航空', zh: '日本航空', alt: { ja: ['日航', 'JAL'] } },
  { ko: '전일본공수', en: 'All Nippon Airways', ja: '全日本空輸', zh: '全日空', alt: { ja: ['全日空', 'ANA'] } },
  { ko: '피치항공', en: 'Peach Aviation', ja: 'ピーチ・アビエーション', zh: '乐桃航空', alt: { ja: ['ピーチ'] } },
  { ko: '중국국제항공', en: 'Air China', ja: '中国国際航空', zh: '中国国际航空', alt: { zh: ['国航'] } },
  { ko: '중국남방항공', en: 'China Southern Airlines', ja: '中国南方航空', zh: '中国南方航空', alt: { zh: ['南航'] } },
  { ko: '중국동방항공', en: 'China Eastern Airlines', ja: '中国東方航空', zh: '中国东方航空', alt: { zh: ['东航'] } },
  { ko: '상하이항공', en: 'Shanghai Airlines', ja: '上海航空', zh: '上海航空', alt: { zh: ['上航'] } },
  { ko: '길상항공', en: 'Juneyao Air', ja: '吉祥航空', zh: '吉祥航空', alt: { zh: ['吉祥'] } },
  { ko: '춘추항공', en: 'Spring Airlines', ja: '春秋航空', zh: '春秋航空', alt: { zh: ['春秋'] } },
  { ko: '사천항공', en: 'Sichuan Airlines', ja: '四川航空', zh: '四川航空', alt: { zh: ['川航'] } },
  { ko: '하문항공', en: 'XiamenAir', ja: '厦門航空', zh: '厦门航空', alt: { zh: ['厦航'] } },
  { ko: '중화항공', en: 'China Airlines', ja: 'チャイナエアライン', zh: '中华航空' },
  { ko: '에바항공', en: 'EVA Air', ja: 'エバー航空', zh: '长荣航空' },
  { ko: '타이거에어 타이완', en: 'Tigerair Taiwan', ja: 'タイガーエア台湾', zh: '台湾虎航' },
  { ko: '캐세이퍼시픽항공', en: 'Cathay Pacific', ja: 'キャセイパシフィック航空', zh: '国泰航空' },
  { ko: '홍콩익스프레스', en: 'HK Express', ja: '香港エクスプレス', zh: '香港快运航空' },
  { ko: '마카오항공', en: 'Air Macau', ja: 'マカオ航空', zh: '澳门航空' },
  { ko: '베트남항공', en: 'Vietnam Airlines', ja: 'ベトナム航空', zh: '越南航空' },
  { ko: '비엣젯항공', en: 'VietJet Air', ja: 'ベトジェットエア', zh: '越捷航空' },
  { ko: '필리핀항공', en: 'Philippine Airlines', ja: 'フィリピン航空', zh: '菲律宾航空' },
  { ko: '세부퍼시픽', en: 'Cebu Pacific', ja: 'セブパシフィック航空', zh: '宿务太平洋航空' },
  { ko: '타이에어아시아엑스', en: 'Thai AirAsia X', ja: 'タイ・エアアジアX' },
  { ko: '몽골항공', en: 'MIAT Mongolian Airlines', ja: 'MIATモンゴル航空', zh: '蒙古航空' },
  { ko: '미아트 몽골항공', en: 'MIAT Mongolian Airlines', ja: 'MIATモンゴル航空', zh: '蒙古航空' },
  { ko: '싱가포르항공', en: 'Singapore Airlines', ja: 'シンガポール航空', zh: '新加坡航空' },
];
const DEFAULT_TRANSLATION_TERMS = [
  { ko: '주기장', en: 'apron' }, { ko: '램프', en: 'ramp' }, { ko: '슬롯', en: 'slot' },
  { ko: '터미널', en: 'terminal' }, { ko: '탑승구', en: 'gate' }, { ko: '항공기 유도', en: 'marshalling' },
  { ko: '토잉', en: 'towing' }, { ko: '토잉카', en: 'towing car' }, { ko: '푸시백', en: 'pushback' },
  { ko: '허브 공항', en: 'hub' }, { ko: '커브사이드', en: 'curbside' }, { ko: '랜드사이드', en: 'landside' },
  { ko: '에어사이드', en: 'airside' }, { ko: '수하물 수취대', en: 'baggage claim' }, { ko: '방빙유지시간', en: 'holdover time' },
  { ko: '제빙 작업', en: 'de-icing' }, { ko: '지상 활주', en: 'taxing' }, { ko: '유도로', en: 'taxiway' },
  { ko: '활주로', en: 'runway' }, { ko: '주기장 번호', en: 'stand' }, { ko: '보안검색', en: 'screening' },
  { ko: '촉수검색', en: 'pat-down' }, { ko: '회항', en: 'diversion' }, { ko: '체크인', en: 'check-in' },
  { ko: '탑승동', en: 'concourse' }, { ko: '턴어라운드', en: 'turnaround' }, { ko: '지상조업 시간', en: 'turnaround time' },
  { ko: '세관', en: 'customs' }, { ko: '출입국심사', en: 'immigration' }, { ko: '검역', en: 'quarantine' },
];

let _eidc = 0;
function entryId() { return 'e' + Date.now().toString(36) + (_eidc++).toString(36) + Math.random().toString(36).slice(2, 5); }
const cleanTerm = (v, n = 80) => String(v == null ? '' : v).trim().slice(0, n);

// 시드 → entries[]
function seedEntries() {
  const out = [];
  const namesOf = (o) => { const n = {}; for (const lg of TERM_LANGS) if (o[lg]) n[lg] = cleanTerm(o[lg]); return n; };
  for (const a of DEFAULT_AIRLINES) {
    out.push({ id: entryId(), category: 'airline', scope: ['*'], names: namesOf(a), mode: 'pair' });
    if (a.alt) for (const lg of Object.keys(a.alt)) for (const v of a.alt[lg])
      out.push({ id: entryId(), category: 'airline', scope: [lg], names: { ko: a.ko, [lg]: cleanTerm(v, 40) }, mode: 'inputOnly' });
  }
  for (const s of DEFAULT_TERMS_AVIATION) out.push({ id: entryId(), category: 'aviation', scope: ['*'], names: { ko: cleanTerm(s) }, mode: 'recognize' });
  for (const r of DEFAULT_TRANSLATION_TERMS) out.push({ id: entryId(), category: 'aviation', scope: ['*'], names: namesOf(r), mode: 'pair' });
  return out;
}

function sanitizeServed(v) {
  const arr = Array.isArray(v) ? v.filter((x) => TERM_LANGS.includes(x)) : [];
  const set = [...new Set(['ko', ...(arr.length ? arr : DEFAULT_SERVED_LANGS)])];
  return set.filter((x) => TERM_LANGS.includes(x));
}
export function sanitizeCatScope(v) {
  const out = {};
  for (const c of TERM_CATEGORIES) {
    const d = (v && v[c]) || DEFAULT_CATEGORY_SCOPE[c];
    out[c] = { desk: d.desk !== false, session: d.session !== false };
  }
  return out;
}
function normEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const category = TERM_CATEGORIES.includes(e.category) ? e.category : 'etc';
  const mode = ['pair', 'inputOnly', 'recognize'].includes(e.mode) ? e.mode : 'pair';
  let scope = Array.isArray(e.scope) ? [...new Set(e.scope.map((x) => String(x)).filter((x) => x === '*' || TERM_LANGS.includes(x)))] : [];
  if (!scope.length) scope = ['*'];
  const names = {};
  const src = e.names && typeof e.names === 'object' ? e.names : e; // names 없이 평면으로 와도 수용
  for (const lg of TERM_LANGS) { const v = cleanTerm(src[lg]); if (v) names[lg] = v; }
  if (!names.ko) return null; // ko 필수(키·타깃)
  return { id: (e.id && String(e.id).slice(0, 40)) || entryId(), category, scope, names, mode };
}

// 구형(terms{}, translationTerms[] with alt) → entries[]
function migrateToEntries(b) {
  const entries = [];
  const airlineKo = new Set(DEFAULT_AIRLINES.map((a) => a.ko));
  const avTermKo = new Set(DEFAULT_TRANSLATION_TERMS.map((r) => r.ko).concat(DEFAULT_TERMS_AVIATION));
  const pairKo = new Set();
  // 구형 {source,target} 또는 다국어 행
  for (const r of Array.isArray(b.translationTerms) ? b.translationTerms : []) {
    if (!r || typeof r !== 'object') continue;
    const names = {};
    if (r.source != null || r.target != null) { if (cleanTerm(r.target)) names.ko = cleanTerm(r.target); if (cleanTerm(r.source)) names.en = cleanTerm(r.source); }
    else for (const lg of TERM_LANGS) { const v = cleanTerm(r[lg]); if (v) names[lg] = v; }
    if (!names.ko) continue;
    pairKo.add(names.ko);
    const category = airlineKo.has(names.ko) ? 'airline' : (avTermKo.has(names.ko) ? 'aviation' : 'etc');
    entries.push({ id: entryId(), category, scope: ['*'], names, mode: 'pair' });
    if (r.alt && typeof r.alt === 'object') for (const lg of TERM_LANGS) for (const v of (Array.isArray(r.alt[lg]) ? r.alt[lg] : [])) {
      const av = cleanTerm(v, 40); if (av) entries.push({ id: entryId(), category, scope: [lg], names: { ko: names.ko, [lg]: av }, mode: 'inputOnly' });
    }
  }
  // 구형 terms(고유명사 문자열) → recognize (번역쌍이 이미 있는 ko 는 제외)
  const t = b.terms;
  const pushRec = (cat, s) => { const v = cleanTerm(s); if (v && !pairKo.has(v)) entries.push({ id: entryId(), category: cat, scope: ['*'], names: { ko: v }, mode: 'recognize' }); };
  if (Array.isArray(t)) for (const s of t) pushRec(DEFAULT_TERMS_AVIATION.includes(cleanTerm(s)) ? 'aviation' : 'etc', s);
  else if (t && typeof t === 'object') {
    for (const s of (Array.isArray(t.aviation) ? t.aviation : [])) pushRec('aviation', s);
    for (const s of (Array.isArray(t.etc) ? t.etc : [])) pushRec('etc', s);
    for (const s of (Array.isArray(t.facility) ? t.facility : [])) pushRec('facility', s);
    // t.airline 은 항공사 ko 이름의 중복이라 번역쌍이 커버 → 무시
  }
  return entries;
}

// 로드·PUT·업로드 공용 정규화 → 항상 v3 shape 반환
export function normalizeTermsConfig(b) {
  b = b || {};
  let entries;
  if (Array.isArray(b.entries)) { entries = []; for (const e of b.entries) { const n = normEntry(e); if (n) entries.push(n); if (entries.length >= 4000) break; } }
  else entries = migrateToEntries(b);
  return { version: 3, servedLangs: sanitizeServed(b.servedLangs), categoryScope: sanitizeCatScope(b.categoryScope), entries };
}

/* ---- 용어 기본 번역 병합(부팅 시 1회, 멱등) ----
   저장소(Mongo/파일) 어디에 있든, 아래 표의 한국어 용어에서 en/ja/zh 가 비어 있으면 채운다.
   (파일만 고치면 Mongo 환경에 반영되지 않던 문제 — 코드 레벨 병합으로 로컬·배포 모두 보장) */
const TERM_FILL = {
  '주기장': { ja: '駐機場', zh: '停机坪' }, '램프': { ja: 'ランプ', zh: '机坪' }, '슬롯': { ja: 'スロット', zh: '时刻' },
  '터미널': { ja: 'ターミナル', zh: '航站楼' }, '탑승구': { ja: '搭乗口', zh: '登机口' }, '항공기 유도': { ja: 'マーシャリング', zh: '飞机引导' },
  '토잉': { ja: 'トーイング', zh: '拖曳' }, '토잉카': { ja: 'トーイングカー', zh: '拖车' }, '푸시백': { ja: 'プッシュバック', zh: '推出' },
  '허브 공항': { ja: 'ハブ空港', zh: '枢纽机场' }, '커브사이드': { ja: 'カーブサイド', zh: '路边区' }, '랜드사이드': { ja: 'ランドサイド', zh: '陆侧' },
  '에어사이드': { ja: 'エアサイド', zh: '空侧' }, '수하물 수취대': { ja: '手荷物受取台', zh: '行李转盘' },
  '방빙유지시간': { ja: '防氷持続時間', zh: '防冰保持时间' }, '제빙 작업': { ja: '除氷作業', zh: '除冰作业' },
  '지상 활주': { ja: '地上走行', zh: '滑行' }, '유도로': { ja: '誘導路', zh: '滑行道' }, '활주로': { ja: '滑走路', zh: '跑道' },
  '주기장 번호': { ja: 'スポット番号', zh: '机位号' }, '보안검색': { ja: '保安検査', zh: '安检' }, '촉수검색': { ja: '接触検査', zh: '人身检查' },
  '회항': { ja: 'ダイバート', zh: '备降' }, '체크인': { ja: 'チェックイン', zh: '值机' }, '탑승동': { ja: 'コンコース', zh: '登机廊' },
  '턴어라운드': { ja: 'ターンアラウンド', zh: '过站' }, '지상조업 시간': { ja: 'ターンアラウンドタイム', zh: '过站时间' },
  '세관': { ja: '税関', zh: '海关' }, '출입국심사': { ja: '出入国審査', zh: '边检' }, '검역': { ja: '検疫', zh: '检疫' },
  '에어로케이': { zh: 'Aero K' }, '타이에어아시아엑스': { zh: '泰国亚洲航空长途' },
  '섬에어': { en: 'Sum Air', ja: 'サムエア', zh: 'Sum Air' }, // 기존에 ko 만 있던 항목도 채움(추가 목록만으론 스킵됨)
};
const TERM_FILL_ADD = [ // 없으면 추가되는 항목
  { category: 'airline', scope: ['*'], names: { ko: '섬에어', en: 'Sum Air', ja: 'サムエア', zh: 'Sum Air' }, mode: 'pair' },
];

/* 부팅 시 1회(loadStore 직후 — index.js): 저장된 설정이 없으면 기본 시드, 구형이면 v3 로 마이그레이션, 이어서 기본 번역 병합 */
export async function initTermsConfig() {
  if (!termsConfig.updatedAt) {
    setTermsConfig({ version: 3, servedLangs: DEFAULT_SERVED_LANGS.slice(), categoryScope: sanitizeCatScope(), entries: seedEntries(), updatedAt: Date.now() });
    try { await persistTermsConfig(); console.log('[terms] 기본 용어 시드 저장 (v3)'); } catch (e) { console.error('[terms] 시드 저장 실패', e); }
  } else if (!Array.isArray(termsConfig.entries)) {
    // 구형(terms/translationTerms) → v3 entries 자동 마이그레이션(1회). 시드에만 있고 없는 항목은 병합.
    const mig = normalizeTermsConfig(termsConfig);
    const haveKey = new Set(mig.entries.map((e) => e.category + '|' + e.mode + '|' + (e.names.ko || '') + '|' + (e.scope || []).join(',')));
    for (const se of seedEntries()) { const k = se.category + '|' + se.mode + '|' + (se.names.ko || '') + '|' + (se.scope || []).join(','); if (!haveKey.has(k)) mig.entries.push(se); }
    setTermsConfig({ ...mig, updatedAt: Date.now() });
    try { await persistTermsConfig(); console.log(`[terms] 구형 → v3 통합모델 마이그레이션 (${termsConfig.entries.length} entries)`); } catch (e) { console.error('[terms] 마이그레이션 저장 실패', e); }
  }
  {
    let filled = 0, added = 0;
    for (const e of termsConfig.entries || []) {
      if (e.mode !== 'pair' || !e.names) continue;
      const f = TERM_FILL[e.names.ko];
      if (!f) continue;
      for (const [lg, v] of Object.entries(f)) if (!e.names[lg]) { e.names[lg] = v; filled++; }
    }
    for (const add of TERM_FILL_ADD) {
      if (!(termsConfig.entries || []).some((e) => e.mode === 'pair' && e.names && e.names.ko === add.names.ko)) {
        termsConfig.entries.push({ id: 'fill' + Math.random().toString(36).slice(2, 8), ...add });
        added++;
      }
    }
    if (filled || added) {
      termsConfig.updatedAt = Date.now();
      try { await persistTermsConfig(); console.log(`[terms] 기본 번역 병합 — ${filled}칸 채움, ${added}항목 추가`); } catch (e) { console.error('[terms] 병합 저장 실패', e); }
    }
  }
}
