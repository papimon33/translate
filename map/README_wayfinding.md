# 김포공항 국제선 2.5D 길찾기 (`wayfinding.html`)

`prompt_2.5d_wayfinding.md` 요건을 구현한 단일 파일 인터랙티브 앱. 참고 구현 `wayfinding_min.html`의
검증된 로직(벽 래스터화 + 직교 A*)을 재사용하고 그 위에 2.5D·멀티플로어·아이콘·환승을 얹었다.

## 실행
- **그냥 더블클릭** → `wayfinding.html` 열기. 데이터는 `wayfinding_data.js`를 `<script src>`로 로드하므로
  `file://` 에서도 동작한다(별도 서버 불필요). 두 파일은 **같은 폴더**에 있어야 한다.
- 로컬 서버로 보고 싶으면: `python3 map/_serve.py` → http://127.0.0.1:8765/wayfinding.html

## 구성 파일
- `wayfinding.html` — 앱 (렌더 + 길찾기 엔진 + UI). 주석은 한글.
- `wayfinding_data.js` — `airport_wayfinding_data.json`을 `window.AIRPORT_DATA`로 인라인한 것.
  (원본 JSON 갱신 시 `python3 -c "import json;open('map/wayfinding_data.js','w',encoding='utf-8').write('window.AIRPORT_DATA='+json.dumps(json.load(open('원본.json',encoding='utf-8')),ensure_ascii=False,separators=(',',':'))+';\n')"`)
- `_serve.py` — 로컬 정적 서버(선택).

## 동작 방식
1. **벽 그리드**: 각 층 도면 SVG를 캔버스에 래스터화(≈3px/셀) → `alpha<40`(건물 밖) 또는 `luminance<60`(검정 벽)
   또는 `security_polygons` 내부 = 장애물. 검정(#000) 벽은 4개 층 공통.
2. **연결요소 스냅**: 통행 가능 셀을 flood-fill로 라벨링해 **가장 큰 영역(주 통로)** 을 구한다.
   시설·수직노드 좌표가 벽/구조물 위에 찍혀 있어도 주 통로의 가장 가까운 셀로 스냅 →
   에스컬레이터/엘리베이터 박스가 벽으로 잡혀 고립되던 문제 해결.
3. **직교 A***(4방향, 힙 기반)로 벽·보안구역을 피해 경로 탐색 → 직교 단순화 → 점선 애니메이션.
4. **멀티플로어**: `floor_links.transit_groups`로 층 그래프를 만들고 BFS로 최소 환승 층 시퀀스 계산.
   각 구간은 그 층 그리드에서 A*, 가장 가까운 환승 노드를 자동 선택. (예: 1F→4F = 1F→3F 엘베→4F ESC-E)
5. **2.5D 렌더**: 등각 어파인 행렬로 바닥 평면을 틸트, 경로는 평면 위에 그림. 시설 아이콘/안내데스크는
   화면공간 빌보드(항상 정면), 에스컬레이터·엘리베이터는 입체 박스. 보안구역은 옅은 회색(약하게만 구분).

## UI
- 출발 안내데스크 층(1F/2F) + 출발 방향(동/서/남/북) 선택 → `findRoute(deskFloor, deskSide, dest)`.
- 카테고리 칩 + 이름/태그 검색 → 시설 클릭 시 경로 표시.
- 경로 정보: 목적지·추정거리/시간·환승횟수, 단계별 환승 안내, 층 탭/이전·다음 층 이동.

## 검증 완료(브라우저)
1F 단일층, 1F→3F(엘베), 1F→4F(엘베+ESC-E), 2F→4F 경로 정상 / 벽·보안구역 회피 / 콘솔 에러 없음.

## ⚠️ 보정 필요
- `METERS_PER_UNIT = 0.075` 는 **추정값**. 도면 실측 축척으로 보정해야 거리/시간이 정확해진다.
  (현재 표시에 "실측 보정 필요" 주석 노출 중.)
- 미제공 아이콘(`has_icon:false` / ★)은 기본 핀으로 표시 — 아이콘 SVG 받으면 `pseq_icon_groups`에 추가.
