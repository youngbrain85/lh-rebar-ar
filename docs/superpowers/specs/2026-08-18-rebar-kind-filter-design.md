# LH 전용 앱 철근 필터 — 실제 설계모델 대응 + 종류축 추가

**작성일** 2026-08-18 · **브랜치** `feat/rebar-kind-filter`
**선행 스펙** `docs/superpowers/specs/2026-08-05-rebar-hierarchy-design.md` (분류 체계·사이드카·3단 폴백은 그 문서가 확정했다. 이 문서는 그 위의 변경분만 다룬다.)

---

## 1. 무엇을 만드는가

사용자 원문:

> 현재 설계모델이 DB에 업로드 되었어. 이걸 기반으로 LH전용 AR앱에서 철근 종류별 시각화 필터링 하는거 업데이트 해줘.

실측해 보니 분류 로직은 실제 모델에서 100% 정확한데 **그 화면에 도달하는 길이 두 군데 막혀 있었다.** 그래서 이 작업은 세 덩어리다.

| # | 덩어리 | 성격 |
|---|---|---|
| A | 모델 목록 디코딩 복구 (`ar-list` 응답 모양 변경 대응) | 회귀 수정 — 없으면 기능을 볼 수 없다 |
| B | 필터가 실제로 숨기도록 수정 | 회귀 수정 — 지금은 아무것도 안 숨겨진다 |
| C | 부위순 / 종류순 축 전환 | 신규 기능 — 사용자가 요청한 것 |

**범위는 LH 전용 앱(`kr.lh.rebar-lh`, 타겟 `LHRebarARLH`)이다.** 대시보드도 같은 원인으로 프로덕션에서 죽어 있지만 사용자가 별도 작업으로 남기기로 결정했다(§9).

---

## 2. 확정된 결정

사용자가 직접 정한 것 — 재논의 대상 아님.

1. **트리는 부위순/종류순 전환 토글로 간다.** 한 축만 고르지 않는다.
2. **대시보드 크래시는 이번 범위 밖이다.** 앱을 먼저 고친다.
3. **CI에 Swift 테스트 단계를 넣는다.** ("알아서 하고" 위임 → §7에서 넣기로 판단. 근거: 이번에 샌 결함 3건이 전부 순수 로직이고 단위 테스트가 잡았을 것들이다.)

---

## 3. 실측 사실

전부 2026-08-18에 직접 측정했다. 설계의 전제이므로 근거를 남긴다.

### 3.1 업로드된 설계모델

`GET http://api.briconlab.com:50001/analysis/usdz?ar_id=2` (site 1) · `?ar_id=3` (site 2)
→ **두 파일 md5 동일** (`2f93bf86cb9faf89737e8c73e6bf954a`, 51,420 B). 아직 현장별로 다른 모델은 아니다.

```
#usda 1.0
( defaultPrim = "RebarModel"  metersPerUnit = 1  upAxis = "Y"
  doc = "Design rebar model from Mock-up(2)_2.ifc (structure=wall, bars=45;
         Z-up mm -> Y-up m, recentred)" )

def Xform "RebarModel" {
    def Mesh "Wall_FrontRear_Shear_01" { … }   ← 45개 전부 이 한 줄 깊이의 형제
    …
    def Scope "Materials" { def Material "Shear" / "Wall_Front" / "Wall_Rear" }
}
```

**BriconLab이 `api/브리콘랩_철근계층_요청.txt`의 prim 토큰 규약을 그대로 이행했다.**

| prim 토큰 | 개수 | 분류표 경로 | 형상 (bbox 실측) |
|---|---|---|---|
| `Wall_FrontRear_Shear` | 13 | 벽체 / 전면-배면 / 간격재(전단철근) | D12.7 · 612mm · 400mm 단 |
| `Wall_Front_Horiz` | 9 | 벽체 / 전면 / 수평철근(배력철근) | D15.9 · 1000mm · @200 |
| `Wall_Front_Vert` | 9 | 벽체 / 전면 / 수직철근 | D22 · 1651mm · @125 · **43mm 경사** |
| `Wall_Rear_Horiz` | 9 | 벽체 / 배면 / 수평철근(배력철근) | D15.9 · 1000mm · @200 |
| `Wall_Rear_Vert` | 5 | 벽체 / 배면 / 수직철근(주철근) | D12.7 · 1651mm · @250 |

