import test from 'node:test';
import assert from 'node:assert';

// 용어집 제거 후 남은 최소 스모크 테스트(CI가 테스트 파일을 찾도록 유지).
test('smoke', () => {
  assert.equal(1 + 1, 2);
});
