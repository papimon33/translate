/* 데스크톱 앱 설치본은 로그인 없이 받는다(2026-10-28, 로그인 화면 아래 링크) — 설치된 앱의 자동 업데이트도 같은 주소.
   DESKTOP_DOWNLOAD_URL 을 주면 서버가 그 주소로 보낸다(테스트에서 GitHub 를 부르지 않게). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootServer } from './helpers/boot.mjs';

test('데스크톱 설치본: 로그인 없이 /download/desktop 이 설치본 주소로 보낸다', { timeout: 30000 }, async (t) => {
  const url = 'https://example.com/AirTalk-Setup.exe';
  const srv = await bootServer({ DESKTOP_DOWNLOAD_URL: url });
  t.after(() => srv.stop());
  for (const q of ['', '?platform=mac', '?platform=win']) {
    const r = await fetch(srv.base + '/download/desktop' + q, { redirect: 'manual' });
    assert.equal(r.status, 302, q);
    assert.equal(r.headers.get('location'), url);
  }
  assert.equal((await fetch(srv.base + '/api/desktop/info')).status, 401, '설치본 정보 API 는 그대로 로그인 필요');
});