모델 전체 bbox 1.022 × 1.658 × 0.613 m. 분류표 12행 중 5행만 존재 — 저판(`Base_*`)·`Wall_Top_Reinf`·`WallBase_Haunch`는 없다. 목업 벽체라 정상이다.

두 가지 부수 사실:
- **변환 출처가 IFC다** (`Mock-up(2)_2.ifc`). 이 저장소가 기록해 온 Revit→OBJ 경로도, `api/USDZ_REQUEST.md`가 요청한 FBX→Blender 경로도 아니다.
- **머티리얼에 색이 이미 박혀 있다** — 전면 `(0.85,0.45,0.15)` 주황, 배면 `(0.2,0.45,0.85)` 파랑, 간격재 `(0.35,0.7,0.35)` 초록. 우리 판정 6색·컨투어 5색과 섞이면 의미가 충돌한다. 이번 범위에서 건드리지 않되 §9에 남긴다.

### 3.2 분류는 실제로 통과한다 (실행 검증)

실측 45개 경로를 대시보드 파서에 그대로 넣어 vitest로 돌렸다:

```
source: primName   unmatched: 0
  13  벽체 > 전면-배면 > 간격재(전단철근)
   9  벽체 > 전면     > 수평철근(배력철근)
   9  벽체 > 전면     > 수직철근
   9  벽체 > 배면     > 수평철근(배력철근)
   5  벽체 > 배면     > 수직철근(주철근)
라벨 예: 벽체-배면-수직철근(주철근)-05
```

three.js `USDLoader`를 헤드리스 node로 돌려 `loadDesign.primPath()`가 실제로 `/RebarModel/Wall_Front_Vert_01`을 만들어내는 것도 확인했다(45/45 유일, 깊이 2).

우려했던 **`Wall_Front` ↔ `Wall_FrontRear_Shear` 접두어 충돌은 구조적으로 불가능하다.** 매칭이 접두어 비교가 아니라 번호를 뗀 토큰을 다시 이어붙인 문자열의 사전 완전일치이기 때문이다 — TS `taxonomy.ts:213` `BY_TOKEN.get(tokens.join("_"))`, Swift `RebarTaxonomy.swift:124` `rowByToken[tokens.joined(separator: "_")]`. 두 구현이 같은 규칙이다.

### 3.3 API `ar-list` 응답 모양이 바뀌었다

```jsonc
// GET /analysis/ar-list?site_id=1  (실측)
{"ar_list":[
  {"scan_id":99, "ar_id":1, "site_id":1, "ar_filename":"temp.usdz",
   "ar_type":"visuals", "source_filename":"2026-07-23 15:22:31",
   "uploaded_at":"설계모델 벽체 45가닥"},
  {"scan_id":101,"ar_id":2, "site_id":1, "ar_filename":"3e471a69…002203.usdz",
   "ar_type":"design",  "source_filename":"2026-08-18 00:22:03",
   "uploaded_at":"설계모델 벽체 45가닥"}]}
```

세 가지가 우리 DTO와 어긋난다.

| `BackendDTOs.swift:63` | 실제 |
|---|---|
| `let arID: String` | `"ar_id": 2` — 정수 |
| `let scanID: String` | `"scan_id": 101` — 정수 |
| `case uploadAt = "upload_at"` | 키가 `uploaded_at` |

게다가 **필드 내용이 서로 밀려 있다** — `source_filename` 자리에 타임스탬프가, `uploaded_at` 자리에 remark가 들어 있다. DB 원본(`LH.ar_result`)에는 `upload_at`과 `remark`가 정상적으로 따로 있으므로 API의 SELECT 매핑 문제다.

`BackendClient.swift:77`은 옵션 없는 `try JSONDecoder().decode(...)`라 관용 처리가 없다. → **모델 목록이 통째로 0건이 되고 "모델을 불러오지 못했습니다"만 뜬다.** 설계모델은커녕 기존 모델에도 도달할 수 없다.

`ar_id`가 DB에서는 uuid(`c3373e1be…`)인데 API는 정수 2를 준다. uuid로 `usdz`를 부르면 500이다. **앱이 쓰는 신원은 API가 주는 정수 쪽이다.**

### 3.4 필터가 아무것도 숨기지 못한다

세 지점이 맞물려 있다.

