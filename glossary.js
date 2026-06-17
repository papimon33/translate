/* ================================================================== */
/*  용어집 매칭 (Aho-Corasick)                                         */
/*  - 영문(en): 단어 경계 + 대소문자 무시                              */
/*  - 한글(ko): 부분 일치                                              */
/*  - 겹치면 '가장 긴 매칭' 우선 (예: "APRON 2" 가 "APRON" 보다 우선)  */
/* ================================================================== */

let root = null; // 자동자 루트
let patterns = []; // { norm, orig, meaning, lang, len }
let count = 0;

function isAlnum(ch) {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

// rows: [{ en, ko, meaning }]
export function setGlossary(rows) {
  patterns = [];
  count = 0;
  for (const r of rows || []) {
    const meaning = (r.meaning || '').trim();
    if (r.en && r.en.trim()) patterns.push({ orig: r.en.trim(), norm: r.en.trim().toLowerCase(), meaning, lang: 'en' });
    if (r.ko && r.ko.trim()) patterns.push({ orig: r.ko.trim(), norm: r.ko.trim().toLowerCase(), meaning, lang: 'ko' });
  }
  patterns.forEach((p) => (p.len = p.norm.length));
  count = patterns.length;
  build();
}

export function glossarySize() {
  return count;
}

function build() {
  root = { next: Object.create(null), fail: null, out: [] };
  // trie 삽입
  patterns.forEach((p, id) => {
    let node = root;
    for (const ch of p.norm) {
      if (!node.next[ch]) node.next[ch] = { next: Object.create(null), fail: null, out: [] };
      node = node.next[ch];
    }
    node.out.push(id);
  });
  // fail 링크 (BFS)
  const queue = [];
  for (const ch in root.next) {
    root.next[ch].fail = root;
    queue.push(root.next[ch]);
  }
  while (queue.length) {
    const cur = queue.shift();
    for (const ch in cur.next) {
      const child = cur.next[ch];
      let f = cur.fail;
      while (f && !f.next[ch]) f = f.fail;
      child.fail = f ? f.next[ch] : root;
      child.out = child.out.concat(child.fail.out);
      queue.push(child);
    }
  }
}

/* 텍스트에서 용어 구간을 찾아 [{ start, end, term, meaning }] 반환 (end 는 exclusive).
   lang 은 표시 텍스트 언어 힌트(en 패턴은 단어경계, 그 외엔 부분일치). */
export function annotate(text) {
  if (!root || !text || !count) return [];
  const lower = text.toLowerCase(); // 영문 대소문자 무시 (한글엔 영향 없음)
  const hits = [];
  let node = root;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    while (node && !node.next[ch]) node = node.fail;
    node = node ? node.next[ch] : root;
    if (!node) {
      node = root;
      continue;
    }
    for (const id of node.out) {
      const p = patterns[id];
      const start = i - p.len + 1;
      if (start < 0) continue;
      if (p.lang === 'en') {
        // 단어 경계: 앞뒤가 영숫자가 아니어야 함
        if (isAlnum(text[start - 1]) || isAlnum(text[i + 1])) continue;
      }
      hits.push({ start, end: i + 1, term: p.orig, meaning: p.meaning, len: p.len });
    }
  }
  if (!hits.length) return [];
  // 최장 우선 + 비겹침: start 오름차순, 길이 내림차순으로 그리디 선택
  hits.sort((a, b) => a.start - b.start || b.len - a.len);
  const out = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start >= lastEnd) {
      out.push({ start: h.start, end: h.end, term: h.term, meaning: h.meaning });
      lastEnd = h.end;
    }
  }
  return out;
}
