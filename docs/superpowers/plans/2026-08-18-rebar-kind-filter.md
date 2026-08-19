# 철근 종류축 필터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LH 전용 앱에서 실제 설계모델(45 prim)의 철근을 부위순/종류순 두 축으로 트리 선택해 실제로 숨기고 보이게 한다.

**Architecture:** 체크 상태를 **잎(정규화된 prim 경로)만** 담게 줄이는 것이 핵심이다. 지금은 조상 노드도 체크 집합에 들어가고 조상이 자손 경로를 중복 보유해 필터가 아무것도 못 숨긴다. 잎만 담으면 필터가 고쳐지고, 잎 value가 축과 무관하므로 부위순↔종류순 전환에서 체크가 저절로 유지된다. 그 앞단에서 `ar-list` 응답 모양 변경으로 죽어 있는 DTO 디코딩을 관용적으로 복구한다.

**Tech Stack:** Swift 5.9 · SwiftUI · RealityKit · XCTest(신설) · xcodegen · GitHub Actions · TypeScript/vitest(분류표 동기화만)

**Spec:** `docs/superpowers/specs/2026-08-18-rebar-kind-filter-design.md`

## Global Constraints

- 범위는 **LH 전용 앱**(`kr.lh.rebar-lh`, 타겟 `LHRebarARLH`). 대시보드 프로덕션 크래시는 **범위 밖**(사용자 결정) — `SiteAnalysis.tsx`·`SiteModels.tsx`를 고치지 않는다. 유일한 예외는 Task 7의 분류표 컬럼 추가다.
- 앱별 기능 차이는 **`AppFeatures.swift` 한 곳에만** 둔다. `#if LH_ONLY`를 화면 코드에 뿌리지 않는다(고차 #13).
- **새 Swift 파일 추가·`project.yml` 변경 시 `xcodegen generate` 필수**(고차 #10).
- 트리는 **색을 쓰지 않는다** — 체크박스 + 텍스트만. 판정 6색·컨투어 5색 재사용 금지(`docs/design-system.md:213`). 클릭 대상 최소 32pt(:202).
- 출처 배지 문구는 **대시보드와 같은 문자열**을 쓴다: `.primName` → `모델 이름 규칙으로 추정 — 도면 확인 필요`, `.geometry` → `형상 자동 분류 — 부위 구분 아님`. `RebarTaxonomy.Source.notice`가 이미 갖고 있으니 건드리지 않는다.
- 대시보드 기존 테스트 **205개**가 회귀 없이 통과해야 한다. 실행: `cd office-dashboard && npx vitest run`
- 테스트 타겟에 넣는 소스는 **`import Foundation`만 하는 파일로 제한한다**. ARKit/RealityKit/SwiftUI가 딸려 오면 호스트 없는 번들이 깨진다.
- **기기 검증 전에 "동작한다"고 보고하지 않는다.** 단위 테스트가 증명하는 것은 로직이지 RealityKit 동작이 아니다(스펙 §3.7·§8.2).
- 브랜치는 `feat/rebar-kind-filter`. 커밋 메시지 말미에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `LHRebarARTests/DesignModelFixture.swift` | 신설 — 실측 45 prim 경로 + 실측 `ar-list` JSON | T1 |
| `LHRebarARTests/RebarTaxonomyTests.swift` | 신설 — 분류·순서 | T1·T3 |
| `LHRebarARTests/RebarFilterTests.swift` | 신설 — 가시성·체크상태 | T4 |
| `LHRebarARTests/RebarKindAxisTests.swift` | 신설 — 종류축 | T5 |
| `LHRebarARTests/ARModelDecodingTests.swift` | 신설 — DTO 관용 디코딩 | T2 |
| `project.yml` | 테스트 타겟 + 두 앱 스킴에 testTargets | T1 |
| `LHRebarAR/Backend/BackendDTOs.swift` | `ARModel` 관용 디코딩 · `typeLabel` · `versionStamp` | T2 |
| `LHRebarAR/Backend/ModelFileStore.swift` | 캐시 키를 `model.versionStamp`로 위임 | T2 |
| `LHRebarAR/UI/Screens/SiteModelListView.swift` | 표시명 + 설계모델 우선 정렬 | T2 |
| `LHRebarAR/UI/Screens/ARModelDetailView.swift` | 표시명 | T2 |
| `LHRebarAR/Model/RebarTaxonomy.swift` | `order`·`leafValues`·`checkState`·잎 한정 `visiblePaths`·`kind`/`role`·`buildTree(axis:)` | T3·T4·T5 |
| `LHRebarAR/UI/Components/RebarTreePad.swift` | 3상태 체크박스 · 축 Picker · `nodeCount` | T4·T6 |
| `LHRebarAR/Placement/PlacementViewModel.swift` | `rebarTaxonomy`/`rebarAxis`/`rebarNodeCount`, 원복 로직 삭제 | T4·T6 |
| `office-dashboard/src/lib/analysis/taxonomy.ts` | `kind`/`role` 컬럼만 | T7 |
| `office-dashboard/src/lib/analysis/taxonomy.test.ts` | 실측 45 prim 픽스처 | T7 |
| `.github/workflows/ios-testflight.yml` | 테스트 단계 | T8 |
| `docs/ar-app-split-device-check.md`, `CLAUDE.md` | 기기 검증 항목 · 실측 사실 | T8 |

---

## Task 1: 테스트 타겟 + 실측 픽스처 (현행 분류 고정)

목적은 **바꾸기 전에 이미 맞는 것을 못으로 박는 것**이다. 이 태스크의 테스트는 지금 코드에서 그대로 통과해야 한다. 통과하지 않으면 스펙 §3.2의 측정이 틀렸다는 뜻이니 멈추고 보고한다.

**Files:**
- Create: `LHRebarARTests/DesignModelFixture.swift`
- Create: `LHRebarARTests/RebarTaxonomyTests.swift`
- Modify: `project.yml`

**Interfaces:**
- Consumes: `RebarTaxonomy.fromPrimNames(entityPaths:) -> Taxonomy?`, `RebarTaxonomy.parsePrimName(_:) -> Parsed?`, `Taxonomy { root, byPath: [String: Node], unmatched: [String], source: Source }`, `Node { path, label, no, paths }`
- Produces: `DesignModelFixture.paths: [String]` (45개), `DesignModelFixture.arListJSON: Data` (T2가 쓴다)

- [ ] **Step 1: `project.yml`에 테스트 타겟 추가**

`targets:` 아래, `LHRebarARLH:` 블록이 끝난 **파일 맨 끝**에 붙인다(현재 190행). 들여쓰기는 2칸.

```yaml
  # 호스트 없는 순수 로직 테스트. 앱을 빌드하지 않으므로 LiveKit 도 안 끌어온다.
  # 여기 넣는 소스는 `import Foundation` 만 하는 파일로 제한한다 — ARKit/SwiftUI 가
  # 딸려 오면 호스트 없는 번들이 깨진다.
  LHRebarARTests:
    type: bundle.unit-test
    platform: iOS
    deploymentTarget: "17.0"
    sources:
      - path: LHRebarAR/Model/RebarTaxonomy.swift
      - path: LHRebarAR/Backend/RebarMetaFile.swift
      - path: LHRebarAR/Backend/BackendDTOs.swift
      - path: LHRebarARTests
```

그리고 **두 앱 타겟 모두**에 스킴 설정을 단다. `LHRebarAR:` 블록과 `LHRebarARLH:` 블록 각각의 `settings:` 키와 같은 들여쓰기(4칸) 위치에 넣는다:

```yaml
    scheme:
      testTargets:
        - LHRebarARTests
```

두 앱 모두에 다는 이유: CI가 `app=research`로 돌 때도 테스트가 돌아야 한다.

- [ ] **Step 2: 픽스처 작성**

`LHRebarARTests/DesignModelFixture.swift`:

```swift
// LHRebarARTests/DesignModelFixture.swift
import Foundation

/// 2026-08-18 BriconLab 이 업로드한 **실제** 설계모델에서 뜬 픽스처.
/// 합성 데이터가 아니다 — 아래 두 값은 그날 실제 응답을 그대로 옮긴 것이다.
///
///   USDZ : GET http://api.briconlab.com:50001/analysis/usdz?ar_id=2
///          model.usda / defaultPrim "RebarModel" / upAxis "Y" / metersPerUnit 1
///          doc "Design rebar model from Mock-up(2)_2.ifc (structure=wall, bars=45)"
///   목록 : GET http://api.briconlab.com:50001/analysis/ar-list?site_id=1
enum DesignModelFixture {

    /// `def Mesh` 45개의 절대 prim 경로. 파일에 나오는 순서 그대로다.
    static let paths: [String] = {
        func seq(_ token: String, _ count: Int) -> [String] {
            (1...count).map { "/RebarModel/\(token)_\(String(format: "%02d", $0))" }
        }
        return seq("Wall_FrontRear_Shear", 13)
            + seq("Wall_Front_Horiz", 9)
            + seq("Wall_Front_Vert", 9)
            + seq("Wall_Rear_Horiz", 9)
            + seq("Wall_Rear_Vert", 5)
    }()

    /// 분류표 경로별 기대 개수.
    static let expectedCounts: [String: Int] = [
        "벽체>전면-배면>간격재(전단철근)": 13,
        "벽체>전면>수평철근(배력철근)": 9,
        "벽체>전면>수직철근": 9,
        "벽체>배면>수평철근(배력철근)": 9,
        "벽체>배면>수직철근(주철근)": 5,
    ]

    /// site 1 의 `ar-list` 응답 원문. **필드가 밀려 있는 그대로**다 —
    /// source_filename 자리에 타임스탬프가, uploaded_at 자리에 remark 가 들어 있고
    /// scan_id/ar_id 가 따옴표 없는 정수다. T2 의 관용 디코딩이 이걸 견뎌야 한다.
    static let arListJSON = Data("""
    {"status":"success","message":"AR 모델 리스트를 조회했습니다.","ar_list":[
      {"scan_id":99,"ar_id":1,"site_id":1,"ar_filename":"temp.usdz",
       "ar_type":"visuals","source_filename":"2026-07-23 15:22:31",
       "uploaded_at":"설계모델 벽체 45가닥"},
      {"scan_id":101,"ar_id":2,"site_id":1,
       "ar_filename":"3e471a69bafe402084378cd0cf6dd9f1_002203.usdz",
       "ar_type":"design","source_filename":"2026-08-18 00:22:03",
       "uploaded_at":"설계모델 벽체 45가닥"}]}
    """.utf8)
}
```

- [ ] **Step 3: 분류 테스트 작성**

`LHRebarARTests/RebarTaxonomyTests.swift`:

```swift
// LHRebarARTests/RebarTaxonomyTests.swift
import XCTest

final class RebarTaxonomyTests: XCTestCase {

    func testClassifiesAll45Bars() throws {
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
        XCTAssertEqual(t.source, .primName)
        XCTAssertEqual(t.unmatched, [])
        XCTAssertEqual(t.byPath.count, 45)

        var counts: [String: Int] = [:]
        for (_, node) in t.byPath {
            counts[node.path.joined(separator: ">"), default: 0] += 1
        }
        XCTAssertEqual(counts, DesignModelFixture.expectedCounts)
    }

    /// `Wall_Front` 은 `Wall_FrontRear_Shear` 의 접두어다. 접두어 비교로 매칭하면
    /// 간격재 13개가 전면 철근으로 샌다. 완전일치 조회라 안 새는 것을 못박는다.
    func testShearIsNotMisreadAsFrontFace() {
        let shear = RebarTaxonomy.parsePrimName("Wall_FrontRear_Shear_01")
        XCTAssertEqual(shear?.path, ["벽체", "전면-배면", "간격재(전단철근)"])
        XCTAssertEqual(shear?.no, 1)

        let front = RebarTaxonomy.parsePrimName("Wall_Front_Vert_01")
        XCTAssertEqual(front?.path, ["벽체", "전면", "수직철근"])
    }

    /// 두 자리 zero-pad 번호가 정수로 읽히고 라벨에서 다시 두 자리로 돌아온다.
    func testZeroPaddedNumbers() throws {
        let p = try XCTUnwrap(RebarTaxonomy.parsePrimName("Wall_Rear_Vert_05"))
        XCTAssertEqual(p.no, 5)
        XCTAssertEqual(RebarTaxonomy.composeLabel(path: p.path, no: p.no),
                       "벽체-배면-수직철근(주철근)-05")
    }

    /// 정규화가 이 모델의 경로를 건드리지 않는다(wrapper 세그먼트와 충돌 없음).
    func testNormalizeLeavesRealPathsIntact() {
        XCTAssertEqual(RebarTaxonomy.normalizePrimPath("/RebarModel/Wall_Front_Vert_01"),
                       "/RebarModel/Wall_Front_Vert_01")
        XCTAssertEqual(RebarTaxonomy.normalizePrimPath("/modelEntity/RebarModel/Wall_Front_Vert_01"),
                       "/RebarModel/Wall_Front_Vert_01")
    }
}
```

- [ ] **Step 4: 프로젝트 재생성**

Run: `xcodegen generate`
Expected: 오류 없이 `LHRebarAR.xcodeproj` 갱신. `LHRebarARTests` 타겟이 생긴다.

macOS가 없는 환경이면 여기서 멈추고 **CI로 확인한다**(Task 8에서 단계를 넣기 전이므로, 이 태스크는 Windows에서 `project.yml` 문법 검증까지만 하고 실행 확인은 Task 8 이후로 미룬다). 그 경우 이 태스크의 Step 5는 "미실행"으로 정직하게 보고한다.

- [ ] **Step 5: 테스트 실행 — 전부 통과해야 한다**

```bash
UDID=$(xcrun simctl list devices available -j | python3 -c 'import json,sys
d=json.load(sys.stdin)["devices"]
print(next(x["udid"] for v in d.values() for x in v if x["name"].startswith("iPhone")))')
xcodebuild test -project LHRebarAR.xcodeproj -scheme LHRebarARLH \
  -destination "id=$UDID" -only-testing:LHRebarARTests
```

Expected: 4 테스트 PASS. **하나라도 실패하면 멈추고 보고한다** — 스펙의 측정이 틀렸다는 뜻이다.

- [ ] **Step 6: CI에 테스트 단계 추가**

**이 단계가 Task 1에 있는 이유:** 개발 머신이 Windows라 `xcodebuild`를 못 돌린다. CI가 유일한 검증 수단이므로 **첫 태스크에서** 물려 놓아야 이후 태스크가 빨강/초록을 실제로 확인할 수 있다.

`.github/workflows/ios-testflight.yml`의 `- name: Compile check (no signing)` **바로 앞**에 넣는다. 들여쓰기는 기존 스텝과 동일(6칸):

```yaml
      # 순수 로직이 깨졌으면 5분짜리 컴파일·아카이브 전에 알아야 한다.
      # 테스트 번들은 호스트가 없어 앱을 빌드하지 않는다(Foundation 3파일).
      - name: Unit tests
        if: ${{ github.event.inputs.app == 'both' || github.event.inputs.app == matrix.app }}
        run: |
          set -euo pipefail
          # 러너 이미지마다 있는 기기가 달라 이름을 하드코딩하지 않는다.
          UDID=$(xcrun simctl list devices available -j | python3 -c 'import json,sys
          d = json.load(sys.stdin)["devices"]
          print(next(x["udid"] for v in d.values() for x in v if x["name"].startswith("iPhone")))')
          echo "시뮬레이터: $UDID"
          xcodebuild test \
            -project LHRebarAR.xcodeproj -scheme ${{ matrix.scheme }} \
            -destination "id=$UDID" \
            -only-testing:LHRebarARTests
```

`xcpretty`로 파이프하지 않는다 — 파이프가 종료코드를 삼켜 실패가 초록으로 지나간다.

YAML 문법 확인:

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ios-testflight.yml', encoding='utf-8')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 7: 커밋**

```bash
git add project.yml LHRebarARTests .github/workflows/ios-testflight.yml
git commit -m "test: Swift 테스트 타겟 신설 + 실측 45 prim 픽스처 + CI 테스트 단계"
```

---

## Task 2: `ARModel` 관용 디코딩 (모델 목록 복구)

지금 앱은 모델 목록을 **한 건도** 못 읽는다. 이걸 먼저 고쳐야 나머지 작업의 결과를 기기에서 볼 수 있다.

**Files:**
- Create: `LHRebarARTests/ARModelDecodingTests.swift`
- Modify: `LHRebarAR/Backend/BackendDTOs.swift:62-86`
- Modify: `LHRebarAR/Backend/ModelFileStore.swift:20-22, 66-72`
- Modify: `LHRebarAR/UI/Screens/SiteModelListView.swift:14-23, 66-79`
- Modify: `LHRebarAR/UI/Screens/ARModelDetailView.swift:64-70`

**Interfaces:**
- Consumes: `DesignModelFixture.arListJSON: Data`, `ARListResponse { status, message, arList: [ARModel] }`
- Produces: `ARModel { scanID: String, arID: String, siteID: Int, arFilename: String, arType: String, uploadAt: String?, note: String?, typeLabel: String, versionStamp: String, fileExtension: String }`

- [ ] **Step 1: 실패하는 테스트 작성**

`LHRebarARTests/ARModelDecodingTests.swift`:

```swift
// LHRebarARTests/ARModelDecodingTests.swift
import XCTest

final class ARModelDecodingTests: XCTestCase {

    /// 실측 응답 원문을 그대로 먹인다. 지금 DTO 는 여기서 던진다:
    ///   ar_id/scan_id 가 정수인데 String 으로 선언돼 있고, 키가 uploaded_at 인데
    ///   upload_at 을 찾는다.
    func testDecodesRealArListResponse() throws {
        let res = try JSONDecoder().decode(ARListResponse.self, from: DesignModelFixture.arListJSON)
        XCTAssertEqual(res.arList.count, 2)

        let design = try XCTUnwrap(res.arList.first { $0.arType == "design" })
        XCTAssertEqual(design.arID, "2")
        XCTAssertEqual(design.scanID, "101")
        XCTAssertEqual(design.siteID, 1)
        XCTAssertEqual(design.arFilename, "3e471a69bafe402084378cd0cf6dd9f1_002203.usdz")
        XCTAssertEqual(design.typeLabel, "설계모델")
        // 타임스탬프는 source_filename 자리에 밀려 들어와 있다 — 키가 아니라 형식으로 찾는다
        XCTAssertEqual(design.uploadAt, "2026-08-18 00:22:03")
        XCTAssertEqual(design.note, "설계모델 벽체 45가닥")

        let scan = try XCTUnwrap(res.arList.first { $0.arID == "1" })
        XCTAssertEqual(scan.typeLabel, "스캔모델")
    }

    /// 서버가 밀림을 고쳐 upload_at 에 시각을 담아도 그대로 동작해야 한다.
    func testDecodesCorrectedFieldMapping() throws {
        let json = Data("""
        {"status":"success","ar_list":[
          {"scan_id":"101","ar_id":"2","site_id":1,"ar_filename":"m.usdz",
           "ar_type":"design","upload_at":"2026-08-18 00:22:03",
           "source_filename":"Mock-up(2)_2.usdz"}]}
        """.utf8)
        let m = try XCTUnwrap(
            JSONDecoder().decode(ARListResponse.self, from: json).arList.first)
        XCTAssertEqual(m.arID, "2")
        XCTAssertEqual(m.uploadAt, "2026-08-18 00:22:03")
        XCTAssertEqual(m.note, "Mock-up(2)_2.usdz")
    }

    /// 시각 필드가 전부 사라져도 **항목은 살아남아야 한다.** 지금처럼 목록이
    /// 통째로 0건이 되는 것이 진짜 결함이다.
    func testSurvivesMissingTimestampFields() throws {
        let json = Data("""
        {"status":"success","ar_list":[
          {"scan_id":101,"ar_id":2,"site_id":1,"ar_filename":"m.usdz","ar_type":"design"}]}
        """.utf8)
        let m = try XCTUnwrap(
            JSONDecoder().decode(ARListResponse.self, from: json).arList.first)
        XCTAssertEqual(m.arID, "2")
        XCTAssertNil(m.uploadAt)
        XCTAssertNil(m.note)
        // 캐시 키는 파일명으로 대체된다 — 파일명이 해시+시각이라 재업로드마다 바뀐다
        XCTAssertEqual(m.versionStamp, "m.usdz")
    }

    func testVersionStampStripsPunctuation() throws {
        let m = try XCTUnwrap(
            JSONDecoder().decode(ARListResponse.self, from: DesignModelFixture.arListJSON)
                .arList.first { $0.arType == "design" })
        XCTAssertEqual(m.versionStamp, "20260818_002203")
    }

    /// ar_id 가 없으면 그 항목은 못 쓴다 — 조용히 통과시키지 않는다.
    func testThrowsWhenArIdMissing() {
        let json = Data("""
        {"status":"success","ar_list":[{"site_id":1,"ar_filename":"m.usdz","ar_type":"design"}]}
        """.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ARListResponse.self, from: json))
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: 위 `xcodebuild test` 명령
Expected: `testDecodesRealArListResponse` 등이 FAIL — `typeMismatch(Swift.String…)` 또는 `keyNotFound(upload_at)`. 컴파일 자체가 안 되면(`typeLabel`/`note`/`versionStamp` 미존재) 그것도 정상적인 "빨강"이다.

- [ ] **Step 3: `ARModel` 재작성**

`BackendDTOs.swift:62-86`을 통째로 교체한다:

```swift
struct ARModel: Decodable, Identifiable, Hashable {
    let scanID: String
    let arID: String
    let siteID: Int
    let arFilename: String
    let arType: String
    /// 업로드 시각. **옵셔널인 것이 요점이다** — 이 값 하나 없다고 목록 전체가
    /// 죽던 것이 2026-08-18 장애의 원인이었다.
    let uploadAt: String?
    /// 타임스탬프가 아닌 나머지 설명(remark 또는 원본 파일명)
    let note: String?

    var id: String { arID }

    /// File extension of the server model (e.g. "usdz").
    var fileExtension: String {
        let ext = (arFilename as NSString).pathExtension
        return ext.isEmpty ? "fbx" : ext.lowercased()
    }

    /// 사용자에게 보이는 종류명. 서버 원문(`design`/`visuals`)을 그대로 띄우지 않는다.
    var typeLabel: String {
        switch arType.lowercased() {
        case "design":            return "설계모델"
        case "visual", "visuals": return "스캔모델"
        default:                  return arType
        }
    }

    /// 캐시 무효화용 버전 문자열. `uploadAt` 이 없으면 파일명으로 대신한다 —
    /// 실측 파일명이 `3e471a69…_002203.usdz` 처럼 해시+시각이라 재업로드마다 바뀐다.
    var versionStamp: String {
        (uploadAt ?? arFilename)
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: ":", with: "")
            .replacingOccurrences(of: "-", with: "")
    }

    enum CodingKeys: String, CodingKey {
        case scanID = "scan_id"
        case arID = "ar_id"
        case siteID = "site_id"
        case arFilename = "ar_filename"
        case arType = "ar_type"
        case uploadAt = "upload_at"
        case uploadedAt = "uploaded_at"
        case sourceFilename = "source_filename"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        // 서버가 id 를 문자열로 주다가 정수로 바꿨다(2026-08-18 실측). 둘 다 받는다.
        scanID = Self.flexibleString(c, .scanID) ?? ""
        guard let ar = Self.flexibleString(c, .arID) else {
            throw DecodingError.keyNotFound(CodingKeys.arID, .init(
                codingPath: c.codingPath,
                debugDescription: "ar_id 가 없습니다 — 이 항목은 모델을 특정할 수 없습니다"))
        }
        arID = ar

        // site_id 는 모델을 여는 데 안 쓴다(ar_id 로 연다). 없다고 항목을 버리지 않는다.
        siteID = (try? c.decode(Int.self, forKey: .siteID)) ?? -1
        arFilename = (try? c.decode(String.self, forKey: .arFilename)) ?? ""
        arType = (try? c.decode(String.self, forKey: .arType)) ?? ""

        // ★ 키를 믿지 않고 형식으로 고른다.
        //   2026-08-18 실측: source_filename 자리에 "2026-08-18 00:22:03" 이,
        //   uploaded_at 자리에 remark "설계모델 벽체 45가닥" 이 들어왔다(서버가 밀림).
        //   세 후보를 다 보므로 서버가 밀림을 고쳐도 우리는 안 깨진다.
        let candidates: [String] = [CodingKeys.uploadedAt, .uploadAt, .sourceFilename]
            .compactMap { try? c.decode(String.self, forKey: $0) }
        uploadAt = candidates.first(where: Self.looksLikeTimestamp)
        note = candidates.first(where: { !Self.looksLikeTimestamp($0) })
    }

    /// String 이면 그대로, Int 면 문자열로. 둘 다 아니면 nil.
    /// `decodeIfPresent` 대신 `try? decode` 를 쓰는 이유: 값이 Int 인데 String 을
    /// 요구하면 `decodeIfPresent` 는 nil 이 아니라 typeMismatch 를 던진다.
    private static func flexibleString(_ c: KeyedDecodingContainer<CodingKeys>,
                                       _ key: CodingKeys) -> String? {
        if let s = try? c.decode(String.self, forKey: key) { return s }
        if let i = try? c.decode(Int.self, forKey: key) { return String(i) }
        return nil
    }

    /// `2026-08-18 …` / `2026-08-18T…` 처럼 앞 10자가 `YYYY-MM-DD` 인가.
    private static func looksLikeTimestamp(_ s: String) -> Bool {
        let head = Array(s.prefix(10))
        guard head.count == 10 else { return false }
        return head[0...3].allSatisfy(\.isNumber) && head[4] == "-"
            && head[5...6].allSatisfy(\.isNumber) && head[7] == "-"
            && head[8...9].allSatisfy(\.isNumber)
    }
}
```

- [ ] **Step 4: `ModelFileStore`가 `versionStamp`를 위임하게 한다**

`ModelFileStore.swift:20-22`:

```swift
    func usdzURL(for model: ARModel) -> URL {
        directory.appendingPathComponent("\(model.arID)_\(model.versionStamp).usdz")
    }
```

그리고 `:66-72`의 `private func versionStamp(_:)`를 **삭제한다**. 버전 문자열은 모델의 성질이지 저장소의 성질이 아니고, 이렇게 해야 테스트 타겟이 `ModelFileStore`(→`BackendClient`→URLSession)를 끌어오지 않는다.

파일 상단 주석의 "keyed by ar_id + upload timestamp so a re-uploaded model re-downloads"도 사실에 맞게 고친다:

```swift
/// Downloads and caches converted USDZ model files under Caches/Models, keyed by
/// ar_id + `ARModel.versionStamp`. 서버가 upload_at 자리에 remark 를 넣어 보내던
/// 시기에는 이 스탬프가 상수여서 재업로드해도 옛 파일을 계속 썼다 —
/// versionStamp 가 형식으로 타임스탬프를 고르면서 해소됐다.
```

- [ ] **Step 5: 화면 표시 수정**

`SiteModelListView.swift:66-79`의 `List` 안:

```swift
            List(vm.models) { model in
                NavigationLink(value: model) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.arFilename)
                            .font(LHTypography.body)
                        HStack(spacing: LHSpacing.sm) {
                            Text(model.typeLabel)
                            if let stamp = model.uploadAt { Text(stamp) }
                        }
                        .font(LHTypography.monoCaption)
                        .foregroundStyle(LHColors.mutedInk)
                    }
                    .padding(.vertical, LHSpacing.xs)
                }
            }