1. `RebarTaxonomy.swift:287` — `buildTree`가 경로를 내려가며 **조상마다** `child.add(paths: node.paths)`를 한다. 그래서 `벽체` 노드가 45개 경로를 전부 들고 있다.
2. `RebarTaxonomy.swift:323` — `visiblePaths`가 체크된 **모든** 노드의 `paths`를 합집합한다.
3. `RebarTreePad.swift:109` — 토글은 자기 서브트리만 건드린다(`checked.subtract(subtreeValues)`). 조상은 체크된 채 남는다.

→ `벽체 > 전면 > 수직철근`을 꺼도 조상 `벽체`가 45개를 되살려 **아무것도 안 숨겨진다.**

유일한 최상위 노드 `벽체`를 끄면? `ModelAnchorController.swift:226`의 `applyVisibility`는 **켜진** 엔티티만 센다. 전부 숨기면 `matched == 0`이고, `PlacementViewModel.swift:157`이 그걸 조인 실패로 오인해 `checkedRebarNodes = all`로 원복한다. `didSet`이 재진입해 전부 켜진다.

**이 모델에서 철근을 숨길 수 있는 체크 조합이 하나도 없다.**

대시보드가 같은 union 규칙인데도 멀쩡한 이유는 Mantine `useTree`가 체크 상태에 잎만 저장하기 때문이다. Swift 포트에는 그 정규화가 없다.

### 3.5 트리 형제 순서가 비결정적이다

`buildTree`는 `for (_, node) in t.byPath`로 **Swift Dictionary**를 순회한다. 순회 순서는 명세되지 않고 실행마다 달라진다. 즉 앱을 다시 켤 때마다 트리의 면·기능 순서가 바뀐다. 기능 오류는 아니지만 현장 도구로서 나쁘다.

### 3.6 캐시가 갱신되지 않는다

`ModelFileStore.swift:21`의 캐시 키는 `ar_id + versionStamp(model)`이고 `versionStamp`는 `model.uploadAt`에서 구두점만 뗀 값이다(`:68-72`). 주석은 "re-uploaded model re-downloads"가 의도라고 밝히지만, `uploaded_at`에 실제로 담기는 값은 재업로드에도 안 변하는 remark 문자열이다. `ensureUSDZ`는 파일이 있으면 조기 반환하고 조건부 요청도 안 보낸다. → **같은 `ar_id`로 모델이 갱신돼도 앱은 옛 파일을 영원히 쓴다.**

### 3.7 확인하지 못한 것 (기기 검증 대상)

**RealityKit이 USD prim 이름을 `Entity.name`으로 보존하는지는 이 저장소 코드로 확인할 수 없다.** `ModelAnchorController.swift:233`의 `dumpEntityTree` 주석이 스스로 인정하고 있다. 보존되지 않으면 45개 잎이 전부 `parsePrimName`에서 nil → 해석률 0 < 0.6 → `fromPrimNames`가 nil → 평면 폴백("분류 없음 (45)") 한 덩어리가 된다. 이 스펙의 모든 분류 동작이 이 미검증 가정 위에 서 있다.

같은 등급으로, `isEnabled = false`가 RealityKit `hitTest`에서 실제로 제외되는지도 코드로는 확인 불가다(측정 레티클이 숨긴 철근에 스냅되는지).

---

## 4. 설계 — A. 모델 목록 디코딩 복구

### 4.1 원칙

지금 구조의 진짜 문제는 타입 세 개가 틀린 것이 아니라 **키 하나가 사라졌다고 목록이 통째로 죽는다**는 것이다. 상대사 API는 앞으로도 바뀐다. 그러니 필수 필드와 부가 필드를 나눈다.

- **필수**: `ar_id`, `site_id`, `ar_filename`, `ar_type` — 없으면 그 항목을 못 쓴다
- **부가**: 타임스탬프·설명 — 없으면 화면이 비는 정도로 끝나야 한다

### 4.2 `ARModel`

```swift
struct ARModel: Decodable, Identifiable, Hashable {
    let scanID: String          // Int·String 양쪽 수용
    let arID: String            // 같음. id 로 쓴다
    let siteID: Int
    let arFilename: String
    let arType: String
    /// 업로드 시각. 서버가 이 값을 어느 키에 넣는지 바꾼 전례가 있어 형식으로 판정한다(§4.3)
    let uploadAt: String?
    /// 타임스탬프가 아닌 나머지 설명 문자열(remark 또는 원본 파일명)
    let note: String?
}
```

`uploadAt`·`note`가 옵셔널이 된 것이 요점이다.

