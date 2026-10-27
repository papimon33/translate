import { CARTESIA_API_KEY, CARTESIA_VERSION, CARTESIA_MODEL } from '../config.js';
import { requireAuth, hasPerm } from '../auth/index.js';
import { cartesiaVoiceId, TTS_TEST_PHRASE } from '../vendors/cartesia.js';

export function registerMiscRoutes(app) {
  /* 보이스 미리듣기: 출력언어+성별로 짧은 테스트 음성(wav) 생성 */
  app.post('/api/tts/preview', requireAuth, async (req, res) => {
    if (!hasPerm(req.user, 'tts')) return res.status(403).json({ error: 'TTS 권한이 없습니다. 관리자에게 요청하세요.' });
    if (!CARTESIA_API_KEY) return res.status(400).json({ error: 'CARTESIA_API_KEY 미설정' });
    const b = req.body || {};
    const lang = ['ko', 'en', 'ja', 'zh'].includes(b.lang) ? b.lang : 'ko';
    const gender = b.gender === 'm' ? 'm' : 'f';
    try {
      const r = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: { 'X-API-Key': CARTESIA_API_KEY, 'Cartesia-Version': CARTESIA_VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: CARTESIA_MODEL, transcript: TTS_TEST_PHRASE[lang], voice: { mode: 'id', id: cartesiaVoiceId(lang, gender) }, language: lang, output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 } }),
      });
      if (!r.ok) return res.status(502).json({ error: 'tts ' + r.status });
      res.setHeader('Content-Type', 'audio/wav');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /* 헬스체크 (Render healthCheck / UptimeRobot 슬립 방지용 핑) */
  app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
}