```

`SiteModelListView.swift:18`의 로드에 설계모델 우선 정렬을 넣는다:

```swift
            // 설계모델을 위로. 현장에서 쓰는 건 설계모델이고 스캔 산출물은 참고다.
            models = try await client.fetchModels(siteID: site.siteID)
                .sorted { a, b in
                    let ra = a.arType.lowercased() == "design" ? 0 : 1
                    let rb = b.arType.lowercased() == "design" ? 0 : 1
                    if ra != rb { return ra < rb }
                    return (a.uploadAt ?? "") > (b.uploadAt ?? "")
                }
```

`ARModelDetailView.swift:64-70`:

```swift
            Section("모델 정보") {
                infoRow("ar_id", vm.model.arID)
                infoRow("scan_id", vm.model.scanID)
                infoRow("파일", vm.model.arFilename)
                infoRow("타입", vm.model.typeLabel)
                infoRow("업로드", vm.model.uploadAt ?? "—")
                if let note = vm.model.note { infoRow("설명", note) }
            }
```

- [ ] **Step 6: 테스트 통과 확인 + 컴파일 확인**

Run: `xcodebuild test -project LHRebarAR.xcodeproj -scheme LHRebarARLH -destination "id=$UDID" -only-testing:LHRebarARTests`
Expected: Task 1의 4개 + 이번 5개 = 9 PASS

Run: `xcodebuild build -project LHRebarAR.xcodeproj -scheme LHRebarARLH -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`
Expected: BUILD SUCCEEDED (화면 수정이 컴파일되는지)

- [ ] **Step 7: 커밋**

```bash
git add LHRebarAR/Backend LHRebarAR/UI/Screens LHRebarARTests
git commit -m "fix: ar-list 응답 변경으로 죽은 모델 목록 복구 — 키가 아니라 형식으로 타임스탬프를 고른다"
```

---

## Task 3: 트리 순서를 결정적으로 만든다

`buildTree`가 Swift Dictionary를 순회해 형제 순서가 실행마다 달라진다. 필터를 고치기 전에 순서를 못박아야 이후 테스트가 안정적이다.

**Files:**
- Modify: `LHRebarAR/Model/RebarTaxonomy.swift` (`Node`, `rowIndexByToken`, `Parsed`, `parsePrimName`, `fromPrimNames`, `fromSidecar`, `buildTree`)
- Modify: `LHRebarARTests/RebarTaxonomyTests.swift`

**Interfaces:**
- Produces: `Node.order: Int`, `Parsed.token: String?`, `RebarTaxonomy.rowIndexByToken: [String: Int]`

- [ ] **Step 1: 실패하는 테스트 추가**

`RebarTaxonomyTests.swift`에 덧붙인다:

```swift
    /// Swift Dictionary 순회 순서는 명세되지 않고 새로 만들 때마다 달라진다.
    /// 매번 새 Taxonomy 를 만들어 트리 모양이 같은지 본다.
    func testTreeOrderIsDeterministic() throws {
        func shape(_ ns: [RebarTaxonomy.TreeNode]) -> [String] {
            ns.flatMap { [$0.label] + shape($0.children) }
        }
        let base = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
        let expected = shape(RebarTaxonomy.buildTree(base))
        for i in 0..<50 {
            let again = try XCTUnwrap(
                RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
            XCTAssertEqual(shape(RebarTaxonomy.buildTree(again)), expected, "반복 \(i)")
        }
    }

    /// 형제 순서는 발주처 분류표 행 순서를 따른다 — 전면 → 배면 → 전면-배면.
    func testTreeOrderFollowsOfficialTable() throws {
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
        let tree = RebarTaxonomy.buildTree(t)
        XCTAssertEqual(tree.map(\.label), ["벽체"])
        XCTAssertEqual(tree[0].children.map(\.label), ["전면", "배면", "전면-배면"])
        XCTAssertEqual(tree[0].children[0].children.map(\.label),
                       ["수직철근", "수평철근(배력철근)"])
        XCTAssertEqual(tree[0].children[1].children.map(\.label),
                       ["수직철근(주철근)", "수평철근(배력철근)"])
        // 잎은 번호순
        XCTAssertEqual(tree[0].children[1].children[0].children.map(\.label),
                       (1...5).map { "벽체-배면-수직철근(주철근)-0\($0)" })
    }
```

- [ ] **Step 2: 실패 확인**

Run: `xcodebuild test … -only-testing:LHRebarARTests`
Expected: `testTreeOrderFollowsOfficialTable` FAIL (순서가 표 순서가 아님). `testTreeOrderIsDeterministic`은 간헐 실패일 수 있다 — 실패하지 않아도 진행한다(비결정성은 원래 간헐적이다).

- [ ] **Step 3: `Node`에 `order` 추가**

`RebarTaxonomy.swift:147`의 `Node`:

```swift
    struct Node: Equatable {
        var path: [String]
        var label: String
        var no: Int?
        /// 발주처 분류표에서의 행 인덱스. 표 밖 노드는 `Int.max`.
        /// **정렬 전용이다** — Dictionary 순회 순서가 실행마다 달라지는 것을 막는다.
        var order: Int
        /// 이 잎에 매달린 엔티티 경로 목록. 1 prim = 1 가닥 규약을 어기면 2개 이상.
        var paths: [String]
    }
```

- [ ] **Step 4: 토큰 → 행 인덱스 사전 추가**

`rowByToken` 정의(`:77`) 바로 아래에:

```swift
    /// 토큰 → 분류표 행 인덱스. 트리 형제 순서를 표 순서로 고정하는 데 쓴다.
    static let rowIndexByToken: [String: Int] = {
        var m: [String: Int] = [:]
        for (i, r) in wallTaxonomy.enumerated() { m[r.token] = i }
        return m
    }()
```

- [ ] **Step 5: `Parsed`가 토큰을 나르게 한다**

`Parsed`(`:106`):

```swift
    struct Parsed: Equatable {
        var path: [String]
        var no: Int?
        /// 분류표 행에 정확히 맞은 경우 그 토큰. 느슨한 폴백으로 만든 경로면 nil.
        var token: String?
    }
```

`parsePrimName`(`:112`)의 두 반환 지점을 고친다:

```swift
        // ★ 분류표 조회가 우선. 괄호 안 역할명은 조합을 봐야 나온다.
        let joined = tokens.joined(separator: "_")
        if let row = rowByToken[joined] {
            return Parsed(path: row.path, no: no, token: joined)
        }
```

그리고 마지막 반환:

```swift
        return Parsed(path: path, no: no, token: nil)
```

- [ ] **Step 6: 두 Taxonomy 생성기가 `order`를 채우게 한다**

`fromPrimNames`(`:209`)의 Node 생성:

```swift
            var node = nodeByPrim[key] ?? Node(
                path: parsed.path,
                label: composeLabel(path: parsed.path, no: parsed.no),
                no: parsed.no,
                order: parsed.token.flatMap { rowIndexByToken[$0] } ?? Int.max,
                paths: []
            )
```

`fromSidecar`(`:178`)의 Node 생성 — 사이드카 `path` 배열이 어느 행의 `row.path`와 원소 단위로 같으면 그 행의 인덱스를 쓴다:

```swift
            var node = nodeByPrim[key] ?? Node(
                path: hit.path,
                label: hit.label ?? composeLabel(path: hit.path, no: hit.no),
                no: hit.no,
                order: wallTaxonomy.firstIndex { $0.path == hit.path } ?? Int.max,
                paths: []
            )
```

- [ ] **Step 7: `buildTree`가 정렬 후 순회하게 한다**

`buildTree`(`:273`)의 `for (_, node) in t.byPath {` 를 교체한다:

```swift
        // ★ Dictionary 순회 순서는 명세돼 있지 않다 — 정렬하지 않으면 앱을 다시 켤
        //   때마다 트리의 면·기능 순서가 바뀐다. (order, no, 잎경로) 로 못박는다.
        let ordered = t.byPath.values.sorted { a, b in
            if a.order != b.order { return a.order < b.order }
            if (a.no ?? 0) != (b.no ?? 0) { return (a.no ?? 0) < (b.no ?? 0) }
            return (a.paths.first ?? "") < (b.paths.first ?? "")
        }
        for node in ordered {
```

나머지 본문(`let key = node.paths.sorted()…` 이하)은 그대로 둔다.

- [ ] **Step 8: 통과 확인**

Run: `xcodebuild test … -only-testing:LHRebarARTests`
Expected: 11 PASS

- [ ] **Step 9: 커밋**

```bash
git add LHRebarAR/Model/RebarTaxonomy.swift LHRebarARTests
git commit -m "fix: 트리 형제 순서를 분류표 순서로 고정 — Dictionary 순회라 실행마다 달랐다"
```

---

## Task 4: 필터가 실제로 숨기게 한다

이 플랜의 핵심이다. 스펙 §3.4의 세 지점을 한꺼번에 고친다.

**Files:**
- Create: `LHRebarARTests/RebarFilterTests.swift`
- Modify: `LHRebarAR/Model/RebarTaxonomy.swift` (`allValues` 삭제, `leafValues`·`checkState` 추가, `visiblePaths` 잎 한정)
- Modify: `LHRebarAR/Placement/PlacementViewModel.swift:106-160`
- Modify: `LHRebarAR/UI/Components/RebarTreePad.swift`

**Interfaces:**
- Produces: `RebarTaxonomy.leafValues(_ nodes: [TreeNode]) -> Set<String>`, `RebarTaxonomy.leafValues(_ node: TreeNode) -> Set<String>`, `RebarTaxonomy.CheckState { on, off, mixed }`, `RebarTaxonomy.checkState(_ node: TreeNode, checked: Set<String>) -> CheckState`, `PlacementViewModel.rebarNodeCount: Int`
- Removes: `RebarTaxonomy.allValues(_:)`, `PlacementViewModel.lastFilterMatchCount`

- [ ] **Step 1: 실패하는 테스트 작성**

`LHRebarARTests/RebarFilterTests.swift`:

```swift
// LHRebarARTests/RebarFilterTests.swift
import XCTest

/// 2026-08-18 회귀 재현. 이 테스트들이 없던 동안 필터는 **아무것도 숨기지 못했다**:
/// buildTree 가 조상마다 자손 경로를 쌓고 visiblePaths 가 그걸 전부 합집합했기 때문.
final class RebarFilterTests: XCTestCase {

    private func tree() throws -> [RebarTaxonomy.TreeNode] {
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
        return RebarTaxonomy.buildTree(t)
    }

    func testAllLeavesCheckedShowsEverything() throws {
        let tree = try tree()
        let checked = RebarTaxonomy.leafValues(tree)
        XCTAssertEqual(checked.count, 45)
        XCTAssertEqual(RebarTaxonomy.visiblePaths(tree, checked: checked).count, 45)
    }

    func testUncheckingOneLeafHidesExactlyOne() throws {
        let tree = try tree()
        var checked = RebarTaxonomy.leafValues(tree)
        checked.remove("/RebarModel/Wall_Front_Vert_01")
        XCTAssertEqual(RebarTaxonomy.visiblePaths(tree, checked: checked).count, 44)
    }

    /// 가지 하나(전면 수직철근 9가닥)를 끄면 정확히 9개가 사라져야 한다.
    /// 조상 '벽체' 가 45개를 되살리던 것이 원래 버그다.
    func testUncheckingBranchHidesItsLeavesOnly() throws {
        let tree = try tree()
        var checked = RebarTaxonomy.leafValues(tree)
        for i in 1...9 {
            checked.remove("/RebarModel/Wall_Front_Vert_\(String(format: "%02d", i))")
        }
        let visible = RebarTaxonomy.visiblePaths(tree, checked: checked)
        XCTAssertEqual(visible.count, 36)
        XCTAssertFalse(visible.contains("/RebarModel/Wall_Front_Vert_05"))
        XCTAssertTrue(visible.contains("/RebarModel/Wall_Rear_Vert_05"))
    }

    func testUncheckingEverythingHidesEverything() throws {
        XCTAssertTrue(try RebarTaxonomy.visiblePaths(tree(), checked: []).isEmpty)
    }

    /// 조상 value 가 체크 집합에 섞여 들어와도 가시성에 영향을 주면 안 된다.
    /// (잎만 센다는 규칙을 못박는다)
    func testAncestorValuesInCheckedSetAreIgnored() throws {
        let tree = try tree()
        var checked = RebarTaxonomy.leafValues(tree)
        for i in 1...9 {
            checked.remove("/RebarModel/Wall_Front_Vert_\(String(format: "%02d", i))")
        }
        checked.insert("벽체")
        checked.insert("벽체/전면")
        checked.insert("벽체/전면/수직철근")
        XCTAssertEqual(RebarTaxonomy.visiblePaths(tree, checked: checked).count, 36)
    }

    func testCheckStateIsThreeWay() throws {
        let tree = try tree()
        let front = try XCTUnwrap(tree.first?.children.first { $0.label == "전면" })
        let vert = try XCTUnwrap(front.children.first { $0.label == "수직철근" })

        let all = RebarTaxonomy.leafValues(tree)
        XCTAssertEqual(RebarTaxonomy.checkState(vert, checked: all), .on)
        XCTAssertEqual(RebarTaxonomy.checkState(vert, checked: []), .off)

        var partial = RebarTaxonomy.leafValues(tree)
        partial.remove("/RebarModel/Wall_Front_Vert_01")
        XCTAssertEqual(RebarTaxonomy.checkState(vert, checked: partial), .mixed)
        XCTAssertEqual(RebarTaxonomy.checkState(front, checked: partial), .mixed)
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `xcodebuild test … -only-testing:LHRebarARTests`
Expected: 컴파일 실패(`leafValues`/`checkState` 미존재). 이것이 이 단계의 빨강이다.

- [ ] **Step 3: `leafValues` · `checkState` 추가, `allValues` 삭제**

`RebarTaxonomy.swift`의 `allValues`(`:306`)를 **삭제**하고 그 자리에 넣는다:

```swift
    /// 트리의 **잎** value 만 — 체크 상태의 신원 집합.
    ///
    /// ★ 조상 value 는 절대 포함하지 않는다. 조상은 자손 경로를 중복 보유하므로
    ///   체크 집합에 들어가는 순간 자손을 꺼도 되살아난다(2026-08-18 회귀).
    ///   조상 체크박스는 상태를 저장하지 않고 `checkState` 로 파생한다.
    static func leafValues(_ nodes: [TreeNode]) -> Set<String> {
        var out: Set<String> = []
        func walk(_ ns: [TreeNode]) {
            for n in ns {
                if n.children.isEmpty { out.insert(n.value) } else { walk(n.children) }
            }
        }
        walk(nodes)
        return out
    }

    /// 한 노드 서브트리의 잎 value.
    static func leafValues(_ node: TreeNode) -> Set<String> {
        node.children.isEmpty ? [node.value] : leafValues(node.children)
    }

    enum CheckState { case on, off, mixed }

    /// 노드의 체크 상태 — 자손 잎에서 파생한다.
    static func checkState(_ node: TreeNode, checked: Set<String>) -> CheckState {
        let leaves = leafValues(node)
        guard !leaves.isEmpty else { return .off }
        let on = leaves.intersection(checked).count
        if on == 0 { return .off }
        return on == leaves.count ? .on : .mixed
    }
```

- [ ] **Step 4: `visiblePaths`를 잎으로 한정**

`visiblePaths`(`:319`)를 교체한다:

```swift
    /// 체크된 **잎** → 보여야 할 엔티티 경로 집합.
    ///
    /// ★ 잎의 `value` 가 아니라 `paths` 를 합친다. value 는 `stripComponentIndex` 를
    ///   거친 값인데 `applyVisibility` 가 비교하는 id 는 `경로` / `경로#1` 형태다.
    ///   한 prim 이 연결요소 여럿으로 쪼개진 경우까지 맞으려면 paths 여야 한다.
    /// ★ 조상 노드는 절대 세지 않는다 — 자손 경로를 중복 보유하기 때문이다.
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

- [ ] **Step 5: `PlacementViewModel` — 원복 로직 삭제 + 잎 기준**

`PlacementViewModel.swift:34`의 `lastFilterMatchCount`를 삭제하고 대신 넣는다:

```swift
    /// 배치된 모델에서 찾은 메시 노드 수. 0이면 RealityKit 이 이름 있는 노드를
    /// 주지 않았다는 뜻이다(스펙 §3.7 — 기기 검증 항목).
    @Published private(set) var rebarNodeCount: Int = 0
```

`rebuildRebarTree`(`:111`)에서 `paths`를 구한 직후에 `rebarNodeCount = paths.count`를 넣고, `checkedRebarNodes = RebarTaxonomy.allValues(rebarTree)` **세 곳(`:123`, `:130`, `:140`)을 전부** `RebarTaxonomy.leafValues(rebarTree)` 로 바꾼다. `rebarTree = []` 로 빠지는 가드(`:113`)에서는 `rebarNodeCount = 0` 도 같이 넣는다.

`applyRebarFilter`(`:146`)를 교체한다:

```swift
    private func applyRebarFilter() {
        guard AppFeatures.rebarFilter, !rebarTree.isEmpty else { return }
        let all = RebarTaxonomy.leafValues(rebarTree)
        // 전부 체크된 상태는 "필터 없음"이다 — 굳이 집합을 만들지 않는다
        let visible: Set<String>? = checkedRebarNodes == all
            ? nil
            : RebarTaxonomy.visiblePaths(rebarTree, checked: checkedRebarNodes)
        anchorController?.applyVisibility(visible)
        // ★ 여기서 matched==0 을 조인 실패로 읽지 않는다. "사용자가 전부 숨겼다" 와
        //   구분되지 않아 전체 해제가 즉시 원복되던 것이 2026-08-18 회귀였다.
        //   조인 성패는 rebuildRebarTree 에서 rebarNodeCount 로 한 번만 판정한다.
    }
```

- [ ] **Step 6: `RebarTreePad` 3상태 체크박스**

`RebarTreePad`의 `matchCount` 프로퍼티를 `nodeCount: Int`로 바꾸고, 경고 블록(`:36-40`)을 교체한다:

```swift
    /// 모델에서 찾은 메시 노드 수 — 0이면 이름 있는 노드가 하나도 없다
    let nodeCount: Int
```

```swift
            if nodeCount == 0 {
                Label("모델에서 철근 노드를 찾지 못했습니다", systemImage: "xmark.circle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
```

"전체 선택"(`:42`)을 잎 기준으로:

```swift
                Button("전체 선택") { checked = RebarTaxonomy.leafValues(nodes) }
                Button("전체 해제") { checked = [] }
```

`RebarTreeRow`의 `subtreeValues`/`isOn`을 교체한다:

```swift
    /// 이 서브트리의 **잎** value 만. 조상 value 는 체크 집합에 넣지 않는다.
    private var leaves: Set<String> { RebarTaxonomy.leafValues(node) }
    private var state: RebarTaxonomy.CheckState {
        RebarTaxonomy.checkState(node, checked: checked)
    }
```

체크박스 버튼:

```swift
                Button {
                    if state == .on { checked.subtract(leaves) } else { checked.formUnion(leaves) }
                } label: {
                    Image(systemName: {
                        switch state {
                        case .on:    return "checkmark.square.fill"
                        case .mixed: return "minus.square.fill"
                        case .off:   return "square"
                        }
                    }())
                    .font(.system(size: 15))
                }
                .buttonStyle(.plain)
```

`ARPlacementView.swift`의 `RebarTreePad(...)` 호출에서 `matchCount: placement.lastFilterMatchCount` 를 `nodeCount: placement.rebarNodeCount` 로 바꾼다.

- [ ] **Step 7: 통과 확인 + 컴파일**

Run: `xcodebuild test … -only-testing:LHRebarARTests`
Expected: 17 PASS

Run: `xcodebuild build -project LHRebarAR.xcodeproj -scheme LHRebarARLH -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`
Expected: BUILD SUCCEEDED

연구과제 앱도 컴파일되는지 확인한다(같은 소스를 공유한다):

Run: `xcodebuild build -project LHRebarAR.xcodeproj -scheme LHRebarAR -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`
Expected: BUILD SUCCEEDED

- [ ] **Step 8: 커밋**

```bash
git add LHRebarAR/Model/RebarTaxonomy.swift LHRebarAR/Placement/PlacementViewModel.swift \
        LHRebarAR/UI/Components/RebarTreePad.swift LHRebarAR/UI/Screens/ARPlacementView.swift \
        LHRebarARTests
git commit -m "fix: 철근 필터가 실제로 숨기게 — 체크 상태를 잎만 담고 전체해제 원복을 없앤다"
```

---

## Task 5: 종류축 로직

**Files:**
- Create: `LHRebarARTests/RebarKindAxisTests.swift`
- Modify: `LHRebarAR/Model/RebarTaxonomy.swift` (`WallRow`에 `kind`/`role`, `Node`에 `kind`/`role`/`position`, `Axis`, `buildTree(axis:)`)

**Interfaces:**
- Consumes: `Node { path, label, no, order, paths }`(T3), `leafValues`/`checkState`/`visiblePaths`(T4)
- Produces: `RebarTaxonomy.Axis { member, kind }`, `buildTree(_ t: Taxonomy, axis: Axis = .member) -> [TreeNode]`, `WallRow.kind: String`, `WallRow.role: String?`, `Node.kind: String?`, `Node.role: String?`, `Node.position: String?`

- [ ] **Step 1: 실패하는 테스트 작성**

`LHRebarARTests/RebarKindAxisTests.swift`:

```swift
// LHRebarARTests/RebarKindAxisTests.swift
import XCTest

final class RebarKindAxisTests: XCTestCase {

    private func taxonomy() throws -> RebarTaxonomy.Taxonomy {
        try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
    }

    /// 종류순은 2단이다: 종류 → 위치.
    /// 역할명(괄호 안)은 **한 종류 안에서 역할이 하나뿐이면 종류 노드에**,
    /// 갈리면 자식에 붙는다.
    func testKindAxisShape() throws {
        let tree = RebarTaxonomy.buildTree(try taxonomy(), axis: .kind)
        XCTAssertEqual(tree.map(\.label),
                       ["수직철근", "수평철근(배력철근)", "간격재(전단철근)"])
        XCTAssertEqual(tree.map(\.count), [14, 18, 13])

        // 수직철근: 전면은 역할 없음, 배면은 주철근 → 갈리므로 자식에 붙는다
        XCTAssertEqual(tree[0].children.map(\.label), ["전면", "배면(주철근)"])
        XCTAssertEqual(tree[0].children.map(\.count), [9, 5])

        // 수평철근: 양면 모두 배력철근 → 종류 노드에 붙고 자식은 면만
        XCTAssertEqual(tree[1].children.map(\.label), ["전면", "배면"])
        XCTAssertEqual(tree[2].children.map(\.label), ["전면-배면"])
    }

    /// 잎은 두 축에서 같은 value 를 갖는다 — 그래서 축을 바꿔도 체크가 유지된다.
    func testLeafValuesAreIdenticalAcrossAxes() throws {
        let t = try taxonomy()
        XCTAssertEqual(RebarTaxonomy.leafValues(RebarTaxonomy.buildTree(t, axis: .member)),
                       RebarTaxonomy.leafValues(RebarTaxonomy.buildTree(t, axis: .kind)))
    }

    /// 부위순에서 9가닥을 끈 체크 집합을 종류순 트리에 그대로 먹여도 36개가 보인다.
    func testCheckedSetSurvivesAxisSwitch() throws {
        let t = try taxonomy()
        let member = RebarTaxonomy.buildTree(t, axis: .member)
        var checked = RebarTaxonomy.leafValues(member)
        for i in 1...9 {
            checked.remove("/RebarModel/Wall_Front_Vert_\(String(format: "%02d", i))")
        }
        XCTAssertEqual(RebarTaxonomy.visiblePaths(member, checked: checked).count, 36)

        let kind = RebarTaxonomy.buildTree(t, axis: .kind)
        XCTAssertEqual(RebarTaxonomy.visiblePaths(kind, checked: checked).count, 36)
    }

    /// 기본 인자는 부위순이다 — 기존 호출부가 안 깨진다.
    func testDefaultAxisIsMember() throws {
        let t = try taxonomy()
        XCTAssertEqual(RebarTaxonomy.buildTree(t).map(\.label),
                       RebarTaxonomy.buildTree(t, axis: .member).map(\.label))
    }

    /// 분류표 밖 이름은 종류축 재료가 없다 → 종류순에서 「분류 없음」으로 간다.
    func testUnknownNamesGoToUnclassifiedOnKindAxis() throws {
        let paths = DesignModelFixture.paths + ["/RebarModel/TopV_01", "/RebarModel/TopV_02"]
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: paths))
        let kind = RebarTaxonomy.buildTree(t, axis: .kind)
        XCTAssertEqual(kind.last?.label, "분류 없음")
        XCTAssertEqual(kind.last?.count, 2)
        // 부위순에서는 레거시 어댑터가 편 경로대로 계속 보인다
        let member = RebarTaxonomy.buildTree(t, axis: .member)
        XCTAssertTrue(member.contains { $0.label == "상단" })
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `xcodebuild test … -only-testing:LHRebarARTests`
Expected: 컴파일 실패(`axis:` 인자, `Axis` 미존재)

- [ ] **Step 3: `WallRow`에 `kind`/`role` 추가**

`RebarTaxonomy.swift:51`의 `WallRow`:

```swift
    struct WallRow {
        let token: String
        let member: String
        let face: String?
        let fn: String
        /// 종류 — `fn` 에서 괄호를 뗀 값. **표에 명시한다.**
        /// 한글 라벨에 정규식을 돌리는 건 깨지기 쉽고, 분류표가 단일 진실이어야 한다.
        let kind: String
        /// 괄호 안 역할명. 없으면 nil.
        let role: String?
        let optional: Bool

        /// 트리 경로. 면이 없는 행은 2단계다.
        var path: [String] { face == nil ? [member, fn] : [member, face!, fn] }
        /// 종류축의 2단째 — 면이 있으면 면, 없으면 부재.
        var position: String { face ?? member }
    }
```

`wallTaxonomy`(`:62`) 12행 전부에 두 값을 넣는다:

```swift
    static let wallTaxonomy: [WallRow] = [
        .init(token: "Wall_Front_Vert",       member: "벽체", face: "전면",      fn: "수직철근",             kind: "수직철근",   role: nil,       optional: false),
        .init(token: "Wall_Front_Horiz",      member: "벽체", face: "전면",      fn: "수평철근(배력철근)",   kind: "수평철근",   role: "배력철근", optional: false),
        .init(token: "Wall_Rear_Vert",        member: "벽체", face: "배면",      fn: "수직철근(주철근)",     kind: "수직철근",   role: "주철근",   optional: false),
        .init(token: "Wall_Rear_Horiz",       member: "벽체", face: "배면",      fn: "수평철근(배력철근)",   kind: "수평철근",   role: "배력철근", optional: false),
        .init(token: "Wall_FrontRear_Shear",  member: "벽체", face: "전면-배면", fn: "간격재(전단철근)",     kind: "간격재",     role: "전단철근", optional: true),
        .init(token: "Wall_Top_Reinf",        member: "벽체", face: "상단",      fn: "보강철근",             kind: "보강철근",   role: nil,       optional: true),
        .init(token: "Base_Upper_Trans",      member: "저판", face: "상부",      fn: "횡방향철근(주철근)",   kind: "횡방향철근", role: "주철근",   optional: false),
        .init(token: "Base_Upper_Long",       member: "저판", face: "상부",      fn: "종방향철근(배력철근)", kind: "종방향철근", role: "배력철근", optional: false),
        .init(token: "Base_Lower_Trans",      member: "저판", face: "하부",      fn: "횡방향철근",           kind: "횡방향철근", role: nil,       optional: false),
        .init(token: "Base_Lower_Long",       member: "저판", face: "하부",      fn: "종방향철근(배력철근)", kind: "종방향철근", role: "배력철근", optional: false),
        .init(token: "Base_UpperLower_Shear", member: "저판", face: "상부-하부", fn: "간격재(전단철근)",     kind: "간격재",     role: "전단철근", optional: true),
        .init(token: "WallBase_Haunch",       member: "벽체-저판", face: nil,    fn: "보강철근(헌치철근)",   kind: "보강철근",   role: "헌치철근", optional: true),
    ]
```

- [ ] **Step 4: `Node`에 종류축 재료 추가**

```swift
    struct Node: Equatable {
        var path: [String]
        var label: String
        var no: Int?
        /// 발주처 분류표에서의 행 인덱스. 표 밖 노드는 `Int.max`.
        var order: Int
        /// 종류축 재료. 분류표 밖 노드는 전부 nil → 종류순에서 「분류 없음」으로 간다.
        var kind: String?
        var role: String?
        var position: String?
        /// 이 잎에 매달린 엔티티 경로 목록.
        var paths: [String]
    }
```

`fromPrimNames`의 Node 생성에 채운다:

```swift
            let row = parsed.token.flatMap { rowByToken[$0] }
            var node = nodeByPrim[key] ?? Node(
                path: parsed.path,
                label: composeLabel(path: parsed.path, no: parsed.no),
                no: parsed.no,
                order: parsed.token.flatMap { rowIndexByToken[$0] } ?? Int.max,
                kind: row?.kind,
                role: row?.role,
                position: row?.position,
                paths: []
            )
```

`fromSidecar`의 Node 생성:

```swift
            let row = wallTaxonomy.first { $0.path == hit.path }
            var node = nodeByPrim[key] ?? Node(
                path: hit.path,
                label: hit.label ?? composeLabel(path: hit.path, no: hit.no),
                no: hit.no,
                order: wallTaxonomy.firstIndex { $0.path == hit.path } ?? Int.max,
                kind: row?.kind,
                role: row?.role,
                position: row?.position,
                paths: []
            )
```

- [ ] **Step 5: `Axis` + `buildTree(axis:)`**

`unclassifiedValue`(`:270`) 위에 넣는다:

```swift
    /// 트리를 쌓는 축.
    /// - member: 발주처 분류표 그대로 — 부재 > 면 > 기능
    /// - kind:   종류 > 위치 (2단). 발주처 기능표의 "철근 종류별" 요구에 대응한다
    enum Axis: String { case member, kind }
```

`buildTree`(`:273`)의 시그니처와 경로 계산을 바꾼다. 기존 본문에서 `for seg in node.path` 였던 부분이 축에 따라 달라진다:

```swift
    /// Taxonomy → 중첩 트리. `unmatched` 가 있으면 「분류 없음」을 마지막에 붙인다.
    static func buildTree(_ t: Taxonomy, axis: Axis = .member) -> [TreeNode] {
        let root = TreeNode(value: "", label: t.root)
        var seen = Set<String>()

        // ★ Dictionary 순회 순서는 명세돼 있지 않다 — 정렬하지 않으면 앱을 다시 켤
        //   때마다 트리의 면·기능 순서가 바뀐다. (order, no, 잎경로) 로 못박는다.
        let ordered = t.byPath.values.sorted { a, b in
            if a.order != b.order { return a.order < b.order }
            if (a.no ?? 0) != (b.no ?? 0) { return (a.no ?? 0) < (b.no ?? 0) }
            return (a.paths.first ?? "") < (b.paths.first ?? "")
        }

        // 종류축 라벨은 형제 맥락에 달렸다 — 한 종류 안의 역할 집합을 먼저 모은다.
        var rolesByKind: [String: Set<String?>] = [:]
        if axis == .kind {
            for n in ordered {
                guard let k = n.kind else { continue }
                rolesByKind[k, default: []].insert(n.role)
            }
        }

        /// 이 노드가 축에서 갖는 경로. 종류축인데 재료가 없으면 nil(→ 분류 없음).
        func segments(_ n: Node) -> [String]? {
            switch axis {
            case .member:
                return n.path
            case .kind:
                guard let kind = n.kind, let position = n.position else { return nil }
                let roles = rolesByKind[kind] ?? []
                // 역할이 하나뿐이면 종류 노드에, 갈리면 자식에 붙인다
                let single = roles.count == 1 ? roles.first ?? nil : nil
                let kindLabel = single.map { "\(kind)(\($0))" } ?? kind
                let posLabel = (roles.count > 1 && n.role != nil)
                    ? "\(position)(\(n.role!))" : position
                return [kindLabel, posLabel]
            }
        }

        var orphans: [String] = []
        for node in ordered {
            let key = node.paths.sorted().joined(separator: "|")
            if seen.contains(key) { continue }
            seen.insert(key)

            guard let segs0 = segments(node) else {
                orphans.append(contentsOf: node.paths)
                continue
            }

            var level = root
            var segs: [String] = []
            for seg in segs0 {
                segs.append(seg)
                let child = level.child(value: segs.joined(separator: "/"), label: seg)
                child.add(paths: node.paths)
                level = child
            }
            let leafValue = normalizePrimPath(stripComponentIndex(node.paths.first ?? ""))
            let leaf = level.child(value: leafValue, label: node.label)
            if leaf.paths.isEmpty { leaf.add(paths: node.paths) }
        }

        var out = root.children
        let unclassified = t.unmatched + orphans
        if !unclassified.isEmpty {
            let node = TreeNode(value: unclassifiedValue, label: "분류 없음")
            node.add(paths: unclassified)
            out.append(node)
        }
        return out
    }
```

라벨이 `"분류 없음 (\(count))"` 에서 `"분류 없음"` 으로 바뀌는 점에 주의한다 — 개수는 `TreeNode.count` 가 이미 들고 있고 `RebarTreePad` 가 모든 노드 옆에 개수를 그린다. 중복을 없앤 것이다.

**주의:** 「분류 없음」 노드는 자식이 없으므로 `leafValues`/`visiblePaths` 가 잎으로 취급한다. 그 노드 하나를 끄면 미분류 철근 전부가 숨는다 — 의도한 동작이다.

- [ ] **Step 6: 통과 확인**

Run: `xcodebuild test … -only-testing:LHRebarARTests`
Expected: 23 PASS

- [ ] **Step 7: 커밋**

```bash
git add LHRebarAR/Model/RebarTaxonomy.swift LHRebarARTests
git commit -m "feat: 철근 종류축 — 분류표에 kind/role 컬럼 추가하고 buildTree 에 축 인자"
```

---

## Task 6: 축 전환 UI

**Files:**
- Modify: `LHRebarAR/Placement/PlacementViewModel.swift` (`rebarTaxonomy`, `rebarAxis`)
- Modify: `LHRebarAR/UI/Components/RebarTreePad.swift` (Picker)
- Modify: `LHRebarAR/UI/Screens/ARPlacementView.swift` (바인딩 전달)

**Interfaces:**
- Consumes: `RebarTaxonomy.Axis`, `buildTree(_:axis:)`(T5), `leafValues`(T4)
- Produces: `PlacementViewModel.rebarAxis: RebarTaxonomy.Axis`, `PlacementViewModel.rebarTaxonomy: RebarTaxonomy.Taxonomy?`

- [ ] **Step 1: 뷰모델에 축 상태 추가**

`PlacementViewModel.swift`의 `rebarTree` 선언 근처에 넣는다:

```swift
    /// 분류 결과 원본. 축을 바꿀 때 재분류하지 않고 트리만 다시 쌓는다.
    @Published private(set) var rebarTaxonomy: RebarTaxonomy.Taxonomy?
    /// 트리를 쌓는 축. 시트를 닫았다 열어도 유지되도록 뷰모델이 들고 있는다.
    @Published var rebarAxis: RebarTaxonomy.Axis = .member {
        didSet { if oldValue != rebarAxis { rebuildTreeOnly() } }
    }
```

- [ ] **Step 2: `rebuildRebarTree`가 Taxonomy를 보관하게 한다**

`rebuildRebarTree` 안의 세 갈래(사이드카 / prim이름 / 평면 폴백)가 각자 `rebarTree`·`rebarSource`·`checkedRebarNodes`를 세팅하던 것을, 공통 함수 하나로 모은다. `rebuildRebarTree` 본문의 세 블록을 각각 이렇게 바꾼다:

```swift
        if let meta = rebarMeta, meta.isUsable {
            let t = RebarTaxonomy.fromSidecar(meta, entityPaths: paths)
            if !t.byPath.isEmpty { adopt(t); return }
        }
        if let t = RebarTaxonomy.fromPrimNames(entityPaths: paths) { adopt(t); return }
        // 이름이 규약을 안 따르면 계층 없이 평평하게 나열한다 — 개별 토글은 유지된다
        // (spec §7.5). 아무것도 못 하는 것보다 낫다.
        adopt(RebarTaxonomy.Taxonomy(
            root: "전체", byPath: [:], unmatched: paths, source: .geometry))
```

그리고 아래 두 private 함수를 추가한다:

```swift
    /// 새 분류를 채택한다 — 트리를 쌓고 체크를 전부 켠다.
    private func adopt(_ t: RebarTaxonomy.Taxonomy) {
        rebarTaxonomy = t
        rebarSource = t.source
        rebarTree = RebarTaxonomy.buildTree(t, axis: rebarAxis)
        checkedRebarNodes = RebarTaxonomy.leafValues(rebarTree)
    }

    /// 축만 바꾼다 — 재분류도, 체크 초기화도 하지 않는다.
    /// 잎 value 가 축과 무관해서(정규화된 prim 경로) 체크가 그대로 유효하다.
    private func rebuildTreeOnly() {
        guard let t = rebarTaxonomy else { return }
        rebarTree = RebarTaxonomy.buildTree(t, axis: rebarAxis)
    }
```

`rebarTree = []` 로 빠지는 가드에서는 `rebarTaxonomy = nil` 도 같이 넣는다.

- [ ] **Step 3: `RebarTreePad`에 Picker 추가**

프로퍼티에 바인딩을 추가한다:

```swift
    @Binding var axis: RebarTaxonomy.Axis
```

헤더 `HStack` 바로 아래, 배지들 위에 넣는다:

```swift
            // 부위순 = 발주처 분류표 그대로, 종류순 = 발주처 기능표의 "철근 종류별".
            // 잎이 같아서 전환해도 체크가 유지된다.
            Picker("", selection: $axis) {
                Text("부위순").tag(RebarTaxonomy.Axis.member)
                Text("종류순").tag(RebarTaxonomy.Axis.kind)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
```

- [ ] **Step 4: `ARPlacementView`에서 바인딩 전달**

`RebarTreePad(...)` 호출에 `axis: $placement.rebarAxis` 를 추가한다. `placement` 가 `@ObservedObject`/`@StateObject` 이므로 `$placement.rebarAxis` 로 바인딩이 나온다.

- [ ] **Step 5: 컴파일 확인**

Run: `xcodebuild build -project LHRebarAR.xcodeproj -scheme LHRebarARLH -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`
Expected: BUILD SUCCEEDED

Run: `xcodebuild build -project LHRebarAR.xcodeproj -scheme LHRebarAR -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`
Expected: BUILD SUCCEEDED (연구과제 앱은 `rebarFilter=false` 라 UI가 안 뜨지만 같은 소스를 컴파일한다)

Run: `xcodebuild test … -only-testing:LHRebarARTests`
Expected: 23 PASS (회귀 없음)

- [ ] **Step 6: 커밋**

```bash
git add LHRebarAR/Placement/PlacementViewModel.swift LHRebarAR/UI
git commit -m "feat: 철근 트리 부위순/종류순 전환 — 축은 뷰모델이 들고 체크는 잎 기준이라 유지된다"
```

---

## Task 7: 대시보드 분류표 동기화

화면은 건드리지 않는다. 분류표가 두 구현의 단일 진실이므로 컬럼만 맞춘다. 크래시 수정은 **범위 밖**이다.

**Files:**
- Modify: `office-dashboard/src/lib/analysis/taxonomy.ts:139-163`
- Modify: `office-dashboard/src/lib/analysis/taxonomy.test.ts`

**Interfaces:**
- Produces: `WallTaxonomyRow.kind: string`, `WallTaxonomyRow.role: string | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`taxonomy.test.ts` 맨 아래에 붙인다:

```ts
describe("실제 설계모델 (2026-08-18 BriconLab 업로드)", () => {
  // GET /analysis/usdz?ar_id=2 의 def Mesh 45개. 합성이 아니라 실측이다.
  const seq = (token: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      `/RebarModel/${token}_${String(i + 1).padStart(2, "0")}`);
  const IDS = [
    ...seq("Wall_FrontRear_Shear", 13),
    ...seq("Wall_Front_Horiz", 9),
    ...seq("Wall_Front_Vert", 9),
    ...seq("Wall_Rear_Horiz", 9),
    ...seq("Wall_Rear_Vert", 5),
  ];

  it("45개 전부 분류표로 해석된다", () => {
    const t = taxonomyFromPrimNames(IDS)!;
    expect(t).not.toBeNull();
    expect(t.source).toBe("primName");
    expect(t.unmatched).toEqual([]);
    expect(t.byId.size).toBe(45);

    const counts: Record<string, number> = {};
    for (const [, n] of t.byId) {
      const k = n.path.join(">");
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual({
      "벽체>전면-배면>간격재(전단철근)": 13,
      "벽체>전면>수평철근(배력철근)": 9,
      "벽체>전면>수직철근": 9,
      "벽체>배면>수평철근(배력철근)": 9,
      "벽체>배면>수직철근(주철근)": 5,
    });
  });

  it("Wall_Front 접두어가 Wall_FrontRear_Shear 를 삼키지 않는다", () => {
    const t = taxonomyFromPrimNames(IDS)!;
    expect(t.byId.get("/RebarModel/Wall_FrontRear_Shear_01")!.path)
      .toEqual(["벽체", "전면-배면", "간격재(전단철근)"]);
    expect(t.byId.get("/RebarModel/Wall_Front_Vert_01")!.path)
      .toEqual(["벽체", "전면", "수직철근"]);
  });
});

describe("분류표 kind/role 컬럼", () => {
  // iOS RebarTaxonomy.swift 의 wallTaxonomy 와 **같은 값**이어야 한다.
  it("모든 행에 kind 가 있고 role 은 fn 의 괄호 안과 일치한다", () => {
    for (const r of WALL_TAXONOMY) {
      expect(r.kind.length).toBeGreaterThan(0);
      const m = /\(([^)]+)\)$/.exec(r.fn);
      expect(r.role).toEqual(m ? m[1] : null);
      expect(r.fn.startsWith(r.kind)).toBe(true);
    }
  });

  it("종류가 면을 가로질러 합쳐진다", () => {
    const byKind = new Map<string, string[]>();
    for (const r of WALL_TAXONOMY) {
      byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.token]);
    }
    expect(byKind.get("수직철근")).toEqual(["Wall_Front_Vert", "Wall_Rear_Vert"]);
    expect(byKind.get("간격재")).toEqual(["Wall_FrontRear_Shear", "Base_UpperLower_Shear"]);
  });
});
```

`WALL_TAXONOMY` 가 import 목록에 없으면 파일 상단 import에 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `cd office-dashboard && npx vitest run src/lib/analysis/taxonomy.test.ts`
Expected: `kind`/`role` 미존재로 타입/런타임 실패

- [ ] **Step 3: 컬럼 추가**

`taxonomy.ts:139`:

```ts
export interface WallTaxonomyRow {
  /** ASCII prim 이름 토큰 (번호 제외). USD 식별자 규칙을 만족한다 */
  token: string;
  member: string;
  /** 면. 벽체-저판 경계처럼 면이 없는 행은 null */
  face: string | null;
  fn: string;
  /** 종류 — `fn` 에서 괄호를 뗀 값. iOS `RebarTaxonomy.wallTaxonomy` 와 같아야 한다 */
  kind: string;
  /** 괄호 안 역할명. 없으면 null */
  role: string | null;
  optional: boolean;
}
```

12행 전부에 두 값을 넣는다:

```ts
export const WALL_TAXONOMY: readonly WallTaxonomyRow[] = [
  { token: "Wall_Front_Vert",       member: "벽체", face: "전면",      fn: "수직철근",             kind: "수직철근",   role: null,       optional: false },
  { token: "Wall_Front_Horiz",      member: "벽체", face: "전면",      fn: "수평철근(배력철근)",   kind: "수평철근",   role: "배력철근", optional: false },
  { token: "Wall_Rear_Vert",        member: "벽체", face: "배면",      fn: "수직철근(주철근)",     kind: "수직철근",   role: "주철근",   optional: false },
  { token: "Wall_Rear_Horiz",       member: "벽체", face: "배면",      fn: "수평철근(배력철근)",   kind: "수평철근",   role: "배력철근", optional: false },
  { token: "Wall_FrontRear_Shear",  member: "벽체", face: "전면-배면", fn: "간격재(전단철근)",     kind: "간격재",     role: "전단철근", optional: true },
  { token: "Wall_Top_Reinf",        member: "벽체", face: "상단",      fn: "보강철근",             kind: "보강철근",   role: null,       optional: true },
  { token: "Base_Upper_Trans",      member: "저판", face: "상부",      fn: "횡방향철근(주철근)",   kind: "횡방향철근", role: "주철근",   optional: false },
  { token: "Base_Upper_Long",       member: "저판", face: "상부",      fn: "종방향철근(배력철근)", kind: "종방향철근", role: "배력철근", optional: false },
  { token: "Base_Lower_Trans",      member: "저판", face: "하부",      fn: "횡방향철근",           kind: "횡방향철근", role: null,       optional: false },
  { token: "Base_Lower_Long",       member: "저판", face: "하부",      fn: "종방향철근(배력철근)", kind: "종방향철근", role: "배력철근", optional: false },
  { token: "Base_UpperLower_Shear", member: "저판", face: "상부-하부", fn: "간격재(전단철근)",     kind: "간격재",     role: "전단철근", optional: true },
  { token: "WallBase_Haunch",       member: "벽체-저판", face: null,   fn: "보강철근(헌치철근)",   kind: "보강철근",   role: "헌치철근", optional: true },
] as const;
```

- [ ] **Step 4: 전체 회귀 확인**

Run: `cd office-dashboard && npx vitest run`
Expected: 기존 205개 + 신규 4개 전부 PASS

Run: `cd office-dashboard && npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add office-dashboard/src/lib/analysis/taxonomy.ts office-dashboard/src/lib/analysis/taxonomy.test.ts
git commit -m "test: 분류표에 kind/role 동기화 + 실측 45 prim 픽스처 (대시보드 화면은 무변경)"
```

---

## Task 8: 문서

CI 테스트 단계는 Task 1 Step 6에서 이미 넣었다 — 이 태스크는 문서만 다룬다.

**Files:**
- Modify: `docs/ar-app-split-device-check.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 기기 검증 항목 추가**

`docs/ar-app-split-device-check.md` 끝에 붙인다:

```markdown
## 철근 종류축 필터 (2026-08-18, 설계모델 ar_id=2)

단위 테스트가 증명하는 것은 로직이지 RealityKit 동작이 아니다. 아래는 기기에서만 확정된다.

| # | 확인 | 실패하면 |
|---|---|---|
| D1 | `#if DEBUG` 덤프(`ModelAnchorController.dumpEntityTree`)의 경로 집합이 45개 prim 이름(`Wall_Front_Vert_01` 등)을 포함하는가 | RealityKit 이 prim 이름을 `Entity.name` 으로 안 준다 → 전체가 「분류 없음」 한 덩어리. 사이드카나 다른 신원 축이 필요하다 |
| D2 | 트리에서 `전면 > 수직철근` 을 끄면 그 9가닥이 화면에서 사라지는가 | 잎 한정 `visiblePaths` 가 안 먹은 것 |
| D3 | 「전체 해제」 후 체크가 자동으로 되돌아오지 않는가 | `matched==0` 원복 로직이 남아 있다 |
| D4 | 숨긴 철근에 측정 레티클이 스냅되지 않는가 | `isEnabled=false` 가 hitTest 를 안 막는다 → 숨길 때 `CollisionComponent` 제거·복원으로 전환 |
| D5 | 부위순 ↔ 종류순 전환에서 체크가 유지되는가 | 잎 value 가 축과 무관하다는 전제가 깨진 것 |
| D6 | 모델 목록에 「설계모델」이 위에 뜨고 열리는가 | `ARModel` 관용 디코딩이 안 먹은 것 |
| D7 | 앱을 껐다 켜도 트리의 면 순서가 전면 → 배면 → 전면-배면 로 같은가 | `order` 정렬이 안 먹은 것 |
```

- [ ] **Step 2: `CLAUDE.md` 갱신**

세 곳을 고친다.

첫째, 머리말의 `**Last updated**` 줄을 이번 작업 상태로 바꾼다.

둘째, §1의 "**철근 계층(부위/면/방향)별 필터**" 문단에서 "종류 축은 아직 미구현"이라는 서술을 바로잡는다:

```markdown
**철근 계층 필터** (`AppFeatures.rebarFilter`, LH 앱 전용)는 **부위순 / 종류순 두 축**을
전환 토글로 제공한다. 부위순은 발주처 분류표 그대로(부재 > 면 > 기능), 종류순은
분류표의 `kind` 컬럼 기준(종류 > 위치)이라 발주처 기능표의 "철근 종류별 필터링"
요구에 대응한다. 2026-08-18 실측 설계모델에서 45가닥이 100% 분류된다.
기기 검증은 `docs/ar-app-split-device-check.md` 참조 — **아직 안 했다.**
```

셋째, §5 고차에 두 항목을 추가한다:

```markdown
15. **철근 트리의 체크 상태는 잎만 담는다.** 조상 노드 value 를 체크 집합에 넣으면
    안 된다 — `buildTree` 가 조상마다 자손 경로를 중복 보유하므로(`child.add(paths:)`),
    조상이 체크돼 있으면 자손을 꺼도 `visiblePaths` 합집합에서 되살아난다. 2026-08-18
    까지 필터가 **아무것도 숨기지 못한** 원인이 이것이다. 조상 체크박스는 상태를
    저장하지 말고 `RebarTaxonomy.checkState` 로 파생할 것. 대시보드가 같은 union
    규칙인데도 멀쩡한 이유는 Mantine `useTree` 가 잎만 저장하기 때문이다.

16. **"보이는 개수 0"을 조인 실패로 읽지 말 것.** 사용자가 전부 숨긴 것과 이름이
    안 맞아 조인이 실패한 것은 다른 사건이다. 예전 `applyRebarFilter` 는 둘을 같은
    신호(`matched == 0`)로 읽어 「전체 해제」를 즉시 원복시켰다. 조인 성패는 트리를
    만들 때 `rebarNodeCount` 로 한 번만 판정한다.

17. **BriconLab API 응답의 키·타입을 신뢰하지 말 것.** 2026-08-18 에 `ar-list` 가
    `ar_id`/`scan_id` 를 문자열에서 정수로, `upload_at` 을 `uploaded_at` 으로 바꿨고
    **타임스탬프와 remark 가 서로 다른 키에 들어왔다**(`source_filename` 에 시각,
    `uploaded_at` 에 remark). 옵션 없는 `JSONDecoder` 라 앱 모델 목록이 통째로 0건이
    됐다. `ARModel` 은 이제 id 를 String/Int 양쪽으로 받고 타임스탬프를 **키가 아니라
    형식(`YYYY-MM-DD`)으로** 고른다. 새 필드를 추가할 때도 부가 정보는 옵셔널로 둘 것 —
    키 하나 없어졌다고 목록이 죽으면 안 된다.
```

넷째, §8 "Open items"에 대시보드 크래시를 남긴다:

```markdown
**바로 고쳐야 하는 것 (범위 밖으로 남겨둔 것):**
- **대시보드가 프로덕션에서 죽어 있다** — `SiteAnalysis.tsx:63`·`SiteModels.tsx:101`
  이 `m.upload_at.slice(0,10)` 을 무가드로 읽는데 API 가 그 키를 없앴다.
  현장 카드를 누르면 `TypeError: Cannot read properties of undefined (reading 'slice')`
  로 화면 전체가 날아간다(2026-08-18 브라우저 확인). error boundary 도 없다.
  같은 두 파일이 설계모델을 `ar_type === "built-in"` 으로 찾는데 실제 값은 `"design"` 이다.
```

- [ ] **Step 3: 문서 검증**

Run: `git diff --stat`
Expected: 문서 2건만 (워크플로는 Task 1 에서 이미 커밋됐다)

- [ ] **Step 4: 커밋 + 푸시 + PR**

```bash
git add docs/ar-app-split-device-check.md CLAUDE.md
git commit -m "docs: 기기 검증 항목 + 고차 3건(잎만 체크·0을 조인실패로 읽지 말 것·API 불신)"
git push -u origin feat/rebar-kind-filter
gh pr create --title "철근 종류축 필터 — 실측 설계모델 대응" --body "$(cat <<'EOF'
## 무엇을

BriconLab 이 올린 실제 설계모델(45 prim, `Mock-up(2)_2.ifc`)을 기준으로 LH 전용 앱의
철근 필터를 갱신했다. 측정해 보니 분류는 45/45 정확한데 **그 화면에 닿는 길이 두 군데
막혀 있었다.**

## 고친 것

- **모델 목록이 0건이던 것** — `ar-list` 가 `ar_id` 를 정수로, `upload_at` 을
  `uploaded_at` 으로 바꿔 `JSONDecoder` 가 던지고 있었다. id 를 String/Int 양쪽으로 받고
  타임스탬프를 키가 아니라 형식으로 고른다. 부가 필드는 옵셔널이라 키가 또 사라져도
  목록이 죽지 않는다. 캐시 키가 다시 진짜 타임스탬프를 쓰게 되어 재업로드 시
  재다운로드가 안 되던 버그도 같이 풀렸다.
- **필터가 아무것도 못 숨기던 것** — 체크 상태를 잎만 담게 줄였다. 조상이 자손 경로를
  중복 보유해 union 에서 되살아나던 문제. 「전체 해제」가 즉시 원복되던 것도 함께
  (`matched==0` 을 조인 실패로 오인).
- **트리 순서가 실행마다 달라지던 것** — Dictionary 순회였다. 분류표 행 순서로 고정.

## 넣은 것

- **부위순 / 종류순 축 전환** — 분류표에 `kind`/`role` 컬럼을 추가하고 트리를 두 축으로
  쌓는다. 잎이 두 축에서 같아 전환해도 체크가 유지된다.
- **Swift 테스트 타겟 신설** — 이 저장소 최초다. 실측 45 prim 픽스처로 23케이스.
  CI 가 아카이브 전에 돌린다.

## 검증

- Swift 단위 23 PASS / 대시보드 209 PASS / 두 앱 컴파일 성공
- **기기 검증은 아직 안 했다.** RealityKit 이 USD prim 이름을 `Entity.name` 으로
  보존하는지가 미확인 전제다 — `docs/ar-app-split-device-check.md` D1~D7.

## 범위 밖

대시보드가 같은 API 변경으로 프로덕션에서 죽어 있다(`upload_at` 무가드 참조).
사용자 결정으로 별도 작업. `CLAUDE.md` §8 에 기록해 뒀다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**스펙 커버리지**

| 스펙 절 | 태스크 |
|---|---|
| §4.1~4.3 관용 디코딩 | T2 Step 3 |
| §4.4 캐시 키 | T2 Step 4 |
| §5.1 잎만 담기 | T4 Step 3·4 |
| §5.2 3상태 | T4 Step 3·6 |
| §5.3 조인 판정 분리 | T4 Step 5·6 |
| §5.4 결정적 순서 | T3 |
| §6.1 kind/role 컬럼 | T5 Step 3, T7 Step 3 |
| §6.2 두 축 | T5 Step 5 |
| §6.3 라벨 규칙 | T5 Step 5 (`segments`) |
| §6.4 Node 필드 | T3 Step 3, T5 Step 4 |
| §6.5 축 전환 체크 유지 | T5 Step 1 (테스트), T6 Step 2 |
| §6.6 UI | T6 |
| §7.1 테스트 타겟 | T1 Step 1 |
| §7.2 케이스 13종 | T1·T2·T3·T4·T5 (총 23개로 분해) |
| §7.3 CI | T1 Step 6 |
| §7.4 대시보드 회귀 | T7 |
| §8.2 기기 검증 | T8 Step 2 |
| §9 범위 밖 기록 | T8 Step 3 |

빠진 스펙 요구 없음.

**타입 일관성 확인**

- `Node` 필드는 T3에서 `order` 추가 → T5에서 `kind`/`role`/`position` 추가. T5의 두 생성기 코드 블록이 **여섯 필드 전부**를 담고 있어 T3 버전과 충돌하지 않는다.
- `buildTree`는 T3에서 정렬을 넣고 T5에서 `axis:` 기본 인자와 함께 통째로 재작성된다. T3의 테스트가 `buildTree(t)`로 호출하므로 기본 인자 덕에 계속 컴파일된다.
- `allValues` 제거(T4) 후 호출부는 `PlacementViewModel` 3곳과 `RebarTreePad` 1곳뿐이며 모두 T4에서 `leafValues`로 교체된다.
- `matchCount` → `nodeCount` 이름 변경이 `RebarTreePad` 선언·사용부와 `ARPlacementView` 호출부에서 일치한다(T4 Step 6).
- `versionStamp`는 `ARModel`의 계산 프로퍼티(T2 Step 3)이고 `ModelFileStore`가 그것을 부른다(T2 Step 4). 테스트 타겟은 `BackendDTOs.swift`만 포함하므로 `ModelFileStore`(→`BackendClient`→URLSession)를 끌어오지 않는다.

**플레이스홀더 스캔**

"TBD"/"적절히"/"필요시" 없음. T1 Step 4의 "macOS가 없으면 미실행으로 보고" 는 회피가 아니라 **정직한 보고 지침**이다 — Windows 개발 환경이 실제 제약이고(CLAUDE.md §2), 은폐하지 말고 드러내라는 뜻이다.