### 4.3 디코딩 규칙

```
scanID / arID : String 으로 시도 → 실패하면 Int 로 읽어 String(...) 변환
uploadAt      : ["uploaded_at", "upload_at", "source_filename"] 중
                ^\d{4}-\d{2}-\d{2} 에 맞는 첫 값. 없으면 nil
note          : 같은 후보 중 타임스탬프가 아닌 첫 값. 없으면 nil
```

세 키를 다 보는 이유는 **BriconLab이 밀린 매핑을 고쳐도 우리가 안 깨지게** 하기 위해서다. 지금은 `source_filename`에서 타임스탬프가 나오고, 고쳐지면 `upload_at`에서 나온다. 어느 쪽이든 동작한다.

`ar_type`은 표시명으로 옮긴다:

```swift
var typeLabel: String {
    switch arType.lowercased() {
    case "design":            return "설계모델"
    case "visual", "visuals": return "스캔모델"
    default:                  return arType
    }
}
```

`SiteModelListView`는 설계모델을 목록 위로 정렬하고 `model.typeLabel` / `model.uploadAt ?? model.note ?? ""`를 표시한다.

### 4.4 캐시 키

```swift
private func versionStamp(_ model: ARModel) -> String {
    (model.uploadAt ?? model.arFilename)
        .replacingOccurrences(of: " ", with: "_")
        .replacingOccurrences(of: ":", with: "")
        .replacingOccurrences(of: "-", with: "")
}
```

`uploadAt`이 진짜 타임스탬프가 되므로 §3.6이 풀린다. nil 폴백으로 `arFilename`을 쓰는 근거: 실측 파일명이 `3e471a69bafe402084378cd0cf6dd9f1_002203.usdz`로 해시+시각을 담고 있어 재업로드마다 바뀐다.

---

## 5. 설계 — B. 필터가 실제로 숨기게 한다

### 5.1 체크 상태는 잎만 담는다

`checkedRebarNodes: Set<String>`에 **잎(정규화된 prim 경로)만** 들어간다. 조상 노드 value는 절대 들어가지 않는다. 조상 체크박스는 자손에서 파생한다.

`visiblePaths`를 잎으로 한정하는 것이 최소 수정이다:

```swift
/// 체크된 **잎** → 보여야 할 엔티티 경로 집합.
/// 조상 노드는 자손 경로를 중복 보유하므로 여기서 절대 세지 않는다 — 그게 필터가
/// 아무것도 못 숨기던 원인이었다(§3.4).
static func visiblePaths(_ nodes: [TreeNode], checked: Set<String>) -> Set<String> {
    var out: Set<String> = []
    func walk(_ ns: [TreeNode]) {
        for n in ns {
            if n.children.isEmpty {
                if checked.contains(n.value) { out.formUnion(n.paths) }
            } else {
                walk(n.children)
            }
        }
    }
    walk(nodes)
    return out
}
```

**잎의 `value`가 아니라 `paths`를 합치는 것이 중요하다.** 잎 value는 `stripComponentIndex`를 거친 값인데 `applyVisibility`가 비교하는 id는 `key` / `key#1` 형태다. `paths`를 써야 한 prim이 연결요소 여럿으로 쪼개진 경우도 맞는다.

`allValues`(전 노드) 대신 `leafValues`를 추가하고, 초기 상태·"전체 선택"·`checked == all` 판정에 그것을 쓴다:

```swift
/// 트리의 잎 value 만 — 체크 상태의 신원 집합.
static func leafValues(_ nodes: [TreeNode]) -> Set<String>
```

`allValues`는 호출부가 사라지므로 삭제한다.

### 5.2 3상태 체크박스

`RebarTreeRow`:

```swift
enum CheckState { case on, off, mixed }

private var leafValues: Set<String>   // 이 서브트리의 잎 value 만
private var state: CheckState {
    let on = leafValues.intersection(checked).count
    if on == 0 { return .off }
    return on == leafValues.count ? .on : .mixed
}
// 토글: .on 이면 subtract, 아니면 formUnion — 대상은 항상 leafValues
```

아이콘: `.on` → `checkmark.square.fill`, `.mixed` → `minus.square.fill`, `.off` → `square`.
클릭 대상 최소 32pt 규칙(`docs/design-system.md` §7)은 그대로 유지한다.

### 5.3 조인 실패 판정을 필터에서 떼어낸다

