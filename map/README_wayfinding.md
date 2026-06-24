# 김포공항 국제선 2.5D 길찾기

두 가지 구현이 있다.

| 파일 | 설명 |
|---|---|
| **`airport25d.js` + `test.html`** | **(권장/최신)** 4개 층을 하나의 화면에 통합한 입체 멀티플로어 뷰. 벽 3D 압출·바닥 슬래브 두께·무채색·다른 웹앱에서 함수 호출용 라이브러리 + 테스트 페이지. |
| `wayfinding.html` (v1) | 한 층씩 보여주는 등각 틸트 단일 파일 앱(이전 버전). |

---

## A. `airport25d.js` — 재사용 라이브러리 (최신)

### 호출 방법 (다른 웹앱에서)
```html
<script src="wayfinding_data.js"></script>   <!-- window.AIRPORT_DATA -->
<script src="airport25d.js"></script>
<script>
  const map = AirportMap25D.create({
    container: '#map',          // 엘리먼트 또는 셀렉터
    data: window.AIRPORT_DATA,  // 생략 시 전역 사용
    wallHeight: 16,             // 내부 벽 압출 높이(상수)
    plateThickness: 10,         // 바닥 슬래브 두께
    wallEdgeErode: 6,           // 외곽 벽 제거 두께(마스크 px). 크게 = 더 깎임
    // 층별 수동 정렬: 보정좌표 = 원래좌표 * s + (dx,dy)  (원본 SVG 단위)
    floorCalib: { '1F':{s:1,dx:0,dy:0}, '2F':{s:1,dx:0,dy:0}, '3F':{s:1,dx:0,dy:0}, '4F':{s:1,dx:0,dy:0} },
    onReady(api){ /* 준비 완료 */ },
  });

  // 핵심: 출발 안내데스크 → 목적지 경로 표시
  map.showRoute({ deskFloor:'1F', deskSide:'S', dest:{ floor:'4F', name:'유아휴게실' } });
  // dest 는 {floor,name} 또는 {floor,x,y} 모두 가능
  map.clearRoute();

  map.setCalib('4F', { s:1.05, dx:20, dy:0 });    // 실행 중 한 층 정렬 미세조정
  map.on('route', r => console.log(r.summary));   // {dest,floor,meters,minutes,transfers,steps[]}
</script>
```
반환 객체(api): `showRoute · clearRoute · setDesk(floor,side) · setCalib(floor,{s,dx,dy}) · listFacilities() · getRoute() · on(ev,cb) · redraw() · destroy() · el`.

### 렌더 개념
- 4개 층을 한 화면에 적층. **z순서: 4F가 맨 위, 1F가 맨 아래**(겹치면 위층이 보임). 고정 논리 viewBox + CSS 균일 스케일 → 축소해도 위치 불변.
- 각 층 도면 SVG 래스터화로 **재구성**: 바닥 footprint를 아래로 압출(슬래브 두께). **벽은 보호구역↔일반 경계의 일반쪽에만** 얇게(보안구역은 폴리곤으로 solid 판정 → 내부 벽 없음) 세우고 **반투명**(`wallOpacity`)으로 합성.
- 무채색(흰/연회색). **보안구역은 하늘색 채움으로 구분**(점선 경계 없음).
- 평소 시설 아이콘은 **전부 숨김**. 경로 시: 출발=**노란 정육면체 큐브 + "Here"**, 목적지=**현위치 핀**(언어별 명칭),
  경유 에스컬레이터/엘리베이터만 **아이콘**(래퍼 없음, 3D 구조물 없음).
- 경로 = **밝은 파랑 동그란 점**이 출발→목적지로 **하나씩 늘어나는 애니메이션**, 꺾임 최소화(`reduceBends`), **층간은 수직 상승**.
  에스컬레이터/엘리베이터 아이콘은 **양쪽 층의 실제 위치**에 표시(1F→2F면 둘 다).
- 출발 표식 = **노란 정육면체 큐브**(`CUBE_SZ`) + **현위치 핀**(겹침) + "Here". 큐브는 **장애물**이라 경로가 통과 못하고 돌아 나감.
  길찾기 차단 = 건물 밖 + 보안구역 + 출발 큐브. 안내데스크 동서남북 이격은 작게(`SIDE_OFF`).
- **언어**: `create({lang:'ko'})` / `map.setLang('en'|'ja'|'zh')`. 데이터에 `name_<lang>` 있으면 목적지 명칭에 사용(없으면 한글). *번역 데이터는 추후 업데이트.*
- **층별 정렬(권장: 2D 정합 도구)**: 축척/위치가 층마다 달라 보정 필요. **`align.html`** 에서 4개 도면을
  **탑다운으로 겹쳐** 띄우고 드래그(이동)·슬라이더(가로/세로 따로 `scaleX/scaleY`)로 맞춘다. `에스컬레이터 기준
  자동정렬` 로 공유 노드(transit_groups) 기준 1차 정렬 후 미세조정. `3D에 적용(저장)` 누르면 `localStorage`에
  저장되고, **`test.html`을 열면 그 정합값이 자동 반영**된다. `create({floorCalib})` 로 직접 넘겨도 됨.
  보정 모델: `보정좌표 = (평면좌표 − 중심)·(sx,sy) + 중심 + (dx,dy)` (평면 단위).
- 길찾기 엔진(벽/보안 회피 직교 A* + transit_groups 멀티플로어 그래프)은 v1과 동일(검증됨).

### 파일 / 빌드
| 소스(편집) | 산출물(자체 완결) | 용도 |
|---|---|---|
| `test.src.html`  | `test.html`  | 3D 길찾기 뷰 (데이터+라이브러리 인라인) |
| `align.src.html` | `align.html` | 2D 탑다운 정합 도구 — 층별 크기/위치 (`kac_floorCalib`) |
| `gap.src.html`   | `gap.html`   | 3D 층 높이 간격 조정 — 드래그/슬라이더 (`kac_floorGaps`) |

- `*.html` 은 **다른 파일/서버 없이 더블클릭(`file://`)만으로 즉시 실행**(외부요청 0).
- 편집은 `*.src.html`(또는 `airport25d.js`/`wayfinding_data.js`)를 고친 뒤:
  ```
  python3 map/_build_test.py     # *.src.html 의 <script src> 를 인라인해 *.html 생성
  ```
- 워크플로: **`align.html`(겹쳐서 정합) → `gap.html`(높이 간격) → `test.html`(3D 확인)**.
  세 페이지는 localStorage(`kac_floorCalib`, `kac_floorGaps`)로 연결돼, 맞춘 값이 자동 반영된다.
- **층 높이 간격**: `create({floorGaps:[g_1F2F, g_2F3F, g_3F4F]})` 또는 `map.setFloorGaps([..])`/`setUniformGap(v)`/`resetGaps()`.
  작게 주면 층이 겹쳐 실제 층고처럼 보인다. `null`=자동(겹치지 않는 최대).

검증: 1F→3F(엘베), 1F→4F(엘베+ESC-E), 2F→3F, 동일층 경로 / 경로 중 시설 숨김 / 외부요청 0 / 콘솔 에러 없음.

---

## B. `wayfinding.html` (v1)

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
