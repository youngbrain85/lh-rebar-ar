# 철근 계층 분류 + 트리 필터 — 설계

**작성일** 2026-08-05 · **브랜치** `feat/rebar-hierarchy`

---

## 1. 무엇을 만드는가

발주처 요청: 철근을 **계층 구조로 분류**하고, **트리로 선택해 시각화**한다.
사용자 원문:

> 옹벽의 경우에 먼저 '전벽철근, 저판철근, 헌치철근' 으로 나뉘고 위치에 따라 전면철근 & 배면철근,
> 수직철근 & 수평철근으로 나뉘어. 따라서 개별 철근 명칭을 '전벽-전면-수직철근-#' 이런식으로 나뉘고
> 시각화 할때는 트리구조로 선택해서 시각화 하면 좋겠어.

> 이 시각화는 대시보드 뿐만아니라 LH전용 앱에서도 구현되어야해.

산출물 셋:

| # | 산출물 | 위치 | 담당 |
|---|---|---|---|
| ① | BriconLab 계층 정보 요청 문서 | `api/REBAR_TAXONOMY_REQUEST.md` | 우리가 쓰고 → BriconLab이 이행 |
| ② | 대시보드 「시공 분석」의 철근 트리 필터 | `office-dashboard/` | 우리 |
| ③ | LH 전용 iOS 앱의 철근 트리 필터 | `LHRebarAR/` (`AppFeatures.rebarFilter`) | 우리 |

---

## 2. 확정된 결정

대화에서 사용자가 직접 정한 것 — 재논의 대상 아님.

1. **분류의 출처는 BriconLab이다.** 우리가 기하학적으로 추론하지 않는다.
2. **어휘는 부위별 전용이다.** 균일 4단계가 아니다.
   구체 어휘는 **발주처 분류표(§4.1)** 가 확정한다. 2026-08-08 에 표를 받아
   §1 의 구술(전벽철근/저판철근/헌치철근)을 대체했다 — 부재는 `벽체 / 저판 /
   벽체-저판` 이고, 헌치는 독립 부재가 아니라 벽체-저판 경계의 보강철근이다.
3. **개별 철근 표시 명칭은 `전벽-전면-수직철근-#` 형식이다.**
4. **시각화는 트리 구조로 선택한다.**
5. **범위는 대시보드와 LH 앱 둘 다이다.**
6. **한글 이름은 사이드카 JSON으로 나른다.** USDZ prim 이름이 아니라. (근거 §3.2·§3.3)

**§8의 3단 폴백은 이 결정들의 확장이며 별도 승인이 필요하다.** 특히 3단계(기하 자동 분류)는 결정 1이 배제한 방식이다 — 설계모델이 없는 경로에서 화면이 통째로 비는 것을 막기 위한 **우리 제안**이다.

---

## 3. 조사로 확정된 사실

설계의 전제이므로 근거를 남긴다. 전부 이번 사이클에 직접 측정하거나 소스를 읽어 확인했다.

### 3.1 실제 BriconLab 모델의 구조 — 측정

세 현장의 USDZ를 백엔드에서 받아 압축을 풀었다. 셋 다 **바이트 단위로 동일한 파일**(60,629 B)이었고, 내용은 텍스트 `model.usda`였다.

```
#usda 1.0
( defaultPrim = "RebarModel"  metersPerUnit = 1  upAxis = "Y"
  doc = "As-built rebar model detected from LiDAR scan (aligned frame, yaw_deg=20.000, …)" )

def Xform "RebarModel" {
    def Mesh "BotV_01" { … }      ← 60개 전부 이 한 줄 깊이의 형제
    …  BotV×20  BotH×10  TopV×20  TopH×10
}
```

- **철근 1가닥 = prim 1개다.** 통짜 메시가 아니다 → 개별 철근을 주소 지정할 수 있다.
- **계층이 없다.** 60개가 전부 `RebarModel` 바로 아래 형제다 → 부모 Xform으로 트리를 만들 수 없다.
- 이름은 이미 USD 합법 식별자다 (`[A-Za-z_][A-Za-z0-9_]*`, 부적합 0건).
- **이건 설계도가 아니라 as-built LiDAR 산출물이다.** 세 현장이 동일 파일 = 플레이스홀더.

옹벽 **설계** 모델은 다른 경로(Revit/FBX → Blender → USDZ, `api/USDZ_REQUEST.md`)로 오므로, "가닥별 prim 분리"가 그쪽에서도 성립한다는 보장은 아직 없다. §11-1.

참고로 저장소에 번들된 설계 샘플(`LHRebarAR/Resources/Models/highlighted_design_model.usdz`)은 계층이 **3단**이다 — `highlighted_design_model > Meshes(Scope) > rebar_0_PASS`. 즉 **prim 경로의 깊이는 모델마다 다르다.** §5.2가 이걸 다룬다.

### 3.2 `전벽-전면-수직철근-01`은 prim 이름이 될 수 없다

- **하이픈 확정 불가.** USD prim 이름은 식별자이고 `-`는 ASCII 규칙에서도, UTF-8 식별자 규칙(XID_Start/XID_Continue)에서도 합법 문자가 아니다. Blender USD 익스포터의 `make_safe_identifier`가 파일을 쓰는 시점에 `_`로 치환한다 — 리더에 닿기 전에 죽는다.
- **한글은 조건부이고 실패 양상이 치명적이다.** Blender `wm.usd_export`의 `allow_unicode`가 4.2/4.5에서 **기본값 false**이고, 그러면 비ASCII 코드포인트마다 `_`로 치환한다:
  ```
  전벽_전면_수직철근_01  →  ___________01
  저판_상부_횡방향_01    →  __________01
  ```
  **모든 철근 이름이 뭉개져 서로 충돌한다.** 5.0+에서 기본값이 true다.
  우리가 보낸 `api/USDZ_REQUEST.md:37-41`의 예시 커맨드는 옵션이 하나도 없다 — 지금은 BriconLab의 Blender 버전에 운을 맡기고 있다.
- **숫자로 시작하는 이름도 불가.**

### 3.3 한글을 USD 메타데이터에 담는 우회로는 막혀 있다 — 측정

three.js USD 로더 4개 파일(`USDLoader.js`, `usd/USDAParser.js`, `usd/USDCParser.js`, `usd/USDComposer.js`) 전체에서:

| 채널 | 출현 | 결론 |
|---|---|---|
| `displayName` prim 메타데이터 | 0회 | 대시보드가 못 읽음 |
| `userProperties:*` (Blender `author_blender_name`) | 0회 | 대시보드가 못 읽음 |
| `material.name` | 설정 코드 자체가 없음 (3곳 모두 `new MeshPhysicalMaterial()`만) | 채널이 죽어 있음 |

three.js 파서 자체는 한글 prim 이름을 바이트 보존해 읽는다(측정). 단 이는 **스펙 위반 파일도 읽어주는 관대함**이라, RealityKit도 그럴 것이라는 근거가 되지 못한다.

### 3.4 RealityKit은 미확인

