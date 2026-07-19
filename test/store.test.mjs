/* 저장소 회귀 테스트 — 손상 파일 1개가 전체 데이터 유실로 번지지 않는다(2026-07-16 수정 고정).
   기대: 손상 sessions.json → .corrupt-<ts> 백업 생성 + 서버는 정상 기동 + 나머지 저장소는 정상 로드. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer, loginAdmin } from './helpers/boot.mjs';

test('손상된 sessions.json 이 있어도 기동하고, 원본을 .corrupt 로 백업하며, 다른 파일은 정상 로드한다', { timeout: 40000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airtalk-corrupt-'));
  fs.writeFileSync(path.join(dataDir, 'sessions.json'), '{이건 JSON 이 아님');
  fs.writeFileSync(path.join(dataDir, 'desk_registry.json'), JSON.stringify({ desks: [{ id: 'd1', name: '살아있는 데스크', floor: '1F', side: 'S' }] }));

  const srv = await bootServer({ DATA_DIR: dataDir });
  t.after(() => srv.stop());

  // 손상 파일 백업 생성 확인(복구 여지 보존)
  const backups = fs.readdirSync(dataDir).filter((f) => f.startsWith('sessions.json.corrupt-'));
  assert.equal(backups.length, 1, '손상 원본이 .corrupt-<ts> 로 백업돼야 함: ' + fs.readdirSync(dataDir).join(', '));

  // 이후 파일(desk_registry)은 정상 로드 — 이전 단일 try/catch 에선 전부 빈 상태로 떴다
  const cookie = await loginAdmin(srv.base);
  const reg = await fetch(`${srv.base}/api/desk-registry`, { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.equal(reg.desks?.[0]?.name, '살아있는 데스크');

  // 세션은 빈 상태로 시작(손상분은 백업에만 존재)
  const list = await fetch(`${srv.base}/api/sessions`, { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.deepEqual(list, []);
});
