# 라이다 앱 · 철근 분석 기능 — 인계 문서

**대상**: 라이다 스캔 앱(별도 저장소)에서 철근 분석 기능을 만드는 세션
**작성**: 2026-08-11 · AR 앱/대시보드 저장소(`D:\Projects\LH\AR`)에서 씀

이 문서는 **그쪽 세션이 이 저장소의 맥락 없이도 작업할 수 있도록** 필요한 사실과
계약을 전부 담았다. 읽는 순서는 §1 → §3 → §4 다. 나머지는 근거와 함정이다.

---

## 1. 무엇을 만드는가 · 왜

시공 현장을 라이다로 스캔하면, **설계 철근과 실제 시공 철근을 비교해 오차를
판정**해야 한다. 지금까지는 사무소 대시보드가 브라우저에서 그 분석을 했지만,
**분석 주체가 라이다 앱의 분석 툴로 이동한다.**

```
        [지금까지]                         [앞으로]

  라이다 앱 ── 스캔 ──┐              라이다 앱 ── 스캔
                     ↓                    │
              대시보드에서 분석             └── 분석 툴에서 분석  ← 여기를 만든다
                     │                              │
              화면에 표시                      DB에 결과 저장
                                                    │
                                        ┌───────────┴───────────┐
                                   AR 앱(현장)            대시보드(사무소)
                                   오차 철근 하이라이트        시각화 전용
```

**두 소비자가 같은 데이터를 읽는다.** 그래서 이 기능의 산출물은 "화면"이 아니라
**DB에 쓰는 한 벌의 레코드**다. 화면은 그걸 읽는 쪽이 각자 만든다.

### 소비자가 데이터로 하는 일

| 소비자 | 하는 일 | 그래서 필요한 것 |
|---|---|---|
| **AR 앱 (연구과제)** | 현장에서 설계 모델을 실물 위에 겹치고, **허용오차를 초과한 철근만 색으로 강조** | "어느 철근인지"를 **3D 모델 안에서 지목**할 수 있는 식별자 |
| **대시보드 (사무소)** | 3D 뷰어에서 판정별 색 표시, 철근 목록, 편차 통계 | 같음 + 편차 수치 |

---

## 2. 가장 중요한 것 — 식별자

> **이 문서에서 하나만 가져간다면 이것이다.**
> 분석 결과의 각 행은 **USDZ 설계 모델 안의 prim 절대 경로**를 갖고 있어야 한다.

### 왜 Revit element id로는 안 되는가

현재 BriconLab DB의 `difference` 테이블은 이렇게 생겼다:

```
design_element_id  as_built_element_id  distance  comment
378970             381811                 7.04    허용범위 내
378980             381812                18.40    허용범위 내
...                                      66.41    허용범위 초과
```

`design_element_id`(`378970`)는 **Revit 요소 id**다. 그런데 AR 앱이 화면에 띄우는
것은 **USDZ 파일**이고, 그 안의 철근은 `def Mesh "Wall_Front_Vert_01"` 같은
**prim**이다. 둘을 잇는 표가 DB 어디에도 없다.

즉 지금 데이터로 AR 앱이 할 수 있는 것은 **"3개 초과"라고 개수를 세는 것뿐**이고,
**어느 철근인지 짚을 수 없다.** 좌표도 없어서 위치로 찾을 수도 없다
(`difference`·`rebar_data` 어디에도 좌표 컬럼이 없다).

### 그래서 분석 툴이 해야 할 일

**분석 툴은 설계 USDZ를 직접 읽어야 한다.** 점군만 보고 끝내면 안 된다.

```
입력:  ① 라이다 스캔 (점군 / 검출된 철근 중심선)
      ② 설계 USDZ  ← 이걸 반드시 함께 읽는다
출력:  철근별 { prim 경로, 판정, 편차 }
```

USDZ에서 prim 경로를 얻는 방법은 §5에 있다.

---

## 3. DB 스키마 (제안)

기존 테이블에는 **자리가 없다.** 최장 문자열이 `varchar(64)`이고, 조인키가 될 만한
`rebar_data.element_id`는 `varchar(16)`인데 prim 경로는 `/RebarModel/Wall_Front_Vert_01`
만 해도 30자다. 그래서 **새 테이블 두 개**를 제안한다.