`PlacementViewModel.swift:157`의 `if matched == 0 && visible != nil { checkedRebarNodes = all }`을 **삭제한다.** "사용자가 전부 숨겼다"와 "조인이 실패했다"를 같은 신호로 읽던 것이 원인이다.

대신 트리를 만들 때 한 번만 판정한다:

```swift
/// 모델에서 찾은 메시 노드 수. 0이면 RealityKit 이 이름 있는 노드를 안 줬다는 뜻이다(§3.7).
@Published private(set) var rebarNodeCount: Int = 0
```

`rebuildRebarTree`에서 `rebarNodeCount = paths.count`로 채운다. `RebarTreePad`의 `matchCount` 파라미터는 `nodeCount`로 바꾸고, 경고 문구도 실제 실패 모드에 맞춘다:

- `nodeCount == 0` → 「모델에서 철근 노드를 찾지 못했습니다」(빨강)
- `source != .sidecar` → 기존 배지 그대로 (`Source.notice`, 대시보드와 같은 문자열)

`applyVisibility`의 반환값은 진단 로그용으로만 남긴다.

### 5.4 트리 순서를 결정적으로 만든다

`Node`에 `order: Int`를 추가한다 — `wallTaxonomy`에서의 행 인덱스, 표에 없으면 `Int.max`.
`buildTree`는 `t.byPath.values`를 `(order, no ?? 0, 잎 value)` 순으로 정렬한 뒤 순회한다.

결과는 분류표 순서다: 전면 → 배면 → 전면-배면. §3.5가 풀린다.

---

## 6. 설계 — C. 부위순 / 종류순 축 전환

### 6.1 분류표에 `kind`·`role` 컬럼을 추가한다

괄호를 떼면 나오는 값이지만 **표에 명시한다.** 한글 라벨에 정규식을 돌리는 건 깨지기 쉽고, 분류표가 단일 진실이어야 한다.

| 토큰 | 기능 (분류표 원문) | `kind` | `role` |
|---|---|---|---|
| `Wall_Front_Vert` | 수직철근 | 수직철근 | — |
| `Wall_Front_Horiz` | 수평철근(배력철근) | 수평철근 | 배력철근 |
| `Wall_Rear_Vert` | 수직철근(주철근) | 수직철근 | 주철근 |
| `Wall_Rear_Horiz` | 수평철근(배력철근) | 수평철근 | 배력철근 |
| `Wall_FrontRear_Shear` | 간격재(전단철근) | 간격재 | 전단철근 |
| `Wall_Top_Reinf` | 보강철근 | 보강철근 | — |
| `Base_Upper_Trans` | 횡방향철근(주철근) | 횡방향철근 | 주철근 |
| `Base_Upper_Long` | 종방향철근(배력철근) | 종방향철근 | 배력철근 |
| `Base_Lower_Trans` | 횡방향철근 | 횡방향철근 | — |
| `Base_Lower_Long` | 종방향철근(배력철근) | 종방향철근 | 배력철근 |
| `Base_UpperLower_Shear` | 간격재(전단철근) | 간격재 | 전단철근 |
| `WallBase_Haunch` | 보강철근(헌치철근) | 보강철근 | 헌치철근 |

`fn`(기능 원문)은 그대로 둔다 — 부위순 트리와 잎 라벨이 계속 쓴다.

**TS `taxonomy.ts`의 `WALL_TAXONOMY`에도 같은 두 컬럼을 추가한다.** 대시보드 화면은 건드리지 않는다. 분류표는 두 구현의 단일 진실이므로 여기서 갈라놓으면 나중에 비싸다.

### 6.2 두 축

```swift
enum Axis: String { case member, kind }   // 부위순 / 종류순
static func buildTree(_ t: Taxonomy, axis: Axis) -> [TreeNode]
```

- **부위순** `[부재, 면?, 기능]` — 현행 `rowPath` 그대로
- **종류순** `[종류라벨, 위치라벨]` — 2단

### 6.3 종류순 라벨 규칙

역할명을 어디에 붙일지는 형제 맥락에 달렸다. 규칙 한 줄:

> **한 종류 안에 역할이 하나뿐이면 종류 노드에 붙이고, 갈리면 자식에 붙인다.**

```
roles(kind) = 그 kind 를 갖는 노드들의 role 집합 (nil 포함)

종류 노드 라벨 = roles.count == 1 && 유일 role != nil  ?  "\(kind)(\(role))"  :  kind
위치 노드 라벨 = roles.count >  1 && 이 행의 role != nil ?  "\(위치)(\(role))" :  위치
위치           = face ?? member
```