UTF-8 prim 이름은 OpenUSD 24.03 기능이고 Apple 언급은 WWDC24(iOS 18 사이클)인데, 이 앱의 deployment target은 **iOS 17.0**이다. `Entity.name`이 prim 이름에서 채워진다는 Apple 공식 서술도 확인하지 못했다. 이 저장소에서 기기 검증된 USDZ는 전부 ASCII 이름이다 — 한글 경로는 **한 번도 기기를 통과한 적이 없다**.

### 3.5 iOS 코드는 준비돼 있다

| 사실 | 근거 |
|---|---|
| `Entity.loadAsync(contentsOf:)` — 계층 보존 계열 API (평탄화하는 `loadModelAsync`가 아님) | `LHRebarAR/Model/ModelLoader.swift:58` |
| `normalizedToBottomCenter`는 계층을 건드리지 않음 (빈 wrapper를 씌우고 자식 position만 이동) | `ModelLoader.swift:43-52` |
| **철근 단위 충돌체가 이미 노드별로 설치돼 있다** — `ModelComponent` 보유 노드마다 자기 visualBounds 박스 | `AR/ModelAnchorController.swift:126-145` |
| 트리 DFS 순회 인프라 2개 기존재 (`installCollision`, `applyOpacity`) | `ModelAnchorController.swift:126-145`, `:156-181` |
| USDZ 자식 노드의 `name`을 읽거나 쓰는 코드는 앱 전체에 **없음** | `ModelAnchorController.swift:44-45`가 유일한 name 대입 |
| 배치되는 것은 `clone(recursive: true)` 사본 | `Placement/PlacementViewModel.swift:64-66` |
| `AppFeatures.rebarFilter`는 어디서도 읽히지 않는 선언뿐인 플래그 | `App/AppFeatures.swift:19,28` |
| 앱과 대시보드는 **물리적으로 같은 USDZ 파일**을 쓴다 | `Backend/BackendClient.swift:50-51` ↔ `office-dashboard/src/app/api/model/route.ts:8,16` |

### 3.6 투명도로 숨기면 안 되는 이유

| 문제 | 근거 |
|---|---|
| 전역 투명도 슬라이더가 개별 노드 상태를 덮어쓴다 | `PlacementViewModel.swift:14-20` → `ModelAnchorController.swift:149-151` |
| 안 보이는 철근에 **측정 레티클이 계속 스냅된다** (충돌체는 그대로 살아 있음) | `Measurement/MeasurementController.swift:242-246` |
| `PhysicallyBasedMaterial`/`SimpleMaterial` 외 머티리얼에는 **조용히 실패**한다 | `ModelAnchorController.swift:164-178` |

→ 숨김은 `isEnabled = false`로 한다.

**단, "`isEnabled = false`가 CollisionComponent까지 함께 끈다"는 §3.4와 같은 등급의 미확인 가정이다.** 이 저장소에는 충돌체를 가진 모델 노드에 `isEnabled`를 쓴 전례가 없다 (기존 4건은 전부 측정 앵커·제스처 인식기 — `MeasurementController.swift:292,304`, `GestureCoordinator.swift:36-37`). §7.0 선행 검증에서 잰다. 실패하면 대안은 **숨길 때 `CollisionComponent`를 제거하고 켤 때 복원**하는 것이다.

### 3.7 별개 버그 — 이 작업의 필수 선행

`loadDesign.ts:26`가 읽는 것은 오브젝트(부재) 이름이 아니라 **메시 데이터블록 이름**이다. Blender USD 익스포터는 오브젝트 이름에는 형제 중복 회피를 걸지만(4.5+) **메시 데이터 이름에는 걸지 않는다**. 결과:

- 같은 규격 철근이 지오메트리를 **공유**하면(FBX 인스턴싱) 이름이 대량 중복된다.
- 중복되면 `designExtract.ts:82`의 `comps.length === 1 ? name : \`${name}#${k}\`` 분기가 뒤집혀 **무고한 철근의 id까지 바뀐다.**
- 그 id는 `judge.ts` → `/api/analysis-result`에 **저장**되고 `label.ts`/`AnalysisViewer.tsx`의 조인 키로 다시 쓰이므로 **실패가 조용하다.**
- `#k`의 k는 **정점 버퍼 순서에 의존한다**(`designExtract.ts:89-109`).
- 게다가 반경·길이 필터가 **k 부여 뒤에** 걸리고 단일/다중 분기도 **필터 전** 개수로 판정하므로(`designExtract.ts:81-82`), 짧은 파편 하나가 생기거나 사라지면 무고한 철근의 id가 `경로` ↔ `경로#1`로 뒤집힌다.
- `loadDesign.ts:28-31`의 부모 폴백은 Blender 산출물에서 **절대 발동하지 않는 죽은 코드**다.

계층 트리를 넣으면 서로 다른 부위 아래 같은 리프 이름이 생기므로, **경로 기반 id로 바꾸는 것이 이 작업의 필수 선행**이다. §6.1.

---

## 4. 분류 체계

### 4.1 계층 — 발주처 분류표

**출처: 발주처가 준 옹벽 철근 분류표 (2026-08-08).** 원본 `docs/wall-rebar-classification.png`.
코드의 단일 진실은 `taxonomy.ts` 의 `WALL_TAXONOMY` 이고, Swift 포트가 같은 표를 복제한다.

| 부재 | 면 | 기능 | prim 토큰 | 선택 |
|---|---|---|---|---|
| 벽체 | 전면 | 수직철근 | `Wall_Front_Vert` | |
| 벽체 | 전면 | 수평철근(배력철근) | `Wall_Front_Horiz` | |
| 벽체 | 배면 | 수직철근(주철근) | `Wall_Rear_Vert` | |
| 벽체 | 배면 | 수평철근(배력철근) | `Wall_Rear_Horiz` | |
| 벽체 | 전면-배면 | 간격재(전단철근) | `Wall_FrontRear_Shear` | ○ |
| 벽체 | 상단 | 보강철근 | `Wall_Top_Reinf` | ○ |
| 저판 | 상부 | 횡방향철근(주철근) | `Base_Upper_Trans` | |
| 저판 | 상부 | 종방향철근(배력철근) | `Base_Upper_Long` | |
| 저판 | 하부 | 횡방향철근 | `Base_Lower_Trans` | |
| 저판 | 하부 | 종방향철근(배력철근) | `Base_Lower_Long` | |
| 저판 | 상부-하부 | 간격재(전단철근) | `Base_UpperLower_Shear` | ○ |
| 벽체-저판 | — | 보강철근(헌치철근) | `WallBase_Haunch` | ○ |

○ = 표의 "분석 가능할 경우 추가". 없어도 정상이다.

설계에 영향을 주는 성질 둘:

- **괄호 안 역할명이 면마다 다르다.** 벽체 전면은 `수직철근`인데 배면은
  `수직철근(주철근)`이고, 저판 하부 횡방향철근에는 괄호가 없다. 그래서 토큰별
  사전으로는 정식 명칭을 복원할 수 없다 — (부재·면·기능) 조합을 통째로 들고
  있어야 한다. `parsePrimName` 이 표 조회를 먼저 하고 토큰 매핑은 폴백으로만 쓴다.
- **헌치는 독립 부재가 아니다.** `벽체-저판` 경계의 보강철근이라 이 행만 면이
  없고 **계층이 2단계**다. 트리 깊이가 가지마다 다르다는 성질은 여기서 온다.