```sql
-- 분석 실행 1건 (스캔 1건 × 설계모델 1개)
CREATE TABLE rebar_analysis (
  analysis_id     VARCHAR(32)  NOT NULL,          -- uuid hex
  scan_id         VARCHAR(32)  NOT NULL,          -- ply_metadata.scan_id
  site_id         INT          NOT NULL,          -- construction_site.site_id
  ar_id           VARCHAR(32)  NOT NULL,          -- ar_result.ar_id (대상 설계 USDZ)
  model_upload_at VARCHAR(32)  NULL,              -- 그 USDZ의 ar_result.upload_at  ★§6
  prim_count      INT          NULL,              -- 그 USDZ의 철근 prim 총수       ★§6
  tolerance_mm    FLOAT        NOT NULL,          -- 이 판정에 쓴 허용오차          ★§7
  analyzed_at     VARCHAR(32)  NOT NULL,          -- 'YYYY-MM-DD HH:MM:SS'
  tool_version    VARCHAR(32)  NOT NULL,          -- 분석 툴 버전 (재현용)
  PRIMARY KEY (analysis_id),
  KEY idx_scan (scan_id),
  KEY idx_site_ar (site_id, ar_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 철근 1가닥의 판정
CREATE TABLE rebar_analysis_item (
  analysis_id  VARCHAR(32)  NOT NULL,
  item_no      INT          NOT NULL,             -- 실행 내 일련번호 (1부터)
  prim         VARCHAR(255) NULL,                 -- ★ 정규화된 USDZ prim 절대 경로
                                                  --   NULL = 도면 외(설계에 없는 철근)
  verdict      VARCHAR(16)  NOT NULL,             -- pass|out_of_tolerance|missing|extra
  deviation_mm FLOAT        NULL,                 -- NULL = 미시공/도면 외 (잴 대상이 없음)
  PRIMARY KEY (analysis_id, item_no),
  KEY idx_prim (analysis_id, prim)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**설계 근거**

- `prim VARCHAR(255)` — 기존 `varchar(16)`로는 경로가 안 들어간다. 넉넉히 잡는다.
- `prim NULL 허용` — `extra`(도면 외)는 설계 prim이 없다. 그래도 **행은 남긴다**.
  개수를 감추면 화면이 한쪽으로 편향된 거짓을 말하게 된다(AR 앱·대시보드 양쪽에서
  이미 겪은 문제다).
- `verdict` 4종은 **영문 코드**로 쓴다. DB의 기존 `comment`는 `허용범위 내` 같은
  한글 문장이라 코드에서 비교하기 취약하다. 화면 문구는 읽는 쪽이 붙인다.
- `ENGINE=InnoDB` — 반드시. 기존 7테이블도 전부 InnoDB이고, 트랜잭션이 없으면
  롤백이 불가능하다.

> **DDL을 실행하기 전에 반드시 스냅샷을 뜬다.** 이건 **상대사(BriconLab) 운영
> DB**다. AR 저장소에 도구가 있다:
> ```bash
> python scripts/db_snapshot.py dump            # 쓰기 전 항상
> python scripts/db_snapshot.py diff <파일>      # 무엇이 달라졌나
> ```
> 신규 테이블 생성은 기존 데이터를 건드리지 않지만, **BriconLab에 사전 통보는
> 필요하다** — 그들 스키마에 우리 테이블을 얹는 일이다.

---

## 4. 판정 규칙

| verdict | 뜻 | `prim` | `deviation_mm` |
|---|---|---|---|
| `pass` | 설계 대비 허용오차 이내 | 설계 prim | 실측 편차 |
| `out_of_tolerance` | 허용오차 초과 — **AR 앱이 강조하는 대상** | 설계 prim | 실측 편차 |
| `missing` | 설계에는 있는데 스캔에서 못 찾음 (미시공) | 설계 prim | `NULL` |
| `extra` | 스캔에는 있는데 설계에 없음 (도면 외) | `NULL` | `NULL` |

**허용오차는 분석 시점에 확정해 `tolerance_mm`에 기록한다.** 판정을 DB에 굽는
방식이므로, 허용오차를 바꾸려면 재분석해야 한다. 그 대신 읽는 쪽이 단순해지고
현장·사무소가 같은 답을 본다. 화면에는 항상 **"허용오차 ±N mm 기준"**을 함께
띄운다 — 어떤 기준의 판정인지 모르는 색은 위험하다.

---

## 5. USDZ에서 prim 경로 얻기

### 5.1 실제 파일 구조 (실측)

BriconLab이 주는 USDZ를 받아 열어본 결과다. `GET /analysis/usdz?ar_id=` 로 받는다.

```
model.usda  (텍스트 USD, zip 안에 1개)