실측 모델에 적용하면:

```
수직철근 (14)               ← roles = {nil, 주철근} → 2개 → 종류엔 안 붙임
  ├ 전면 (9)
  └ 배면(주철근) (5)         ← 갈리므로 자식에 붙임
수평철근(배력철근) (18)      ← roles = {배력철근} → 1개 → 종류에 붙임
  ├ 전면 (9)
  └ 배면 (9)
간격재(전단철근) (13)
  └ 전면-배면 (13)
```

승인 시 보여드린 프리뷰는 `수평철근 (18)` / `간격재 (13)`이었다. 위 규칙은 거기에 역할을 붙여 `수평철근(배력철근)` / `간격재(전단철근)`으로 만든다 — **의도한 개선이다.** 정보가 늘고 분류표 원문에 더 가까우며, 잃는 것이 없다.

### 6.4 `Node`가 나르는 것

```swift
struct Node: Equatable {
    var path: [String]        // 부위순 경로 (현행)
    var kindPath: [String]?   // 종류순 경로. 표에 없는 노드는 nil
    var label: String
    var no: Int?
    var order: Int            // 분류표 행 인덱스. 표 밖은 Int.max (§5.4)
    var paths: [String]
}
```

- `fromPrimNames` — 매칭된 `WallRow`에서 `kindPath`·`order`를 채운다
- `fromSidecar` — 사이드카의 `path` 배열이 어느 행의 `rowPath(row)`와 **원소 단위로 같으면** 그 행에서 채우고, 아니면 `kindPath = nil` / `order = Int.max`
- `kindPath == nil`인 노드는 종류순 트리에서 「분류 없음」 아래로 간다 (부위순에서는 그대로 보인다)

### 6.5 축 전환 시 체크가 유지된다

**잎 value는 축과 무관하다** — `normalizePrimPath(stripComponentIndex(paths.first))`로만 정해지고 경로를 안 쓴다. 그래서 §5.1의 "체크 상태 = 잎 집합"만 지키면 축 전환에서 체크가 저절로 살아남는다. 별도 매핑이 필요 없다.

이것이 §5의 수정을 먼저 하는 이유다. 축 전환은 그 위에서 거의 공짜다.

### 6.6 UI

`RebarTreePad` 헤더에 세그먼티드 컨트롤:

```swift
Picker("", selection: $axis) {
    Text("부위순").tag(RebarTaxonomy.Axis.member)
    Text("종류순").tag(RebarTaxonomy.Axis.kind)
}
.pickerStyle(.segmented)
```

상태는 `PlacementViewModel.rebarAxis`에 둔다 — 시트를 닫았다 열어도 유지되어야 하기 때문. `rebarAxis`가 바뀌면 `rebarTree = RebarTaxonomy.buildTree(taxonomy, axis:)`만 다시 만든다(재분류 없음). 그래서 `Taxonomy`를 뷰모델이 보관해야 한다:

```swift
@Published private(set) var rebarTaxonomy: RebarTaxonomy.Taxonomy?
@Published var rebarAxis: RebarTaxonomy.Axis = .member { didSet { rebuildTreeOnly() } }
```

색은 계속 쓰지 않는다 — 체크박스 + 텍스트만(`docs/design-system.md:213`).

---

## 7. 테스트

### 7.1 타겟 신설

Swift 테스트 타겟이 **하나도 없다.** 이번에 발견한 결함 3건(union, matched==0, Dictionary 순서)이 전부 ARKit 없이 검증 가능한 순수 로직이다.

`project.yml`에 호스트 없는 유닛 테스트 번들을 추가한다. 앱을 빌드하지 않으므로 LiveKit도 안 끌어온다:

```yaml
  LHRebarARTests:
    type: bundle.unit-test
    platform: iOS
    deploymentTarget: "17.0"
    sources:
      - path: LHRebarAR/Model/RebarTaxonomy.swift
      - path: LHRebarAR/Backend/RebarMetaFile.swift
      - path: LHRebarARTests
```

두 소스 파일 모두 `import Foundation`뿐이라 이 구성이 성립한다(확인함). `LHRebarARLH` 타겟에 `scheme.testTargets: [LHRebarARTests]`를 달아 스킴에서 돌게 한다.

### 7.2 케이스