> 이전 버전의 스펙은 `전벽철근 / 저판철근 / 헌치철근` 이라는 다른 어휘를 썼다
> (사용자 구술 기준). 2026-08-08 에 발주처 분류표를 받아 위 표로 교체했다.

### 4.2 표시 명칭

**결정론적 조립 규칙**: `label = [...path, zeroPad2(no)].join("-")`

```
["벽체","배면","수직철근(주철근)"], no=1  →  벽체-배면-수직철근(주철근)-01
```

사이드카의 `label` 필드는 **이 규칙의 오버라이드**다 — 값이 있으면 그것을 쓰고, 없으면 위 규칙으로 만든다. 발주처 예시(`전벽-전면-수직철근-01`)처럼 부위명을 줄여 쓰려면 사이드카가 그 문자열을 직접 준다.

이 문자열은 USD 문자 규칙의 영향을 받지 않으므로 하이픈도 한글도 자유롭다. **대시보드 트리와 LH 앱 트리가 이 값을 그대로 띄운다** — 두 앱이 같은 이름표를 보게 만드는 유일한 채널이다.

캡처 푸터에 필터 상태를 넣는 것은 **이번 범위가 아니다** (§10).

---

## 5. 데이터 계약 — BriconLab에 요청할 것

### 5.1 사이드카 JSON (계약의 본체)

계층과 표시명은 **prim 이름에 인코딩하지 않고** 별도 JSON으로 받는다. 이유:

- USD 식별자 규칙에서 완전히 자유롭다 (한글·하이픈·공백 전부 가능).
- 트리 깊이가 부위마다 달라도 자연스럽다 — `path` 배열 길이가 곧 깊이다.
- **prim 이름은 의미를 담을 필요가 없어진다** — 유일성과 USD 식별자 규칙만 지키면 되고, 한글·부위 어휘는 사이드카가 담당한다.
- 발주처가 나중에 용어를 바꿔도 BriconLab에 다시 요청할 필요가 없다.

**엔드포인트**: `GET /analysis/rebar-meta?ar_id={ar_id}` → JSON

```jsonc
{
  "version": 1,
  "ar_id": "51120d35abdc44408520e22b4ff78d7e",
  "model_upload_at": "2026-08-05T10:22:31",   // ar-list의 upload_at 그대로 — 빌드 대조용
  "prim_count": 248,                          // USDZ 안 철근 prim 총수 — 빌드 대조용
  "structure": "옹벽",                         // 트리 루트 표시명
  "rebars": [
    {
      "prim": "/RebarModel/Wall_Front_Vert_01",   // USDZ prim 절대 경로 — 조인 키
      "label": "벽체-전면-수직철근-01",             // 화면 표시명 (생략 시 §4.2 규칙으로 조립)
      "path": ["벽체", "전면", "수직철근"],          // 트리 경로 (잎 제외, 깊이 가변)
      "no": 1
    },
    {
      "prim": "/RebarModel/WallBase_Haunch_01",
      "label": "벽체-저판-보강철근(헌치철근)-01",
      "path": ["벽체-저판", "보강철근(헌치철근)"],
      "no": 1
    }
  ]
}
```

**규칙**

| # | 규칙 | 주체 | 우리 쪽 검증 | 어기면 |
|---|---|---|---|---|
| R1 | `prim`은 USDZ 안 prim의 **절대 경로**이며 파일 내에서 유일 | BriconLab | §6.1 중복 경로 감지 | 조인 실패 → 트리에 안 뜸 |
| R2 | prim 이름은 `[A-Za-z_][A-Za-z0-9_]*` — 하이픈·공백·점·숫자 시작 금지 | BriconLab | §6.1 중복 경로 감지가 간접 탐지 | Blender가 조용히 치환 → R1 위반 |
| R3 | **각 철근은 고유한 메시 데이터 이름을 가짐** (지오메트리 공유 금지) | BriconLab | §6.1 중복 경로 감지 | §3.7 — id가 조용히 뒤집힘 |
| R4 | `path`는 §4.1 어휘. 깊이는 부위마다 달라도 됨 | BriconLab | 없음 (사람이 확인) | 트리 라벨이 도면 용어와 어긋남 |
| R5 | `label`은 사람이 읽는 최종 문자열. 하이픈·한글 자유 | BriconLab | 없음 | §4.2 규칙으로 조립됨 |
| R6 | 한 prim이 여러 가닥을 담지 않음 (1 prim = 1 가닥) | BriconLab | §6.2 `ids.length > 1` 감지 | 잎 하나에 여러 가닥 — 개별 선택 불가 |
| R7 | `model_upload_at` / `prim_count`가 실제 USDZ와 일치 | BriconLab | §6.2 빌드 대조 | 라벨이 엉뚱한 철근에 붙음 |

**구조물이 여럿인 모델**: 1 사이드카 = 1 구조물이 원칙이다. 한 USDZ에 구조물이 여럿이면 `structure`는 대표명일 뿐이고 **구조물 구분은 `path[0]`에 넣는다** — 예: `["옹벽 A", "벽체", "전면", "수직철근"]`. R4의 명시적 예외다.

**스키마 검증**: `RebarMetaFile`은 `src/lib/analysis/rebarMetaSchema.ts`에 **zod 스키마**로 정의하고 타입은 스키마에서 추론한다 (`rebarsSchema.ts:2,30`의 기존 선례를 따른다). `safeParse` 실패 또는 `version !== 1`이면 사이드카를 무시하고 §8 2단계로 폴백하며 콘솔 경고 1회. iOS는 같은 필드의 `Codable` 구조체를 둔다.

**빌드 대조**: 로드한 모델의 `upload_at`·실제 prim 수와 `model_upload_at`·`prim_count`를 대조한다. 어긋나면 **사이드카를 버리고 §8 폴백**으로 가며 "계층 정보가 모델과 맞지 않습니다" 배지를 띄운다. 이게 없으면 prim 이름은 그대로인 채 배근만 바뀐 재출력에서 조인이 100% 성공하고 라벨만 다른 철근에 붙는다 — 오류도 경고도 없이.

### 5.2 조인 키 정규화 ★

조인 키인 "prim 경로"는 **세 곳에서 서로 다른 문자열로 나타난다.** 정규화 규칙 없이는 조인율이 0%가 되고 증상은 "트리가 비었다" 하나뿐이다.

| 출처 | 실제 문자열 예 |
|---|---|
| 사이드카 `prim` | `/RebarModel/Wall_Front_Vert_01` |
| 대시보드 `Rebar.id` (§6.1 이후) | three.js Object3D 부모 체인 조립 결과 — 루트 이름 포함 여부가 모델에 따라 다름 |
| iOS 엔티티 경로 | `modelEntity`가 `ModelLoader.swift:43-52`의 **무명 wrapper**에 `ModelAnchorController.swift:45`가 이름을 덮어쓴 것 — 사이드카에 없는 세그먼트가 낀다 |

**`normalizePrimPath(s: string): string`** — `taxonomy.ts`의 순수 함수. iOS는 동일 규칙의 Swift 포트를 둔다.

