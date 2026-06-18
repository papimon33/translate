import test from 'node:test';
import assert from 'node:assert/strict';
import { setGlossary, annotate, glossarySize } from '../glossary.js';

test('한글 최장 매칭: "제2계류장" 이 "계류장" 보다 우선', () => {
  setGlossary([
    { ko: '계류장', en: 'APRON', meaning: '주기장' },
    { ko: '제2계류장', en: 'APRON 2', meaning: '두번째 주기장' },
  ]);
  assert.equal(glossarySize(), 2);

  const a = annotate('제2계류장으로 이동');
  assert.equal(a.length, 1);
  assert.equal(a[0].term, '제2계류장');

  const b = annotate('계류장 점검');
  assert.equal(b.length, 1);
  assert.equal(b[0].term, '계류장');
});

test('한글 부분일치 + 다중 매칭', () => {
  setGlossary([
    { ko: '작동기', meaning: '액추에이터' },
    { ko: '음향 라이너', meaning: '소음 흡수재' },
  ]);
  const m = annotate('작동기 점검 후 음향 라이너 교체');
  assert.equal(m.length, 2);
  assert.deepEqual(m.map((x) => x.term), ['작동기', '음향 라이너']);
});

test('영문은 매칭하지 않음(한글 전용)', () => {
  setGlossary([{ ko: '작동기', en: 'ACTUATOR', meaning: 'x' }]);
  assert.equal(annotate('The ACTUATOR failed').length, 0);
  assert.equal(annotate('작동기 고장').length, 1);
});

test('매칭 없음 / 빈 사전', () => {
  setGlossary([]);
  assert.equal(glossarySize(), 0);
  assert.equal(annotate('아무거나').length, 0);
});
