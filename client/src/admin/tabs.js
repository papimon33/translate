// 관리자 화면 탭 — 주소(/admin/<탭>)와 화면 위 탭이 같은 목록을 쓴다
export const ADMIN_TABS = [
  { v: 'usage', label: '사용량' },
  { v: 'logs', label: '로그' },
  { v: 'accounts', label: '계정 관리' },
  { v: 'terms', label: '용어 설정' },
  { v: 'system', label: '시스템·보안' },
];
export const isAdminTab = (v) => ADMIN_TABS.some((t) => t.v === v);