1. 빈 세그먼트를 제거한다 (선행·중복 슬래시 정규화).
2. **이름 없는 wrapper 세그먼트를 제거한다** — 우리가 붙인 `modelEntity`, `placementRoot`, 그리고 빈 문자열 세그먼트.
3. **USD 컨테이너 세그먼트를 제거한다** — `Scope` 타입에서 온 세그먼트 (`Meshes` 등). 3단 모델(§3.1)과 2단 모델을 같은 키로 만든다.
4. 대소문자·공백은 **변경하지 않는다** (USD는 대소문자 구분).
5. 선행 슬래시를 붙인 절대 경로로 반환한다.

조인은 정규화된 문자열끼리 한다. `Rebar.id`가 `경로#k` 형태면 `#k`를 떼고 맞춘다.

### 5.3 대시보드·앱의 수신 경로

- 대시보드: `GET /api/rebar-meta?ar_id=` 프록시 신설 (기존 `/api/model` 라우트와 같은 패턴 — HTTPS→HTTP 혼합 콘텐츠 회피). **`Cache-Control: no-store`** — 모델은 1시간 캐시하지만(`api/model/route.ts`) 사이드카는 캐시하지 않는다. 어긋난 조합이 캐시에 남으면 재현이 어렵다.
- iOS: `BackendClient`에 `fetchRebarMeta(arId:)` 추가. **캐시 키는 `ModelFileStore.swift:21,68-69`와 같은 `arID_uploadAt`** — 모델과 사이드카가 같은 키로 묶여야 §5.1 빌드 대조가 의미를 갖는다.
- `404`면 §8 폴백. 기능이 죽지는 않는다.

### 5.4 한글 prim 이름은 채택하지 않는다

§3.2 때문이다. 다만 **나중에 올릴 수는 있다** — BriconLab의 Blender가 5.0+이거나 `allow_unicode=True`를 넘긴다는 확인 + iOS 17 기기 검증이 둘 다 끝나면, prim 이름을 `전벽_전면_수직철근_01`로 바꿔도 이 설계는 그대로 동작한다(사이드카의 `prim` 값만 따라 바뀐다). 사이드카는 그 경우에도 계속 쓴다 — 하이픈 표시명과 구조화된 `path`는 prim 이름이 담을 수 없다.

---

## 6. 대시보드 설계

### 6.1 선행 — 경로 기반 id (§3.7 수정)

**`loadDesign.ts`**
- `object.traverse`에서 Mesh를 모을 때 **부모 체인을 거슬러 올라 경로를 조립**한다.
- 죽은 부모 폴백(`:28-31`)을 제거한다. 이름 없는 Mesh는 경로에 인덱스를 넣는다.

**`designExtract.ts`**
- `MeshData`에 `path: string` **필수 필드** 추가 (optional + `path ?? name` 폴백은 §3.7의 조용한 실패를 그대로 남긴다). `name`은 유지.
- `rebarsFromMeshes`의 `byName` 전역 맵 → **경로 키 맵**. 서로 다른 부모 아래 같은 리프 이름이 더 이상 뭉치지 않는다.
- **중복 경로 감지**: 같은 경로가 두 번 들어오면 콘솔 경고 + 결과에 개수 리포트. 지금은 조용히 `#k`로 넘어간다.
- **`#k` 순번 안정화** — 순서가 중요하다:
  1. 반경·길이 **필터를 먼저 적용**해 살아남은 연결요소만 모은다.
  2. 남은 연결요소를 **중심점 사전순(x→y→z)으로 정렬**한다.
  3. 그 순서로 k를 부여한다. 단일/다중 분기도 **필터 후 개수**로 판정한다.

  현재는 필터가 k 부여 뒤에 걸려서, 짧은 파편 하나가 생기거나 사라지면 무고한 철근의 id가 `경로` ↔ `경로#1`로 뒤집힌다.
- `Rebar.id` = 정규화된 경로 (단일) 또는 `경로#k` (다중).

**영향**
- `designExtract.test.ts`의 **id 단언 4곳**(`:78`, `:89`, `:104`, `:114`)과 **`MeshData` 리터럴 6곳**(`:71-75`, `:87`, `:94-101`, `:102`, `:103`, `:111`)을 함께 갱신한다. vitest는 타입체크를 하지 않으므로, 리터럴을 빠뜨리면 컴파일 에러가 아니라 **전 메시가 `undefined` 키로 한 그룹에 뭉치는 런타임 오작동**으로 나타난다.
- `AnalysisResult`에 **`idScheme: "name" | "path"`** 를 추가한다 (**`version`은 2 유지** — optional 필드 추가라 기존 blob이 그대로 로드된다. 없으면 `"name"`으로 해석). 로드 시 스킴이 현재와 다르면 트리 상단에 "이전 식별 방식으로 저장돼 계층 정보를 붙일 수 없습니다 — 재분석하세요" 배지를 띄우고 재분석을 유도한다. 이게 없으면 같은 현장에서 "어떤 스캔은 계층이 나오고 어떤 스캔은 안 나온다"가 되고 원인을 알 방법이 없다.
- 서버 PUT 가드(`api/analysis-result/route.ts:34`)와 클라 로드 가드(`AnalysisView.tsx:139-142`)는 그대로 둔다.
- `requiredSpacingState.ts`는 `${directionId}/${layer}` 키만 쓰므로 **영향 없다**.

### 6.2 계층 해석기 — `src/lib/analysis/taxonomy.ts` (신설, 순수 TS)

```ts
export interface RebarNode {
  path: string[];       // 트리 경로 (잎 제외)
  label: string;        // 표시명 — 사이드카 label 또는 §4.2 규칙
  no: number | null;
  ids: string[];        // 이 잎에 매달린 Rebar.id 목록 (R6 위반 시 2개 이상)
}

export interface Taxonomy {
  root: string;                    // 트리 루트 표시명
  byId: Map<string, RebarNode>;    // Rebar.id → 노드
  unmatched: string[];             // 조인 안 된 Rebar.id (도면 외 + 조인 실패)
  unmatchedPrims: string[];        // 사이드카에는 있는데 Rebar가 없는 prim (경고용)
  source: "sidecar" | "primName" | "geometry";
}

/** UI 비의존 트리 노드 — Mantine 변환은 컴포넌트에서 한다 */
export interface TaxonomyTreeNode {
  value: string;                   // 내부 노드 = path.join("/"), 잎 = 정규화된 prim 경로
  label: string;
  count: number;                   // 이 서브트리에 매달린 Rebar.id 총수
  children?: TaxonomyTreeNode[];
}

export function normalizePrimPath(s: string): string;
export function taxonomyFromSidecar(meta: RebarMetaFile, ids: string[]): Taxonomy;
export function taxonomyFromPrimNames(ids: string[]): Taxonomy;
export function taxonomyFromGeometry(records: RebarRecord[]): Taxonomy;
export function buildTree(t: Taxonomy): TaxonomyTreeNode[];
```

**`ids`의 정의**: 항상 **설계 철근 id의 전체 집합**이다.
- 분석 직후: `designRebars.map(r => r.id)`
- 저장 결과만 로드된 화면: `result.rebars.map(r => r.designId).filter(Boolean)`

선택 상태는 트리 함수에 넘기지 않는다 — UI가 별도 `Set<string>`으로 관리한다.

