// 관리자 화면 공용 표시 형식(시간·비용·날짜·언어명)
export function fmtDuration(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s % 60}초`;
  return `${s}초`;
}

export function fmtCost(usd) {
  return '$' + (usd || 0).toFixed(usd >= 1 ? 2 : 3);
}

export function fmtMin(m) {
  return (m || 0).toFixed(m >= 10 ? 0 : 1) + '분';
}

export const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export const LANG_KO = { en: '영어', ja: '일본어', zh: '중국어', vi: '베트남어', th: '태국어', id: '인도네시아어', ru: '러시아어', ko: '한국어', unknown: '미상' };

export const kstDayStr = (offset = 0) => new Date(Date.now() + 9 * 3600e3 - offset * 86400e3).toISOString().slice(0, 10);

export const fmtClock = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
