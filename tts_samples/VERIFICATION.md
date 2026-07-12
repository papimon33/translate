# TTS 샘플 음성 검증 리포트

- 생성: Cartesia sonic-3.5 (tts_samples/) · 검증: Soniox stt-async-preview (언어 힌트 지정)
- 판정: 원문 대비 CER ≤ 10% = PASS (문장부호·공백 무시 정규화 후 비교)
- 결과: **10/10 PASS** · 2026-07-12 07:11 UTC

| 파일 | 기대 문장 | 인식 결과 | CER | 판정 |
|---|---|---|---|---|
| en/en_female.mp3 | Hello, this is a voice test. | Hello, this is a voice test. | 0.0% | ✅ PASS |
| en/en_male.mp3 | Hello, this is a voice test. | Hello, this is a voice test. | 0.0% | ✅ PASS |
| ja/ja_female.mp3 | こんにちは、音声テストです。 | こんにちは、音声テストです。 | 0.0% | ✅ PASS |
| ja/ja_male.mp3 | こんにちは、音声テストです。 | こんにちは、音声テストです。 | 0.0% | ✅ PASS |
| zh/zh_female.mp3 | 你好，这是语音测试。 | 你好，这是语音测试。 | 0.0% | ✅ PASS |
| zh/zh_male.mp3 | 你好，这是语音测试。 | 你好，这是语音测试。 | 0.0% | ✅ PASS |
| ru/ru_female.mp3 | Здравствуйте, это голосовой тест. | Здравствуйте, это голосовой тест. | 0.0% | ✅ PASS |
| ru/ru_male.mp3 | Здравствуйте, это голосовой тест. | Здравствуйте, это голосовой тест. | 0.0% | ✅ PASS |
| es/es_female.mp3 | Hola, esta es una prueba de voz. | Hola, esto es una prueba de voz. | 4.2% | ✅ PASS |
| es/es_male.mp3 | Hola, esta es una prueba de voz. | Hola, esto es una prueba de voz. | 4.2% | ✅ PASS |

정규화 비교 기준: normalize("Hello, this is a voice test.") → "hellothisisavoicetest"