**노드 키**: 내부 노드 `value = path.join("/")`, 잎 `value = 정규화된 prim 경로`. Mantine의 체크 상태는 이 `value` 문자열로만 식별되므로 유일해야 한다.

**R6 위반 시**(한 prim에 여러 가닥): 잎은 **prim당 1개만** 만들고 `ids`에 전부 담는다. 체크 해제하면 `ids` 전부가 함께 숨는다. 체크박스 옆에 "개별 선택 불가" 표시를 단다.

**「분류 없음」 고정 노드**: `unmatched`가 비어 있지 않으면 트리 루트 아래에 `분류 없음 (N)` 노드를 고정으로 만든다. **기본 체크 상태이고, 사용자가 명시적으로 끄기 전에는 절대 숨지 않는다.** 판정 `extra`(도면 외)는 `designId = null`이라(`judge.ts:29-33`, `types.ts:60`) 사이드카 트리에 노드가 존재할 수 없다 — 이 노드가 없으면 **어떤 필터를 켜든 「도면 외」가 0건이 되고**, 그 화면을 캡처하면 검측 문서에 거짓이 남는다. 미시공은 남고 도면 외만 사라지는 한쪽 편향이라 더 위험하다.

순수 함수 · three.js/DOM/Next/@mantine import 금지 (기존 `lib/analysis` 규칙). vitest로 테스트한다.

### 6.3 트리 UI

- **Mantine 9.4.1의 `Tree` + `useTree`** 사용. 체크 상태 API(`checkedState`/`isNodeChecked`/`isNodeIndeterminate`/`getCheckedNodes`/`checkStrictly`)는 있지만 **체크박스 렌더는 `renderNode`에서 `<Checkbox indeterminate>`로 직접 그려야 한다** — `Tree`가 제공하는 체크박스 관련 prop은 `checkOnSpace` 하나뿐이다. 부모 체크 → 자손 토글은 `checkStrictly: false`(기본값)가 해 준다.
- `<RebarTree>`는 **`AnalysisView` 종속이 아니라** `(TaxonomyTreeNode[], 선택 Set, onChange)`만 받는 순수 컴포넌트로 만든다. 「현장 관리 → 3D 모델 뷰」에도 꽂을 수 있게 하되, **이번 범위는 「시공 분석」뿐이다**(§10).
- **자리**: `AnalysisView.tsx`(779줄)에 빈 곳이 없다. 우측 380px 패널을 `Tabs`로 「분석」/「철근」 두 탭으로 나누고 트리를 「철근」 탭에 둔다. 3단 레이아웃(Splitter)은 도입하지 않는다.
- 같은 커밋에서 `AnalysisView.tsx`를 쪼갠다: `<MetricControls>`, `<SpacingTable>`, `<RebarTable>`, `<RebarTree>`. 트리를 얹기 전에 해야 안전하다.
- **색을 쓰지 않는다.** 체크박스 + 텍스트만. 판정 6색·컨투어 5색 재사용은 디자인 시스템이 명시적으로 금지하고(`docs/design-system.md:213`), 새 색 체계를 만들 이유가 없다. "색만으로 전달 금지"(:75)도 자동으로 지켜진다.
- 행 높이는 클릭 대상 최소 32×32px(:202)을 지킨다.
- 노드 라벨 옆에 개수 배지 — **`ids.length` 합계**로 정의한다(§6.4의 가시성 논리곱과 같은 모집단).
- **`source` 배지는 필수다.** `source !== "sidecar"`이면 트리 상단에 고정 문구를 띄운다:

  | `source` | 문구 |
  |---|---|
  | `sidecar` | (배지 없음) |
  | `primName` | 모델 이름 규칙으로 추정 — 도면 확인 필요 |
  | `geometry` | 형상 자동 분류 — 부위 구분 아님 |

  이게 없으면 기하 분류로 만든 3단계 트리가 루트에 "옹벽"을 달고 도면 기반 분류인 척한다.
- **성능**: 잎이 500개를 넘으면 부모 노드를 **기본 접힘 + 지연 확장**한다. Mantine `Tree`는 가상화가 없어 잎 2000개면 토글마다 전체 재렌더가 돈다 — 실제로 가장 먼저 죽는 지점이다.

### 6.4 필터의 의미 — **표시 전용**

이 결정이 가장 많은 것을 막아준다.

#### 6.4.1 id 공간 변환 ★

트리 선택은 **설계 id** 공간인데 컨투어 표본은 전부 **스캔 id** 공간이다(`spacing.ts:149` `aId: r.a.id, bId: r.b.id`는 `scanTransformed` 기준, `AnalysisView.tsx:333`은 `byId.get(rec.scanId)`). 변환 없이 그대로 필터하면 **교집합이 항상 공집합**이 되어 `samples.length === 0` → `AnalysisView.tsx:351`에서 contour가 null이 되고 편차 지도가 통째로 사라진다.

```
① 트리 선택                       → V_design: Set<설계 id>
② view.rebars 순회
   designId ∈ V_design && scanId != null  → V_scan: Set<스캔 id>
③ 위치 편차: positionSamples 를 V_scan 으로 필터
   간격 편차: gaps.filter(g => V_scan.has(g.aId) && V_scan.has(g.bId))
              — 양 끝이 모두 보일 때만
```

표본이 0개면 contour를 null로 떨구지 말고 **"선택한 철근에는 간격 구간이 없습니다"** 상태를 렌더한다.

#### 6.4.2 대상별 동작

| 대상 | 필터 적용 시 동작 | 이유 |
|---|---|---|
| 3D 뷰어 철근 | 숨긴 철근의 `THREE.Group.visible = false` | 철근 1개 = Group 1개 (`AnalysisViewer.tsx:96-106`) |
| 철근 표 | 보이는 것만 행 표시 | — |
| **간격 구간 표** | 행은 **그대로 두되** 숨긴 철근이 낀 행을 흐리게 하고 표 헤더에 「필터 중 — 간격은 전체 기준」 배지 | 기본 지표가 `spacing`이라 실제로 화면에 떠 있는 표는 이쪽이다(`AnalysisView.tsx:90,621,699`). 규정하지 않으면 전벽만 남긴 화면에서 3D는 전벽만 보이는데 표는 저판·헌치 구간을 그대로 나열해 사용자가 "필터가 고장났다"고 판단한다 |
| 판정 카운트 (정상/허용초과/미시공/도면외) | **보이는 부분집합으로 다시 센다.** 모집단 = 체크된 잎에 속한 철근 ∪ 「분류 없음」 철근 | 단순 카운트라 안전 |
| `summary.deviationMm` (평균·최대) | **카운트와 같은 모집단으로 함께 다시 계산한다** | 안 하면 "미시공 0 · 허용초과 0 · 최대 61mm" 같은 자기모순이 나오고, 그 61mm는 화면에 보이지도 않는 철근의 값이다 (`AnalysisView.tsx:583-593`, `judge.ts:86-91`) |
| 철근별 `deviationMm` | **재계산하지 않는다** | 매칭 결과이며 부분집합과 무관 |
| 간격 통계 (`spacingGroups` 중앙값 등) | **재계산하지 않는다.** 필터 중임을 배지로 표시 | 간격은 **인접 쌍**이다 — 가운데를 빼면 양옆이 새 이웃이 되어 값 자체가 달라진다(`spacing.ts:107-155`). 요구간격 폴백 `requiredMm[key] ?? med`(`spacing.ts:146`)가 남은 철근들의 편차까지 함께 움직인다 |
| 컨투어 | §6.4.1로 변환한 `V_scan`의 표본으로 **다시 보간한다.** 벽면 평면(`fitWallPlane`)은 **전체 기준 유지** | 재보간을 안 하면 숨긴 철근의 편차를 계속 칠해 화면이 자기모순을 보인다. 평면까지 흔들리면 필터를 바꿀 때마다 비교 기준이 달라진다 |

