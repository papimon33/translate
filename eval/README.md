# 번역 정확성 평가 (eval)

실제 사람이 발화한 **7개국어 질문/답변**을 통해 STT(원문 인식)와 번역을 **분리 측정**하고,
오류를 유형별로 뽑아 개선 우선순위를 정하기 위한 평가 세트.

- 언어: 영어(en)·중국어(zh)·일본어(ja)·스페인어(es)·프랑스어(fr)·포르투갈어(pt)·아랍어(ar)
- 방향:
  - **질문(q)** — 외국인 발화 → 한국어 번역 (외국어 STT + 외→한 MT)
  - **답변(a)** — 한국인 발화 → 외국어 번역 (한국어 STT + 한→외 MT)

## 핵심 원칙: 단계 분리

최종 번역만 채점하면 "잘못 들은 것"과 "잘못 번역한 것"을 구분할 수 없다.
데스크 파이프라인은 각 발화의 **인식 원문(`source`)** 과 **번역(`texts`)** 을 함께 기록하므로,
둘을 각각 채점해 오류를 귀속한다:

| 인식(CER) | 번역(적합성) | 귀속 | 대응 |
|---|---|---|---|
| 정상 | 나쁨 | **MT 탓** | 용어집·프롬프트 개선 |
| 나쁨 | 나쁨 | **STT 탓** | language_hints·마이크·endpoint |
| 나쁨 | 정상 | STT 오류를 번역이 복원 | (관찰만) |
| 정상 | 정상 | 정상 | — |

## 파일

- `gen_dataset.py` — **정답셋의 원본(single source of truth)**. 번역을 여기서 저작 → `dataset.json` +
  `wordfiles/*.docx`(언어별) 생성. 내용 수정은 이 파일에서 하고 `python3 eval/gen_dataset.py` 재실행.
- `dataset.json` — 생성물(채점기 입력). 30개 시나리오(난이도 하·중·상 각 10). 시나리오별 `question.src`(외국어 원문, 언어별)·
  `question.ko_ref`(한국어 모범 번역), `answer.ko_src`(한국어 원문)·`answer.ref`(외국어 모범 번역, 언어별), `traps`.
  항공사명 포함 10문항, 버스터미널 1문항, 항공편 답변 일부는 "항공사 카운터 문의"로 유도.
  ⚠️ es/fr/pt/ar 은 **초안** — 원어민 검수 후 확정할 것.
- `wordfiles/KAC_평가_<언어>.docx` — 언어별 낭독 카드 7종. **질문=원어→영어→한국어**, **답변=한국어→영어→원어** 순(개행 구분,
  굵은 줄이 낭독할 문장). 난이도 하/중/상으로 구분.
- `score.mjs` — 채점기. `records.json` 을 읽어 CER·OpenAI 적합성·오류귀속·집계 리포트 산출.
- `sample-records.json` — 채점기 형식 확인용 가짜 표본.

## 채점 실행

```bash
# 형식·CER 만(무료, OpenAI 호출 없음)
node eval/score.mjs eval/sample-records.json --dry

# 전체 채점(OpenAI 과금 — .env 의 OPENAI_API_KEY 사용)
node eval/score.mjs eval/records.json --out eval/result.json

# 심사 모델 지정(기본 gpt-5-mini)
OPENAI_JUDGE_MODEL=gpt-5 node eval/score.mjs eval/records.json
```

리포트: 방향·언어별 CER/적합성/정상률, 오류 귀속 분포(STT vs MT), 번역 오류 유형 히스토그램,
함정유형별 취약도, 최악 사례 Top 8.

## records.json 형식

```json
{ "records": [
  { "scenario_id":"gate-find", "direction":"q", "lang":"en",
    "stt":"How do I get to gate twenty seven",  // soniox 가 인식한 원문
    "mt":"27번 게이트에 어떻게 가나요?",           // 시스템 번역
    "latency_ms": 1200, "speaker": "spk1" }
] }
```

- `direction`: `q`(질문, 외국어→한) / `a`(답변, 한→외국어)
- CER 정답은 **발화된 형태**로 적어라. 예: 화자가 "gate twenty-seven"이라 말하면
  `question.src.en` 도 "Gate twenty-seven"으로 두어야 숫자 표기 차이가 인식 오류로 잘못 집계되지 않는다.

## 수집(태깅) 방법 — 실측 절차

실제 사람이 데스크에서 발화하되, 각 발화를 `scenario_id`·`direction`·`lang` 로 태깅해 위 형식으로 모아야 한다.
권장 절차(파일럿):

1. **스크립트 준비** — `dataset.json` 의 `question.src`/`answer.ko_src` 를 화자별 낭독 카드로 출력.
   - 질문은 외국인(가능하면 비원어민 억양 포함) 2~3명, 답변은 한국인 안내원 2~3명.
   - **실제 데스크 환경·마이크 거리·소음**에서 녹음할 것(조용한 방 성능 ≠ 현장 성능).
2. **평가 세션 진행** — 데스크 모드로 한 시나리오씩 순서대로 발화. 각 발화 후 결과를 기록.
3. **결과 추출** — 관리자 → 로그에서 해당 데스크 응대의 `items`(각 항목 `source`+`texts`)를 꺼내
   `scenario_id`/`direction` 을 붙여 `records.json` 으로 정리.

> 3번의 수기 태깅을 없애려면 **평가 세션 모드**(다음 시나리오 원문을 화면에 띄우고 발화 결과를
> 자동으로 scenario_id 와 함께 적재)를 앱에 추가하는 것이 좋다 — 아직 미구현(추가 시 이 절차 자동화).

## 개선 루프

1. 파일럿(예: 영↔한 + 1개 언어) → 채점 → 오류 귀속·유형 집계.
2. 가장 큰 오류 덩어리부터 개선(용어집 / language_hints / 프롬프트).
3. **같은 records 조건으로 재측정**(A/B) → 개선폭 확인.
4. 안정되면 나머지 언어로 확장.