픽스처는 **오늘 실측한 45 prim 그대로**다.

| # | 무엇 | 기대 |
|---|---|---|
| 1 | 45개 분류 | `unmatched` 0, source `.primName`, 5개 경로에 13/9/9/9/5 |
| 2 | 접두어 충돌 | `Wall_FrontRear_Shear_01` → `[벽체, 전면-배면, 간격재(전단철근)]` |
| 3 | **부위순 트리 순서 결정성** | 같은 입력을 100번 넣어 형제 순서가 매번 동일하고 분류표 순서(전면→배면→전면-배면) |
| 4 | **잎 하나 해제** | `visiblePaths`가 44개 (지금은 45 — 회귀 재현 테스트) |
| 5 | **중간 노드 해제** | `벽체/전면/수직철근`의 잎 9개를 빼면 36개 |
| 6 | **전부 해제** | 빈 집합. 자동 원복 없음 |
| 7 | 3상태 | 9개 중 4개만 체크된 노드가 `.mixed` |
| 8 | 종류순 트리 | `수직철근(14) > 전면(9) / 배면(주철근)(5)`, `수평철근(배력철근)(18)`, `간격재(전단철근)(13)` |
| 9 | **축 전환에서 체크 유지** | 부위순에서 9개 해제 → 종류순으로 바꿔도 `visiblePaths` 36개 |
| 10 | `kindPath` nil | 표 밖 이름은 종류순에서 「분류 없음」, 부위순에선 그대로 |
| 11 | `ARModel` 디코딩 | 실측 site 1 `ar-list` JSON 원문 그대로 → 2건 디코딩. **두 번째 항목**이 `arID == "2"`, `scanID == "101"`, `arType == "design"`, `uploadAt == "2026-08-18 00:22:03"`, `note == "설계모델 벽체 45가닥"`, `typeLabel == "설계모델"` |
| 12 | 디코딩 관용성 | `uploaded_at`·`upload_at`·`source_filename` 중 무엇이 타임스탬프여도 통과. 셋 다 없으면 `uploadAt == nil`이되 항목은 살아남음 |
| 13 | 캐시 키 | `uploadAt` nil일 때 `arFilename` 폴백 |

4·5·6·9가 이번 회귀의 재현 테스트다. **먼저 실패시키고 나서 고친다.**

### 7.3 CI

`.github/workflows/ios-testflight.yml`에 xcodegen 다음, archive 앞에 단계를 넣는다:

```yaml
- name: Unit tests
  run: |
    # 러너 이미지마다 있는 기기가 달라 이름을 하드코딩하지 않는다.
    # 사용 가능한 첫 iPhone 시뮬레이터의 UDID 를 골라 쓴다.
    UDID=$(xcrun simctl list devices available -j \
      | python3 -c 'import json,sys
d=json.load(sys.stdin)["devices"]
print(next(x["udid"] for v in d.values() for x in v if x["name"].startswith("iPhone")))')
    echo "시뮬레이터: $UDID"
    xcodebuild test -project LHRebarAR.xcodeproj \
      -scheme LHRebarARLH \
      -destination "id=$UDID" \
      -only-testing:LHRebarARTests
```

매트릭스 두 잡 모두에서 돌지만 같은 소스라 무해하다. `xcpretty`는 쓰지 않는다 — 파이프가 종료코드를 삼켜 실패가 초록으로 지나가는 사고가 잦다.

### 7.4 대시보드 회귀 테스트

TS 쪽은 `kind`·`role` 컬럼 추가뿐이지만, 실측 45 prim 픽스처를 `taxonomy.test.ts`에 넣는다. 이미 스크래치패드에서 통과를 확인한 그 테스트다. 기존 205개는 회귀 없이 통과해야 한다.

---

## 8. 검증

### 8.1 이번 작업에서 증명할 수 있는 것

- `npx vitest run` — 대시보드 전체 회귀 + 실측 픽스처
- `xcodebuild test -only-testing:LHRebarARTests` — Swift 순수 로직 13케이스
- CI 두 앱 컴파일 (기존)

### 8.2 기기에서만 증명되는 것 (§3.7)

`docs/ar-app-split-device-check.md`에 항목을 추가한다.