**필터가 걸린 동안 통계 카드 묶음 전체에 「선택한 철근 기준」 캡션을 강제한다.**

#### 6.4.3 컨투어 투영 가드 ★

선택된 철근들의 대표 축이 벽 법선과 이루는 각이 **60° 임계 밖이면 컨투어를 그리지 않고** "이 부위는 벽면 지도에 투영할 수 없습니다 (깊이 방향 정보 손실)"를 표시한다.

`contour.ts:118-121`은 `{ u: dot(d, plane.axisU), v: dot(d, plane.axisV) }`로 **법선 성분을 버린다.** 저판·헌치처럼 벽 법선과 어긋난 부위만 필터하면, 깊이가 다른 수십 개 철근이 같은 (u,v)로 겹쳐 평균된 색 띠 하나가 그려진다 — 부정확한 게 아니라 **무의미한 지도**다. 부위별 평면(저판=수평면)은 §10 범위 밖.

#### 6.4.4 구성 이펙트와 가시성 이펙트의 분리 ★

현재 판정 칩 필터는 `disposeChildren(s.overlay)` 후 전면 재생성이고(`AnalysisViewer.tsx:266-267`), `keyed` 맵에는 `showVerdicts`를 통과하고 `showScanBars`가 켜진 레코드만 들어간다(`:268`, `:284`, `:298`). 그래서 "기존 `keyed` 맵을 가시성 제어에 재사용"은 그대로는 성립하지 않는다 — 판정 칩으로 꺼둔 철근은 트리에서 체크해도 `keyed.get()`이 undefined라 3D에 나타나지 않는다(배지는 48인데 30개만 켜지는 증상).

**규칙**:
> 구성 이펙트는 `records`/`design`/`scan`만 보고 **모든** 레코드의 Group을 만들어 `keyed`에 채운다. `showVerdicts`·`showScanBars`·트리 선택 **세 필터는 전부 가시성 이펙트에서 `group.visible = A && B && C`로만 처리한다.** 개수 배지도 같은 논리곱을 쓴다.

판정 칩의 구성→가시성 이관이 곧 "기존 칩 필터의 deps 누락 수정"이다. `noDesign` 분기는 키 공간이 **스캔 id**임에 주의한다.

**성능**: 재보간은 **150ms 디바운스**한다. `contour.ts:131-148`의 3중 루프(48×32 격자 × 표본 수 × `Math.pow`)가 메인스레드에서 도므로, 디바운스 없이는 체크박스 클릭마다 수백 ms 정지한다. 표본이 상한을 넘으면 격자를 축소한다.

### 6.5 스키마

`AnalysisResult`는 **`version: 2` 그대로**다. 계층은 저장하지 않고 조회 시점에 사이드카로 다시 조인한다 — `designId`가 안정적인 경로 기반 id가 되므로 재조인이 가능하다. 추가되는 것은 `idScheme` optional 필드 하나뿐이다(§6.1).

**주의**: "저장된 결과만 로드된 화면"은 `output === null`이라 3D가 비어 있다(`AnalysisView.tsx:496-500`). 트리는 **저장된 `result.rebars`에서도 만들 수 있게** 한다(§6.2 `ids` 정의 참조).

---

## 7. LH 앱 설계

### 7.0 선행 검증 — 이것 없이는 착수 불가

RealityKit이 prim 이름을 `Entity.name`으로 보존하는지 **코드로는 확인할 수 없다**(§3.4). 기기에서 먼저 잰다.

`ModelAnchorController`에 `#if DEBUG` 진단을 추가한다:
- 로드된 엔티티 트리를 DFS하며 각 노드의 `name`·깊이·`ModelComponent` 유무를 덤프
- `lastCollisionNodeCount`(`:17`, 현재 아무도 안 읽음)를 DEBUG HUD에 노출
- **`isEnabled = false`인 노드에 측정 레티클이 스냅되지 않는지**(§3.6의 미확인 가정)

**판정 기준 — 개수 비교가 아니라 집합 포함 관계다.**

> 앱이 덤프한 (정규화된) 경로 집합이, 대시보드 `Rebar.id`에서 `#k`를 뗀 집합을 **포함**하면 통과.

개수는 구조적으로 일치하지 않는다 — 대시보드는 반경 0.05m·길이 0.1m 필터(`designExtract.ts:58-59,81`)와 연결요소 분리(`:63-69`)를 하는데 앱은 `ModelComponent` 유무만 본다(`ModelAnchorController.swift:131`). 개수 차이는 필터·연결요소 분리·비철근 노드로 설명 가능한지만 기록한다. 이 기준을 개수 비교로 두면 이름이 완벽히 보존돼도 §7.5로 잘못 밀려 산출물 ③이 폐기된다.

### 7.1 노드 열거·숨김 — `ModelAnchorController`

```swift
/// ModelComponent를 가진 노드의 정규화된 경로 목록.
static func meshNodePaths(of root: Entity) -> [String]

/// 경로 집합에 해당하는 노드의 isEnabled를 설정한다. 반환값은 매칭된 노드 수.
@discardableResult
func setHidden(_ hidden: Bool, paths: Set<String>) -> Int
```

- 기존 `installCollision`(`:126-145`)과 같은 스택 DFS 패턴을 따른다. 새 순회 인프라를 만들지 않는다.
- 경로는 **§5.2 규칙의 Swift 포트**로 정규화한다 — `modelEntity`/`placementRoot` wrapper 세그먼트를 제거해야 사이드카 `prim`과 맞는다.
- 형제 동명 노드가 있으면 경로가 충돌한다 → 그 경우 `#k` 접미사를 붙이고 DEBUG 로그를 남긴다.
- `setHidden`의 반환값을 DEBUG HUD에 노출한다. **0이 나오면 조인 실패이고, 그게 유일한 증상이다.**
- 숨김은 **`isEnabled = false`** (§3.6). 실패 시 대안은 `CollisionComponent` 제거/복원.
- `applyOpacity`(`:156-181`)는 손대지 않는다 — `isEnabled=false` 노드에도 머티리얼을 갱신해 두어야 다시 켰을 때 투명도가 맞다.
- **성능**: 노드 수가 임계를 넘으면 `installCollision`을 부위 단위로만 설치한다. `place()` 시점에 노드마다 `ShapeResource.generateBox`를 **동기 생성**하고(`:126-145`) 매 프레임 hitTest가 돈다(`MeasurementController.swift:184-190,242-246`).

### 7.2 필터 상태의 수명