#usda 1.0
( defaultPrim = "RebarModel"  metersPerUnit = 1  upAxis = "Y" )

def Xform "RebarModel" {
    def Mesh "BotV_01" { ... }     ← 철근 1가닥 = prim 1개
    def Mesh "BotV_02" { ... }
    ...                              BotV×20  BotH×10  TopV×20  TopH×10 = 60개
}
```

- **철근 1가닥 = prim 1개다.** 통짜 메시가 아니다.
- 계층은 없다(60개가 형제). 단 **모델마다 깊이가 다르다** — 다른 샘플은
  `루트 > Meshes(Scope) > rebar_0_PASS` 로 3단이다. §5.2가 이걸 흡수한다.
- 현재 세 현장이 **바이트 단위로 동일한 파일**이고 헤더에
  `doc = "As-built rebar model detected from LiDAR scan"` 이 있다 — 즉 지금 있는
  건 **설계 모델이 아니라 as-built 플레이스홀더**다. 옹벽 설계 모델은 아직 없다.

### 5.2 경로 정규화 — 반드시 맞춰야 한다

같은 철근이 세 곳에서 서로 다른 문자열로 나타난다. 정규화 없이 비교하면
**조인율이 0%가 되고, 증상은 "화면이 비었다" 하나뿐이라 원인을 못 찾는다.**

정규화 규칙 (AR 저장소의 `taxonomy.ts` / `RebarTaxonomy.swift`와 **동일해야 함**):

1. 빈 세그먼트 제거 (선행·중복 슬래시 정리)
2. **wrapper 세그먼트 제거**: `modelEntity`, `placementRoot`, `Meshes`
3. 대소문자·공백은 **바꾸지 않는다** (USD는 대소문자를 구분한다)
4. 선행 슬래시를 붙인 절대 경로로

```
/RebarModel/Wall_Front_Vert_01                              ┐
RebarModel//Wall_Front_Vert_01                              │ 전부 같은 키
/RebarModel/Meshes/Wall_Front_Vert_01                       │
/placementRoot/modelEntity/RebarModel/Wall_Front_Vert_01    ┘
      ↓
/RebarModel/Wall_Front_Vert_01
```

파이썬 구현 예:

```python
WRAPPER = {"modelEntity", "placementRoot", "Meshes"}

def normalize_prim_path(s: str) -> str:
    segs = [x for x in s.split("/") if x and x not in WRAPPER]
    return "/" + "/".join(segs)
```

### 5.3 한 prim이 여러 가닥일 때

Revit류 내보내기는 철근 "세트"(한 요소에 여러 가닥)를 쓰기도 한다. 그 경우
prim 하나에 서로 떨어진 메시 덩어리가 여럿 들어간다. 대시보드는 연결요소로
쪼개고 `경로#0`, `경로#1` 처럼 접미사를 붙인다.

**분석 툴도 쪼갠다면 같은 규칙을 써라.** 그리고 순서가 중요하다:

1. **필터를 먼저** 적용한다 (반경 ≥ 5cm 제외, 길이 ≤ 10cm 제외)
2. 남은 덩어리를 **중심점 사전순(x→y→z)으로 정렬**
3. 그 순서로 `#k` 부여

> 이 순서를 지키지 않으면 **짧은 파편 하나가 생기거나 사라질 때 무고한 철근의
> id가 통째로 밀린다.** 정점 버퍼 순서에 의존하면 모델을 다시 내보내는 것만으로
> 신원이 바뀐다. 둘 다 실제로 겪은 버그다.

가장 좋은 것은 **애초에 1 prim = 1 가닥**이라 쪼갤 일이 없는 것이다. BriconLab에
그렇게 요청해 뒀다(`api/REBAR_TAXONOMY_REQUEST.md`).

---

## 6. 모델이 바뀌었는데 분석이 옛것일 때

가장 흔한 사고다. **모델을 다시 내보내면서 배근만 바뀌고 prim 이름은 그대로**인
경우, 이름이 전부 맞으니 조인은 **100% 성공하고 판정만 엉뚱한 철근에 붙는다.**
오류도 경고도 나지 않는다.

그래서 `rebar_analysis`에 `model_upload_at`과 `prim_count`를 남긴다.