| # | 확인 | 실패 시 |
|---|---|---|
| D1 | `dumpEntityTree` 경로 집합이 45개 prim 이름을 포함하는가 | RealityKit이 prim 이름을 안 준다 → 평면 폴백. 사이드카/다른 신원 축이 필요 |
| D2 | 체크 해제한 철근이 화면에서 사라지는가 | §5 수정이 안 먹은 것 |
| D3 | 숨긴 철근에 측정 레티클이 스냅되지 않는가 | `isEnabled=false`가 hitTest를 안 막는다 → `CollisionComponent` 제거/복원으로 전환 |
| D4 | 축 전환 시 체크가 유지되는가 | §6.5 전제가 깨진 것 |
| D5 | 설계모델이 목록에 「설계모델」로 뜨고 열리는가 | §4 수정이 안 먹은 것 |

**기기 검증 전에는 "동작한다"고 보고하지 않는다.** 단위 테스트가 증명하는 것은 로직이지 RealityKit 동작이 아니다.

---

## 9. 범위 밖 — 남기는 것

| 항목 | 상태 |
|---|---|
| **대시보드 프로덕션 크래시** | `SiteAnalysis.tsx:63`·`SiteModels.tsx:101`이 사라진 `upload_at`을 무가드로 읽어 렌더 중 TypeError. error boundary가 없어 화면 전체가 날아간다. 브라우저로 확인함. 추가로 두 파일이 설계모델을 `ar_type === "built-in"`으로 찾는데 실제 값은 `"design"`. **사용자 결정으로 별도 작업** |
| 머티리얼 색 충돌 | 설계 USDZ에 전면 주황/배면 파랑/간격재 초록이 박혀 있다. 판정 6색·컨투어 5색과 의미가 충돌할 수 있다 |
| 사이드카 경로 | `PlacementViewModel.rebarMeta`에 값을 넣는 코드가 없어 죽은 코드다. 지금 모델은 prim 이름이 분류표와 정확히 일치해 사이드카 없이 동작하므로 그대로 둔다. `fromSidecar`가 전체 경로 완전일치라 RealityKit 루트 노드 이름이 한 세그먼트 끼면 조인율 0%가 되는 위험도 같이 잠들어 있다 |
| API 필드 밀림 | BriconLab 쪽 수정 사항. §4.3이 어느 쪽이든 견디게 만들었으므로 블로커는 아니다 |
| `ar_id` uuid ↔ 정수 불일치 | DB와 API가 다른 신원을 쓴다. 앱은 API 쪽을 쓰므로 이번 범위에서는 문제없다 |
| 두 현장 모델이 동일 파일 | 아직 현장별 모델이 아니다. BriconLab에 확인 필요 |

---

## 10. 파일 영향 범위

| 파일 | 변경 |
|---|---|
| `LHRebarAR/Backend/BackendDTOs.swift` | `ARModel` 관용 디코딩 + `typeLabel` (§4) |
| `LHRebarAR/Backend/ModelFileStore.swift` | `versionStamp` 폴백 (§4.4) |
| `LHRebarAR/UI/Screens/SiteModelListView.swift` | `typeLabel` 표시 + 설계모델 우선 정렬 |
| `LHRebarAR/UI/Screens/ARModelDetailView.swift` | 같은 표시 수정 |
| `LHRebarAR/Model/RebarTaxonomy.swift` | `kind`/`role`/`order`/`kindPath`, `leafValues`, `visiblePaths` 잎 한정, `buildTree(axis:)`, 정렬 (§5·§6) |
| `LHRebarAR/UI/Components/RebarTreePad.swift` | 3상태 체크박스, 축 Picker, `nodeCount` (§5.2·§6.6) |
| `LHRebarAR/Placement/PlacementViewModel.swift` | `rebarTaxonomy`/`rebarAxis`/`rebarNodeCount`, 원복 로직 삭제 (§5.3·§6.6) |
| `LHRebarARTests/` | 신설 (§7) |
| `project.yml` | 테스트 타겟 + 스킴 (§7.1) |
| `.github/workflows/ios-testflight.yml` | 테스트 단계 (§7.3) |
| `office-dashboard/src/lib/analysis/taxonomy.ts` | `kind`/`role` 컬럼만 (§6.1) |
| `office-dashboard/src/lib/analysis/taxonomy.test.ts` | 실측 45 prim 픽스처 (§7.4) |
| `CLAUDE.md` | 실측 사실 + 새 고차 반영 |

**새 Swift 파일을 추가하면 `xcodegen generate`가 필수다**(고차 #10). 이번엔 `project.yml`도 바뀌므로 반드시 재생성한다.