`resetPlacement` → `removeCurrent`가 `modelEntity`를 nil로 만들고, 재배치는 **새 clone**을 만든다(`ModelAnchorController.swift:103-114`, `PlacementViewModel.swift:64`). 따라서:

- 필터 상태는 **엔티티 참조가 아니라 정규화된 경로 문자열 `Set<String>`** 으로 `PlacementViewModel`이 보유한다.
- `place()` 직후 저장된 필터를 재적용하고, `setHidden`의 반환값이 0이면 필터를 **비운다** (다른 모델로 바꿔 배치한 경우 — 조용히 아무것도 안 숨기는 상태로 두지 않는다).

### 7.3 트리 UI

- `AppFeatures.rebarFilter`로 게이트한다 — **이 플래그를 실제로 읽는 최초이자 유일한 지점**. `#if LH_ONLY`를 화면 코드에 뿌리지 않는다 (CLAUDE.md 고차 #13).
- SwiftUI `DisclosureGroup` 기반 시트/오버레이. 기존 `FineAdjustPad` 오버레이 패턴을 따른다.
- 라벨은 사이드카의 `label`·`path`를 그대로 쓴다.
- **`source` 배지는 대시보드와 동일 문구를 쓴다**(§6.3 표). 두 앱이 같은 이름표를 보여야 하듯 같은 신뢰도 표시를 해야 한다.
- 새 Swift 파일을 추가하면 **`xcodegen generate` 필수** (CLAUDE.md 고차 #10).
- **`RebarTaxonomy.swift`** 가 §8 2단계 코드북과 §5.2 정규화를 이식한다. TS와 **동일한 케이스 표**로 XCTest를 둔다 — 두 구현이 갈라지면 두 앱의 트리가 달라진다.

### 7.4 사이드카 수신

`BackendClient.fetchRebarMeta(arId:)`. 캐시 키는 `arID_uploadAt`(§5.3). 실패·404는 치명적이지 않다 — §8 폴백.

### 7.5 실패 시 동작

- **이름이 보존되지 않으면** 앱 내 필터는 성립하지 않는다. 대안은 **모델 생성 단계에서 부위별로 USDZ를 나눠 받는 것**이고, 그건 이 스펙의 범위 밖이다 — 별도 설계가 필요하다.
- **이름은 보존되나 코드북에 안 맞으면**(훨씬 흔한 경우) 루트 아래 평평한 `전체 (n)` 리스트로 열거해 **개별 토글은 유지한다.** 계층은 없지만 필터는 동작한다.

---

## 8. 폴백 계층 — 사이드카가 없을 때

§2에 적었듯 이 폴백은 사용자 결정의 확장이며 **별도 승인이 필요하다.** 특히 3단계는 결정 1이 배제한 기하 추론이다.

**대시보드는 3단까지, 앱은 2단까지 낮아진다.** 3단계는 대시보드 분석 산출물(`label.ts:68`)이 있어야 돌아가므로 앱에서는 성립하지 않는다 — 앱은 2단계가 실패하면 §7.5로 간다.

| 단계 | 조건 | 트리 | 루트 | 적용 대상 |
|---|---|---|---|---|
| 1 · `sidecar` | 사이드카 JSON 유효 + 빌드 대조 통과 | §4.1 전체 계층 | `structure` 값 | 대시보드 · 앱 |
| 2 · `primName` | 코드북 해석률 ≥ 60% | 이름에서 유도 | `"구조물"` | 대시보드 · 앱 |
| 3 · `geometry` | 위 둘 다 실패 | 방향군 × 레이어 | `"자동 분류"` | **대시보드 전용** |

### 8.1 2단계 — prim 이름에서 유도

**파싱 순서** (§6.1 이후 `Rebar.id`는 경로임에 주의):

1. id에서 `#k`를 뗀다.
2. **마지막 `/` 뒤 세그먼트를 취한다.** (이 단계를 빠뜨리면 정규식이 하나도 안 맞아 조용히 3단계로 떨어진다.)
3. `_`로 쪼갠다.
4. 꼬리의 **순수 숫자 토큰**을 번호(`no`)로 뗀다.
5. 남은 토큰을 코드북으로 매핑한다.

**코드북**

| 토큰 | 표시명 |
|---|---|
| `Wall` / `Base` / `WallBase` | 벽체 / 저판 / 벽체-저판 |
| `Front` / `Rear` / `FrontRear` / `Top` | 전면 / 배면 / 전면-배면 / 상단 |
| `Upper` / `Lower` / `UpperLower` | 상부 / 하부 / 상부-하부 |
| `Vert` / `Horiz` | 수직철근 / 수평철근 |
| `Trans` / `Long` | 횡방향철근 / 종방향철근 |
| `Shear` / `Reinf` / `Haunch` | 간격재 / 보강철근 / 헌치철근 |
| `V` / `H` | 수직철근 / 수평철근 (약어 확장) |

**레거시 어댑터**: 현재 as-built 모델은 `TopV_01` — 토큰 하나에 두 축이 붙어 있다. `^(Top|Bot)(V|H)$` 정규식 하나로 분해한다. **as-built 생성기 전용 어댑터임을 코드에 명시한다.**

**어휘 격리 ★**: 2단계 결과에는 **부위 레벨이 없다.** `상부 > 수직철근`은 §4.1이 배타적으로 갈라놓은 어휘(저판의 상부/하부 + 전벽의 수직/수평)를 섞는 것이라 그대로 쓰면 결정 2 위반이다. 따라서 **레거시 어댑터 경로에서는 부위 어휘를 일절 쓰지 않고 기존 기하 어휘로 표시한다**:

```
자동 분류 > 상단 > 세로 > 01        (부위 어휘 아님이 눈에 보이게)
```

`Stem`/`Base`/`Haunch` 토큰이 실제로 있는 경우(신규 규약)에만 §4.1 어휘를 쓴다.

**진입 임계**: 전 토큰이 해석되는 prim의 비율이 **60% 이상**이면 2단계를 채택한다. 미달이면 3단계. 해석 실패한 prim은 루트 직속 `미분류 (N)` 노드에 넣는다.

**라벨**: §4.2 규칙(`[...path, zeroPad2(no)].join("-")`)으로 조립한다.

### 8.2 3단계 — 기하 자동 분류

`label.ts:68`이 이미 `세로-내측-1` 형식 라벨을 붙이므로 그 그룹 키(`${direction}/${layer}`)를 2단 트리로 쓴다. **부위 어휘를 일절 쓰지 않는다.** 루트는 `"자동 분류"`, `source` 배지는 "형상 자동 분류 — 부위 구분 아님".

`frameSource:"scan"`(설계모델 없음) 경로에서도 트리가 뜨게 하는 유일한 수단이다.

### 8.3 왜 이게 중요한가

**BriconLab 회신을 기다리지 않고 오늘 있는 모델로 만들고 검증할 수 있다** — 세 현장의 `TopV_01` 60개가 그대로 2단계 트리가 된다. 다만 그건 **배선 검증**이지 설계 모델 경로의 검증이 아니다(§9 V3).

---

## 9. 검증 계획

이 프로젝트는 "검증 없는 완료 보고 금지"가 규칙이다. 각 항목은 **출력을 눈으로 본 뒤에만** 통과로 친다.

| # | 무엇 | 어떻게 | 통과 기준 |
|---|---|---|---|
| V1 | `taxonomy.ts` 단위 | vitest — 사이드카/prim이름/기하 3경로, 깊이 가변, `unmatched`/`unmatchedPrims`, R6 위반, 60% 임계, 레거시 어댑터. **`normalizePrimPath`는 절대/상대/wrapper 3형태가 같은 키가 되는 케이스 포함** | 전부 통과, 기존 154개 회귀 없음 |
| V1' | `RebarTaxonomy.swift` 단위 | XCTest — V1과 **동일한 케이스 표** | TS와 같은 결과 |
| V2 | 경로 기반 id 회귀 | vitest — `designExtract.test.ts` 갱신, 중복 경로 경고, **파편 1개를 추가/제거해도 나머지 id가 변하지 않음** | 통과 |
| V3 | 배선 검증 (플레이스홀더 모델) | 실제 `ar_id`로 「시공 분석」 실행 | 60개 철근이 4갈래 2단계 트리로 뜨고, 체크 해제 시 3D에서 사라진다. **`source` 배지가 "모델 이름 규칙으로 추정"으로 뜬다** |
| V3' | **설계 모델 검증** | §11-1 해소 후 옹벽 설계 모델로 V3 재실행 | 사이드카 1단계 트리 |
| V4 | 컨투어 연동 | V3 상태에서 그룹 하나만 남기고 컨투어 켬 | §6.4.1 변환을 거쳐 **남은 철근 영역만** 칠해진다. 표본 0이면 "간격 구간이 없습니다" |
| V5 | 대시보드 배포 | `npm run build` → `vercel deploy --prod` → 서빙된 번들에서 신규 문자열 확인 | 확인 |
| V6 | **앱 엔티티 이름 덤프** | §7.0 — 기기에서 DEBUG HUD | **정규화 후 앱 경로 집합 ⊇ 대시보드 id 집합**. 개수 차이는 원인만 기록 |
| V7 | **앱 트리 필터** | 기기 — LH 앱에서 그룹 토글 | 해당 철근만 사라지고, **측정 레티클이 숨긴 철근에 스냅되지 않는다** |
| V8 | 앱 재배치 후 상태 유지 | 기기 — 필터 건 상태에서 삭제 후 재배치 | 필터가 그대로 재적용된다. 다른 모델을 배치하면 필터가 비워진다 |
| V9 | 연구과제 앱 무변화 | 기기 — 연구과제 앱 실행 | 트리 UI가 뜨지 않는다 (`rebarFilter=false`) |
| V10 | 성능 | 합성 2000가닥 픽스처 | 트리 토글 응답 < 1s, 배치 지연(`lastCollisionNodeCount` + 실측 ms) 기록 |

V6~V9는 기기가 필요하다. **현재 두 앱 모두 어떤 화면도 기기에서 확인된 적이 없다** — `docs/ar-app-split-device-check.md`의 13개 항목과 함께 처리한다.

---

## 10. 범위 밖

- **「현장 관리 → 3D 모델 뷰」의 트리** — `<RebarTree>`는 재사용 가능하게 만들지만 이번엔 「시공 분석」에만 꽂는다.
- **캡처 푸터의 필터 상태 표기** — §4.2에서 캡처 푸터를 뺐다.
- **부위별 컨투어 평면** (저판=수평면) — §6.4.3은 투영 불가를 **감지해 막을** 뿐 부위별 평면을 만들지 않는다.
- **오차 시각화 (연구과제 앱)** — 대시보드 분석 결과를 AR로 겹치는 기능. 별도 설계.
- **철근 종류 필터** (주철근/스터럽/띠철근 등) — 부위 계층과 다른 축이다. 사이드카에 축을 하나 더 붙이면 확장 가능하지만 지금은 요청에 없다.
- **곡선 철근** — `extractCenterline`이 PCA 직선 근사다. 기존 한계 그대로.
- **한글 prim 이름** — §5.4. 검증 두 개가 끝나면 별도로 올린다.
- **`coarseCandidates` PCA 고유벡터 스왑 취약성** — 기존 알려진 한계(CLAUDE.md §8). 이 작업과 무관.

---

## 11. 미해결 · BriconLab 대기

| # | 무엇 | 누가 | 막히는 것 |
|---|---|---|---|
| 1 | **옹벽 설계 모델이 가닥별 prim으로 나뉘는가** — §3.1은 as-built 생성기에 대한 증명이고 설계 변환 경로는 다르다 | BriconLab이 샘플 USDZ 1개 제공 → 우리가 `loadDesign`에 태워 확인 | 통짜 메시면 **③은 전면 불가**, ②는 잎 1개짜리 전부-켜기/끄기로 **퇴화**(`splitByConnectivity`가 가닥으로 쪼개기는 하므로 완전히 죽지는 않는다) |
| 2 | **BriconLab의 Blender 버전과 `wm.usd_export` 호출 인자** | BriconLab 회신 | 한글 prim 이름 채택 여부 (현 설계는 영향 없음) |
| 3 | **사이드카 엔드포인트 구현** | BriconLab | 1단계 트리. 2단계 폴백으로 그 전에도 동작 |
| 4 | **RealityKit의 prim 이름 보존** | 우리 · §7.0 기기 검증 | ③ |
| 5 | **`isEnabled=false`가 충돌체를 끄는가** | 우리 · §7.0 기기 검증 | 숨김 수단 (실패 시 CollisionComponent 제거/복원) |

**동시에 고칠 우리 쪽 문서**: `api/USDZ_REQUEST.md:37-41`의 예시 커맨드에 옵션이 하나도 없다 → `allow_unicode`/`author_blender_name` 등을 명시한 형태로 갱신한다. (축·단위 요구는 이미 반영·검증됐으므로 **건드리지 않는다** — CLAUDE.md 고차 #4.)

---

## 12. 함께 갱신할 문서

- `CLAUDE.md` §8 — BriconLab 대기 항목에 사이드카 엔드포인트 추가. 고차 목록에 §3.7(메시 데이터블록 이름) 추가. §1의 "추후 철근 종류별 필터링" 문장을 "철근 계층(부위/면/방향)별 필터"로 정정.
- `LHRebarAR/App/AppFeatures.swift:18` 주석 — "철근 종류별 필터링" → "철근 계층(부위/면/방향)별 필터".
- `docs/design-system.md` — §7.6 트리 UI 절 신설(색 미사용 원칙, 행 높이 하한, `source` 배지 문구), §10 버전표 갱신.
- `docs/superpowers/specs/2026-08-04-ar-app-split-design.md` — 열린 항목 "철근 종류별 필터링"을 **부분 해소**로 표시한다: 선행 확인(가닥별 prim 분리)은 §3.1로 해결됐고, 필터는 **부위 계층 필터**로 구현되며 **기능표의 '철근 종류' 축은 여전히 미구현**이다. 완전 해소로 닫으면 만들지 않은 것이 근거 문서상 해결됨이 된다 — LH 전용 앱에 남은 유일한 차별 기능이므로 특히 위험하다.
- `docs/ar-app-split-device-check.md` — V6~V10 추가.