- `model_upload_at` — 분석에 쓴 USDZ의 `ar_result.upload_at` **그대로**.
  형식은 `2026-07-29 20:33:49` (공백 구분, `varchar(32)`). ISO의 `T`가 아니다.
- `prim_count` — 그 USDZ에서 읽은 철근 prim 총수.

읽는 쪽은 지금 모델과 대조해서 어긋나면 **결과를 버리고 경고를 띄운다.**

---

## 7. 미확정 — 정해야 할 것

| # | 무엇 | 지금 상태 |
|---|---|---|
| 1 | **허용오차 기본값** | 대시보드는 사용자 조절식(기본 10mm)이었다. BriconLab 처리기는 하드코딩으로 보이고 관측 경계가 57.1~66.4mm다. **둘이 다르면 같은 스캔에 두 개의 답이 생긴다.** 분석 툴이 기준을 정하고 `tolerance_mm`에 기록하는 것으로 정리하자 |
| 2 | **옹벽 설계 모델** | 아직 없다. 지금 DB의 USDZ 3개는 전부 as-built 플레이스홀더이고 세 현장이 같은 파일이다. 설계 모델이 와야 prim 경로 계약을 실제로 검증할 수 있다 |
| 3 | **설계 모델이 가닥별 prim인지** | as-built 생성기는 확인됐다(60개 분리). 설계 변환 경로(Revit/FBX → Blender → USDZ)는 **미확인**이다. 통짜 메시로 오면 §5.3의 쪼개기가 필수가 된다 |
| 4 | **기존 `difference` 테이블과의 관계** | 그대로 둘지, 신규 테이블로 대체할지. BriconLab 파이프라인이 계속 채우고 있으므로 **건드리지 말고 병행**을 권한다 |

---

## 8. 참고 — 이 저장소에 이미 있는 것

분석 툴을 만들 때 **다시 만들지 말고 가져다 쓸 것**들이다.
경로는 전부 `D:\Projects\LH\AR` 기준.

| 무엇 | 위치 | 비고 |
|---|---|---|
| DB 조회 (읽기 전용 기본) | `scripts/db.py` | 쓰기 문은 `--write` 명시 필요 |
| DB 스냅샷·복원 | `scripts/db_snapshot.py` | **쓰기 전 필수**. 실데이터로 검증됨 |
| DB 자격증명 | `secrets/briconlab-db.env` | gitignore. MariaDB 10.11, 시놀로지 NAS |
| 경로 정규화 (TS) | `office-dashboard/src/lib/analysis/taxonomy.ts` | `normalizePrimPath` |
| 경로 정규화 (Swift) | `LHRebarAR/Model/RebarTaxonomy.swift` | 위와 동일 규칙 |
| 옹벽 철근 분류표 | `docs/wall-rebar-classification.png` · `taxonomy.ts`의 `WALL_TAXONOMY` | 발주처 제공 12행 |
| 기존 분석 엔진 (참고용) | `office-dashboard/src/lib/analysis/` | 정합(PCA+ICP)·매칭·판정·간격. **알고리즘을 참고할 가치가 있다** |
| USDZ → 철근 중심선 | `office-dashboard/src/lib/analysis/designExtract.ts` | PCA 직선 근사 + 연결요소 분리 |
| BriconLab 요청 문서 | `api/REBAR_TAXONOMY_REQUEST.md` | prim 명명 규약을 이미 요청해 둠 |

### 옹벽 철근 분류표 (발주처 제공)

분석 결과를 부위별로 묶어 보여줄 때 쓴다. prim 이름 토큰도 이 표를 따르도록
BriconLab에 요청해 뒀다.

| 부재 | 면 | 기능 | prim 토큰 |
|---|---|---|---|
| 벽체 | 전면 | 수직철근 | `Wall_Front_Vert` |
| 벽체 | 전면 | 수평철근(배력철근) | `Wall_Front_Horiz` |
| 벽체 | 배면 | 수직철근(주철근) | `Wall_Rear_Vert` |
| 벽체 | 배면 | 수평철근(배력철근) | `Wall_Rear_Horiz` |
| 벽체 | 전면-배면 | 간격재(전단철근) | `Wall_FrontRear_Shear` ○ |
| 벽체 | 상단 | 보강철근 | `Wall_Top_Reinf` ○ |
| 저판 | 상부 | 횡방향철근(주철근) | `Base_Upper_Trans` |
| 저판 | 상부 | 종방향철근(배력철근) | `Base_Upper_Long` |
| 저판 | 하부 | 횡방향철근 | `Base_Lower_Trans` |
| 저판 | 하부 | 종방향철근(배력철근) | `Base_Lower_Long` |
| 저판 | 상부-하부 | 간격재(전단철근) | `Base_UpperLower_Shear` ○ |
| 벽체-저판 | — | 보강철근(헌치철근) | `WallBase_Haunch` ○ |

