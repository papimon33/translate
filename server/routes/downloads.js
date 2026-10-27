import { Readable } from 'node:stream';
import { DESKTOP_REPO, GITHUB_TOKEN, DESKTOP_DOWNLOAD_URL } from '../config.js';
import { requireAuth } from '../auth/index.js';

/* ---- 데스크톱 앱 배포 (GitHub Release 최신 설치본) — Windows(.exe) + macOS(.dmg) ----
   info: 최신 릴리스의 플랫폼별 설치파일 존재·버전·크기를 반환(10분 캐시).
   download?platform=win|mac: 비공개 repo 는 서버가 토큰으로 에셋을 스트리밍(사용자 GitHub 인증 불필요),
             공개 repo/토큰 없음이면 browser_download_url 로 리다이렉트, env 지정 시 그 주소로. */
let _desktopCache = { at: 0, data: null };
async function fetchLatestDesktop() {
  if (DESKTOP_DOWNLOAD_URL) {
    const fn = (DESKTOP_DOWNLOAD_URL.split('/').pop() || 'KAC-Translator-Setup.exe').split('?')[0];
    return { available: true, source: 'env', url: DESKTOP_DOWNLOAD_URL, win: { filename: fn }, mac: null };
  }
  if (_desktopCache.data && Date.now() - _desktopCache.at < 10 * 60 * 1000) return _desktopCache.data;
  let data;
  try {
    const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'kac-translator', 'X-GitHub-Api-Version': '2022-11-28' };
    if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
    // 최신순 릴리스 목록에서 '설치본 에셋(.exe/.dmg)이 하나라도 있는' 첫 릴리스를 고른다 —
    // 앱과 무관한 태그 릴리스가 섞여 있어도 데스크톱 설치본을 정확히 찾는다.
    const r = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases?per_page=20`, { headers: h });
    if (!r.ok) {
      data = { available: false, reason: r.status === 404 ? 'no-release' : `gh-${r.status}` };
    } else {
      const rels = await r.json();
      const assetInfo = (a) => (a ? { filename: a.name, size: a.size || null, assetId: a.id, browserUrl: a.browser_download_url || null } : null);
      let found = null;
      for (const rel of (Array.isArray(rels) ? rels : [])) {
        if (rel.draft) continue;
        const assets = Array.isArray(rel.assets) ? rel.assets : [];
        const win = assets.find((a) => /\.exe$/i.test(a.name));
        // mac: universal(인텔+애플실리콘 겸용) 우선, 없으면 첫 dmg
        const macs = assets.filter((a) => /\.dmg$/i.test(a.name));
        const mac = macs.find((a) => /universal/i.test(a.name)) || macs[0];
        // android: 버전마다 파일명이 달라 한 릴리스에 여러 개가 쌓일 수 있다 → 가장 최근에 올라온 것
        const android = assets.filter((a) => /\.apk$/i.test(a.name))
          .sort((x, y) => String(y.updated_at || '').localeCompare(String(x.updated_at || '')))[0];
        if (win || mac || android) { found = { rel, win, mac, android }; break; }
      }
      data = found
        ? { available: true, source: 'github', version: found.rel.tag_name || found.rel.name || null, publishedAt: found.rel.published_at || null, win: assetInfo(found.win), mac: assetInfo(found.mac), android: assetInfo(found.android) }
        : { available: false, reason: 'no-asset' };
    }
  } catch (e) {
    data = { available: false, reason: (e && e.message) || 'error' };
  }
  _desktopCache = { at: Date.now(), data };
  return data;
}
const platMeta = (a) => (a ? { filename: a.filename || null, size: a.size || null } : null);
async function sendLatestInstaller(res, plat) {
  const d = await fetchLatestDesktop();
  if (!d.available) return res.status(404).send('설치파일이 아직 준비되지 않았습니다. 관리자에게 문의하세요.');
  if (d.source === 'env') return res.redirect(d.url);
  const asset = plat === 'mac' ? d.mac : plat === 'android' ? d.android : d.win;
  const platName = { mac: 'macOS', android: 'Android', win: 'Windows' }[plat];
  if (!asset) return res.status(404).send(`${platName} 설치파일이 아직 준비되지 않았습니다.`);
  // 공개 repo 이고 서버 토큰이 없으면 GitHub 다운로드 URL 로 바로 보냄
  if (!GITHUB_TOKEN && asset.browserUrl) return res.redirect(asset.browserUrl);
  // 비공개 repo: 서버가 토큰으로 에셋 바이너리를 받아 그대로 흘려보냄(사용자 인증 불필요)
  try {
    const gh = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/assets/${asset.assetId}`, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'kac-translator', Authorization: `Bearer ${GITHUB_TOKEN}` },
      redirect: 'follow',
    });
    if (!gh.ok || !gh.body) return res.status(502).send('다운로드 실패: GitHub ' + gh.status);
    // APK 는 전용 MIME 이어야 안드로이드 브라우저가 다운로드 후 바로 설치 화면을 띄운다
    res.setHeader('Content-Type', plat === 'android' ? 'application/vnd.android.package-archive' : 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${(asset.filename || 'KAC-Translator-Setup').replace(/"/g, '')}"`);
    if (asset.size) res.setHeader('Content-Length', String(asset.size));
    Readable.fromWeb(gh.body).pipe(res);
  } catch (e) {
    res.status(502).send('다운로드 실패: ' + ((e && e.message) || '오류'));
  }
}

export function registerDownloadRoutes(app) {
  app.get('/api/desktop/info', requireAuth, async (req, res) => {
    const d = await fetchLatestDesktop();
    res.json({
      available: !!d.available,
      version: d.version || null,
      publishedAt: d.publishedAt || null,
      windows: d.available ? platMeta(d.win) : null,
      mac: d.available ? platMeta(d.mac) : null,
      android: d.available ? platMeta(d.android) : null,
      reason: d.available ? null : (d.reason || null),
    });
  });
  app.get('/download/desktop', requireAuth, (req, res) => {
    const plat = req.query.platform === 'mac' ? 'mac' : req.query.platform === 'android' ? 'android' : 'win';
    sendLatestInstaller(res, plat);
  });
  // 휴대폰 브라우저 접속 = 로그인 없이 앱 설치 안내(폰은 앱으로만 쓴다) — APK 는 공개 GitHub 릴리스와 같은 파일이고
  // 앱 안에서도 로그인해야 쓸 수 있으므로 공개해도 된다. 안드로이드만(데스크톱 설치본은 그대로 로그인 필요).
  app.get('/app', (req, res) => sendLatestInstaller(res, 'android')); // 앱 받기(2026-10-27, 예전 /download/android)
}