○ = "분석 가능할 경우 추가" — 없어도 정상.

주의: **괄호 안 역할명이 면마다 다르다.** 벽체 전면은 `수직철근`인데 배면은
`수직철근(주철근)`이다. 그리고 **헌치는 독립 부재가 아니라** 벽체-저판 경계의
보강철근이라 이 항목만 면이 없고 2단계다.

---

## 9. 함정 모음 (전부 실제로 겪은 것)

1. **USD prim 이름에 하이픈은 불가능하다.** prim 이름은 식별자라
   `[A-Za-z_][A-Za-z0-9_]*` 만 된다. Blender USD 익스포터가 파일을 쓰는 시점에
   `-`를 `_`로 바꿔버린다. 한글도 `allow_unicode=False`(Blender 4.2/4.5 기본값)면
   코드포인트마다 `_`가 되어 **모든 철근 이름이 뭉개져 서로 충돌한다.**
   → 사람이 읽는 이름은 prim이 아니라 **별도 필드**에 담는다.

2. **타임스탬프 형식이 다르다.** DB의 `upload_at`은 `2026-07-29 20:33:49`(공백)인데
   ISO 관례는 `T`다. 문자열 완전일치로 비교하면 같은 빌드를 다른 것으로 판정한다.
   → 비교 전 정규화한다.

3. **API가 0행을 500으로 돌려준다.** `GET /analysis/ar-list?site_id=4` 는 모델이
   없을 뿐인데 `{"detail":"DB 오류 발생."}` HTTP 500을 준다. 존재하지 않는
   site 99와 응답이 완전히 같다. `scan-list`도 같은 패턴이다.
   → 상류 500을 "데이터 없음"으로 오해하지 말 것. BriconLab에 수정 요청해 뒀다.

4. **API에 인증이 없다.** 11개 엔드포인트 전부 `security` 가 비어 있고 쓰기
   엔드포인트(`POST /analysis/upload`, `/ar-upload`, `/save-data/{scan_id}`)도
   포함된다. 우리가 쓸 수 있다는 뜻이자, 누구나 쓸 수 있다는 뜻이다.

5. **API와 DB는 다른 머신이다.** API는 AWS(`3.36.175.10`), DB는 시놀로지
   NAS(`211.228.233.123:58807`). **DB 권한으로 API 코드를 고칠 수 없다.**
   단 DB는 데이터센터 IP에서도 접속된다(실측) — 우리가 만드는 서비스가 붙을 수 있다.

6. **`difference.scan_id`가 96행 중 93행이 빈 문자열이다.** 스캔이 2건 이상
   쌓이면 결과가 섞인다. 신규 테이블에서는 `scan_id`를 반드시 채운다.

7. **`rebar_data`와 `difference`를 잇는 선언된 키가 없다.**
   `d.as_built_element_id = r.element_id + 1125` 로 조인하면 정확히 94행이 붙지만,
   **규칙인지 우연인지 확인되지 않았다. 코드에서 이 오프셋에 기대지 말 것.**

---

## 10. 이 문서를 받은 세션이 처음 할 일

1. `secrets/briconlab-db.env` 로 DB에 붙어 `scripts/db.py tables LH` 로 현재 상태 확인
2. `scripts/db_snapshot.py dump` 로 스냅샷 (쓰기 전 필수)
3. §3의 두 테이블을 만들지, 다른 형태로 갈지 결정 — **BriconLab 통보 후**
4. 설계 USDZ를 읽어 prim 경로를 뽑는 부분부터 만든다 (§5). 여기가 이 기능의
   성패를 가른다
5. 판정 로직은 `office-dashboard/src/lib/analysis/` 를 참고 — 정합(PCA+ICP),
   매칭, 판정이 이미 구현돼 있고 테스트도 있다

궁금한 게 생기면 AR 저장소의 `CLAUDE.md`(특히 §5 고차 목록, §8.5 DB 접근)를
먼저 보면 대부분 답이 있다.
