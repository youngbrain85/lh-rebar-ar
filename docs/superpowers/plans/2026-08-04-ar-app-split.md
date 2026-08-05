# AR 앱 분할 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하나의 AR 앱을 **연구과제 앱**과 **LH 전용 앱** 두 개로 나눈다.

> 초안에는 "3D 모델 투명도 조절 신규 개발"이 있었으나, 코드 확인 결과 **이미 완전히 구현돼 있다**
> (`PlacementViewModel.modelOpacity` → `ModelAnchorController.setOpacity`, 슬라이더는 `FineAdjustPad` 안).
> 발주처 표의 공통 기능 6개가 전부 이미 존재하므로 **이번 작업은 분할 하나다.**

**Architecture:** `project.yml`에 타겟을 하나 더 만든다. 두 타겟은 **같은 소스를 전부 포함**하고 번들 ID·표시명·컴파일 플래그 `LH_ONLY`만 다르다. `AppFeatures` 열거형이 플래그를 읽어 어떤 버튼을 보일지 정하고, `ARPlacementView`가 그것으로 UI를 가른다.

**Tech Stack:** Swift 5.9, SwiftUI, ARKit + RealityKit, xcodegen, GitHub Actions (macOS runner), App Store Connect API.

## Global Constraints

- **이 저장소가 있는 PC에서는 빌드할 수 없다.** `xcodegen`도 `xcodebuild`도 없다(Windows). 컴파일 검증은 **오직 CI**(`.github/workflows/ios-testflight.yml`, macOS runner)로만 가능하다.
- **Swift 테스트 타겟도 테스트 파일도 없다.** 단위 테스트를 새로 만들지 않는다(이 플랜의 범위 밖). 각 태스크의 검증은 (a) 로컬에서 가능한 정적 확인, (b) CI 빌드 성공, (c) 마지막에 기기 수동 확인이다.
- 번들 ID: 연구과제 `kr.lh.rebar-ar`(기존, **변경 금지**) · LH 전용 `kr.lh.rebar-lh`(신규).
- 표시명: 연구과제 `철근 AR 연구` · LH 전용 `LH 철근검측`.
- 컴파일 플래그는 `LH_ONLY` 하나뿐이다. 다른 플래그를 새로 만들지 않는다.
- Apple 팀 `G88CPAZ3MP`, 자동 서명, iOS 17.0.
- **굳은살 #1 — `UIRequiredDeviceCapabilities`에 `arkit`를 넣지 않는다.** visionOS가 거부한다(ITMS-90984).
- **굳은살 #10 — Swift 파일을 새로 추가하면 `xcodegen generate`를 다시 돌려야 컴파일된다.** 이 PC에서는 못 하므로 CI가 매번 새로 생성한다(워크플로가 이미 그렇게 한다).
- 커밋 메시지는 각 태스크 마지막 스텝 그대로. git 명령은 `D:\Projects\LH\AR`에서 실행.
- 한국어 주석. 주석은 *왜*를 설명한다.

## File Structure

| 파일 | 역할 | 태스크 |
|---|---|---|
| `LHRebarAR/App/AppFeatures.swift` | **신규.** 앱별 기능 스위치. 이 파일 하나만 보면 두 앱의 차이를 알 수 있어야 한다 | 1 |
| `project.yml` | 타겟 2개 정의 | 1 |
| `LHRebarAR/UI/Screens/ARPlacementView.swift` | 스위치를 읽어 버튼·배너·시트를 감춘다 | 2 |
| `.github/workflows/ios-testflight.yml` | 두 앱 중 선택해 빌드·업로드 | 3 |
| `CLAUDE.md` · `docs/ar-app-split-device-check.md` | 두 앱 체계 기록 · 기기 검증 체크리스트 | 4 |

---

### Task 1: AppFeatures + 두 번째 타겟

**Files:**
- Create: `LHRebarAR/App/AppFeatures.swift`
- Modify: `project.yml`
- Modify: `scripts/release.sh` (타겟이 둘이 되면 빌드번호 추출이 깨진다 — 아래 Step 3-b)

**Interfaces:**
- Produces: `AppFeatures.liveShare: Bool`, `AppFeatures.measurement: Bool`, `AppFeatures.rebarFilter: Bool`, `AppFeatures.appName: String`

- [ ] **Step 1: 브랜치 생성**

```bash
cd /d/Projects/LH/AR && git checkout main && git pull -q && git checkout -b feat/ar-app-split
```

- [ ] **Step 2: AppFeatures.swift 작성**

```swift
// LHRebarAR/App/AppFeatures.swift
import Foundation

/// 앱별 기능 스위치.
///
/// 발주처 요청(AR 앱 등 요청사항_260803.pdf)으로 앱을 둘로 나눈다. 두 타겟은 **같은 소스를
/// 전부** 포함하고, 이 파일의 `LH_ONLY` 플래그만으로 화면에 무엇을 보일지 가른다.
/// 두 앱의 차이를 알고 싶으면 이 파일만 보면 된다 — 다른 곳에 분기를 흩지 말 것.
enum AppFeatures {
    #if LH_ONLY
    /// 실시간 다자간 협업 — 연구과제 앱 전용
    static let liveShare = false
    /// 길이 측정 — LH 전용 앱 전용
    static let measurement = true
    /// 철근 종류별 필터링 — LH 전용 앱 전용 (아직 미구현)
    static let rebarFilter = true
    static let appName = "LH 철근검측"
    #else
    static let liveShare = true
    static let measurement = false
    static let rebarFilter = false
    static let appName = "철근 AR 연구"
    #endif
}
```

- [ ] **Step 3: project.yml에 두 번째 타겟 추가**

기존 `targets:` 블록의 `LHRebarAR:` 아래(같은 들여쓰기)에 `LHRebarARLH:`를 추가한다.

기존 `LHRebarAR` 타겟에서 바꾸는 것은 **`CFBundleDisplayName` 한 줄뿐**이다 —
`LH Rebar AR` → `철근 AR 연구`. 두 앱이 홈 화면에서 구별되지 않으면 분할의 의미가 없고,
표시명은 번들 ID·서명·TestFlight 이력 어디에도 영향을 주지 않는다.
**그 외에는 한 글자도 바꾸지 않는다** — 빌드 32까지 나간 앱이므로 회귀 위험을 만들지 않는다.

새 타겟은 기존 타겟과 다음만 다르다:

| 항목 | 값 |
|---|---|
| `PRODUCT_BUNDLE_IDENTIFIER` | `kr.lh.rebar-lh` |
| `CFBundleDisplayName` | `LH 철근검측` |
| `SWIFT_ACTIVE_COMPILATION_CONDITIONS` | `$(inherited) LH_ONLY` |
| `CFBundleVersion` / `CURRENT_PROJECT_VERSION` | `1` (새 앱이므로 1부터) |
| `info.path` | `LHRebarAR/Info-LH.plist` |

`info:`는 입력이 아니라 **xcodegen이 plist를 생성하는 출력 경로**다. 두 타겟이 한 경로를
공유하면 나중에 처리되는 쪽이 덮어써서 표시명·빌드번호가 순서에 좌우된다. 새 디렉터리를
만들지 않고 기존 `LHRebarAR/` 안에 두는 이유는, 그 디렉터리가 이미 존재하고(생성 실패
위험이 없다) 기존 `LHRebarAR/Info.plist`와 같은 추적 관례에 놓이기 때문이다.
`LHRebarAR/`은 `sources` 경로가 아니므로(소스는 `LHRebarAR/App`, `/AR`, … 하위만)
빌드 페이즈에 딸려 들어가지 않는다.

나머지(`sources`, `dependencies`, `deploymentTarget`, `info.properties`의 다른 키, `settings`의
`TARGETED_DEVICE_FAMILY`·`DEVELOPMENT_TEAM`·`CODE_SIGN_STYLE`·`ASSETCATALOG_*`·`MARKETING_VERSION`
·`SUPPORTS_MACCATALYST`)는 기존 타겟과 **동일한 값**을 그대로 적는다. xcodegen에는 타겟 상속이
없으므로 복제가 정상이다.

`info.properties`에는 기존 타겟의 모든 키를 그대로 넣는다 — `NSMicrophoneUsageDescription`도
포함한다. 협업 코드가 바이너리에 남아 있으므로 권한 문구를 빼면 오히려 불일치가 된다.

`LSRequiresIPhoneOS`, `NSAppTransportSecurity`, `UISupportedInterfaceOrientations`,
`UIRequiresFullScreen`, `ITSAppUsesNonExemptEncryption`, `UIApplicationSceneManifest`,
`UILaunchScreen`, `NSCameraUsageDescription`, `NSPhotoLibraryAddUsageDescription`을 빠뜨리지 말 것.
하나라도 빠지면 심사나 런타임에서 문제가 된다.

- [ ] **Step 3-b: scripts/release.sh의 빌드번호 추출을 고친다**

타겟이 둘이 되면 `CURRENT_PROJECT_VERSION` 줄이 두 개가 되어 아래가 깨진다(`"32
1"`을 산술에
넘겨 `set -euo pipefail`에서 즉시 종료된다). Mac 릴리스 경로(CLAUDE.md §6)라 이 플랜의 다른
태스크가 소유하지 않으므로 여기서 함께 고친다.

`scripts/release.sh`의 아래 줄을

```bash
CURRENT=$(grep -E "^\s*CURRENT_PROJECT_VERSION:" project.yml | awk '{print $2}' | tr -d '"')
```

이렇게 바꾼다 — 연구과제 타겟 값만 명시적으로 읽는다:

```bash
# 타겟이 둘이라 grep으로는 두 값이 잡힌다. 이 스크립트는 연구과제 앱 릴리스용이다.
CURRENT=$(python3 -c "import yaml;print(yaml.safe_load(open('project.yml',encoding='utf-8'))['targets']['LHRebarAR']['settings']['base']['CURRENT_PROJECT_VERSION'])")
```

바로 아래의 `MARKETING_VERSION`/`CFBundleShortVersionString` `sed`는 `.*` 패턴이라 **두 타겟
모두** 치환한다. 지금은 둘 다 `0.1.0`이라 결과가 같으므로 **건드리지 않는다** — 두 앱의 마케팅
버전을 따로 가져갈지는 아직 정해진 바 없고, 정해지기 전에 미리 갈라두면 추측이 된다.

- [ ] **Step 4: YAML 유효성과 값 대조 (이 PC에서 가능한 유일한 검증)**

```bash
cd /d/Projects/LH/AR && python -c "
import yaml, io, sys
d = yaml.safe_load(io.open('project.yml', encoding='utf-8'))
t = d['targets']
assert set(t) == {'LHRebarAR', 'LHRebarARLH'}, t.keys()
a, b = t['LHRebarAR'], t['LHRebarARLH']
# 소스 목록이 완전히 같아야 한다 (같은 소스를 전부 포함하는 것이 이 설계의 전제)
assert a['sources'] == b['sources'], 'sources differ'
assert a['dependencies'] == b['dependencies'], 'dependencies differ'
sa, sb = a['settings']['base'], b['settings']['base']
assert sb['PRODUCT_BUNDLE_IDENTIFIER'] == 'kr.lh.rebar-lh'
assert sa['PRODUCT_BUNDLE_IDENTIFIER'] == 'kr.lh.rebar-ar', 'existing bundle id changed!'
assert 'LH_ONLY' in sb['SWIFT_ACTIVE_COMPILATION_CONDITIONS']
assert 'SWIFT_ACTIVE_COMPILATION_CONDITIONS' not in sa, 'flag leaked into the research target'
# Info.plist 키가 하나도 빠지지 않았는지
ka, kb = set(a['info']['properties']), set(b['info']['properties'])
assert ka == kb, f'plist keys differ: {ka ^ kb}'
assert b['info']['properties']['CFBundleDisplayName'] == 'LH 철근검측'
print('OK — 타겟 2개, 소스 동일, 번들 ID/플래그/표시명 정상')
"
```

Expected: `OK — ...` 출력. 실패하면 메시지가 가리키는 항목을 고친다.

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add project.yml LHRebarAR/App/AppFeatures.swift
git commit -m "feat: add LH-only app target with a feature switch"
```

---

### Task 2: 기능 게이팅

**Files:**
- Modify: `LHRebarAR/UI/Screens/ARPlacementView.swift`

**Interfaces:**
- Consumes: `AppFeatures.liveShare`, `AppFeatures.measurement` (Task 1)

- [ ] **Step 1: 감출 지점을 모두 찾는다**

```bash
cd /d/Projects/LH/AR && grep -n "measurement\|liveShare\|micToggle" LHRebarAR/UI/Screens/ARPlacementView.swift
```

측정과 협업에 딸린 UI는 버튼만이 아니다. 아래를 **전부** 처리한다:

| 대상 | 위치(기준) | 소속 |
|---|---|---|
| `measurementToggle` (툴바 호출부) | 툴바 `VStack` 안 | 측정 |
| `measurementPlusButton` | 화면 하단 | 측정 |
| 측정 이름 입력 `.alert("측정 이름", …)` | 뷰 수식자 | 측정 |
| 측정 HUD·라벨·레티클 관련 오버레이 | 본문 여러 곳 | 측정 |
| `liveShareToggle` (툴바 호출부) | 툴바 `VStack` 안 | 협업 |
| `if liveShare.isSharing { micToggle }` | 툴바 `VStack` 안 | 협업 |
| `liveShareBanner` | 상단 배너 스택 | 협업 |
| 오피스 핑·메모 수신 표시 | 협업 상태에 딸린 것 | 협업 |

- [ ] **Step 2: 툴바 호출부를 감싼다**

툴바 `VStack` 안이 현재 아래와 같다:

```swift
            #if DEBUG
            diagnosticsToggle
            meshToggle
            #endif
            measurementToggle
            liveShareToggle
            if liveShare.isSharing { micToggle }
            if placementActive { relockButton }
```

이렇게 바꾼다:

```swift
            #if DEBUG
            diagnosticsToggle
            meshToggle
            #endif
            // 발주처 요청으로 앱을 둘로 나눴다 — 어느 앱에 무엇이 보이는지는 AppFeatures 한 곳에서 정한다
            if AppFeatures.measurement { measurementToggle }
            if AppFeatures.liveShare {
                liveShareToggle
                if liveShare.isSharing { micToggle }
            }
            if placementActive { relockButton }
```

재고정(`relockButton`)과 삭제(`removeButton`)는 **양쪽 앱 모두 유지**한다. 발주처 표에는 없지만
마커리스 방식에서 유일한 드리프트 보정 수단이라, 빼면 그 위에서 재는 값이 함께 틀어진다.

- [ ] **Step 3: 나머지 측정·협업 UI를 감싼다**

Step 1에서 찾은 나머지 지점을 각각 `if AppFeatures.measurement { … }` / `if AppFeatures.liveShare { … }`로 감싼다. 뷰 수식자(`.alert`, `.sheet` 등)는 `if`로 감쌀 수 없으므로 조건을 안에 넣는다:

```swift
        .alert("측정 이름", isPresented: Binding(
            get: { AppFeatures.measurement && showNamePrompt },
            set: { showNamePrompt = $0 }
        )) { … }
```

`@StateObject private var measurement`와 `liveShare`는 **그대로 둔다.** 객체 생성 자체는 비용이
없고, 제거하면 참조가 줄줄이 깨진다. 화면에 보이지 않게 하는 것이 목적이다.

- [ ] **Step 4: 게이팅 누락 정적 확인**

```bash
cd /d/Projects/LH/AR && python -c "
import io, re
s = io.open('LHRebarAR/UI/Screens/ARPlacementView.swift', encoding='utf-8').read()
body = s
# 호출부(정의가 아닌 곳)가 게이트 안에 있는지 눈으로 확인할 목록을 뽑는다
for name in ['measurementToggle', 'measurementPlusButton', 'liveShareToggle', 'micToggle', 'liveShareBanner']:
    uses = [i+1 for i, L in enumerate(body.splitlines())
            if name in L and 'private var' not in L]
    print(f'{name:24} 호출부 줄: {uses}')
print()
print('AppFeatures 게이트 줄:', [i+1 for i, L in enumerate(body.splitlines()) if 'AppFeatures.' in L])
"
```

출력된 각 호출부가 `AppFeatures` 게이트 안에 들어 있는지 파일을 열어 직접 확인한다. 이 PC에는
컴파일러가 없으므로 **이 육안 확인이 유일한 방어선**이다.

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add LHRebarAR/UI/Screens/ARPlacementView.swift
git commit -m "feat: hide measurement in the research app and live share in the LH app"
```

---

### Task 3: CI로 두 앱 빌드 — **첫 컴파일 검증**

**Files:**
- Modify: `.github/workflows/ios-testflight.yml`

이 태스크가 **Task 1~2의 코드가 컴파일되는지 확인하는 첫 지점**이다. 이 PC에는 컴파일러가 없다.

- [ ] **Step 1: 워크플로에 앱 선택 입력 추가**

`workflow_dispatch:` 아래에 입력을 더한다:

```yaml
  workflow_dispatch:
    inputs:
      app:
        description: "빌드할 앱"
        required: true
        default: "research"
        type: choice
        options: [research, lh, both]
      upload:
        description: "TestFlight에 업로드 (끄면 빌드만)"
        required: true
        default: "false"
        type: choice
        options: ["true", "false"]
```

`upload: false`가 필요한 이유 — LH 앱은 ASC에 앱 레코드가 만들어지기 전까지 업로드할 수 없다.
그동안에도 **컴파일 검증은 해야 한다.**

- [ ] **Step 2: 스킴별로 빌드하도록 바꾼다**

현재 아카이브 단계가 `-scheme LHRebarAR` 하나로 고정돼 있다. 앱마다 스킴·번들 ID·아카이브 경로가
달라야 하므로 매트릭스로 돌린다:

```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
          - app: research
            scheme: LHRebarAR
            bundle: kr.lh.rebar-ar
          - app: lh
            scheme: LHRebarARLH
            bundle: kr.lh.rebar-lh
```

그리고 건너뛰기 조건을 둔다. **잡 레벨 `if:`에는 쓸 수 없다** — `matrix` 컨텍스트가 거기서는
사용 불가라 디스패치 자체가 HTTP 422로 거부된다(실측 확인). 각 **스텝**에 건다:

```yaml
        if: ${{ github.event.inputs.app == 'both' || github.event.inputs.app == matrix.app }}
```

빌드 번호 조회는 `scripts/next_build.py`를 그대로 쓴다 — **이미 `BUNDLE_ID` 환경변수를 받는다**
(기본값 `kr.lh.rebar-ar`). 매트릭스 값을 넘기기만 하면 된다:

```yaml
        env:
          BUNDLE_ID: ${{ matrix.bundle }}
```

아카이브·익스포트 경로에서 `LHRebarAR`을 `${{ matrix.scheme }}`로 바꾼다. `ExportOptions.plist`는
자동 서명이라 앱과 무관하므로 그대로 쓴다.

업로드 단계에는 `if: github.event.inputs.upload == 'true'`를 건다.

- [ ] **Step 3: 커밋 후 푸시하고 빌드만 실행**

```bash
cd /d/Projects/LH/AR && git add .github/workflows/ios-testflight.yml
git commit -m "ci: build either app from one workflow"
git push -u origin feat/ar-app-split
gh workflow run ios-testflight.yml --ref feat/ar-app-split -f app=both -f upload=false
```

- [ ] **Step 4: 결과 확인 — 여기서 Task 1~2의 컴파일 오류가 처음 드러난다**

```bash
cd /d/Projects/LH/AR && gh run list --workflow=ios-testflight.yml --limit 1
gh run watch
```

두 잡 모두 성공해야 한다. 실패하면 로그를 읽고 원인 태스크로 돌아가 고친다. 특히 확인할 것:

- `LHSpacing`/`LHTypography`/`LHColors`의 없는 멤버 → Task 3 Step 3에서 실제 이름으로 바꾼다
- 게이팅한 `if` 안에서 타입 추론이 깨진다 → SwiftUI `ViewBuilder`가 `if` 분기를 허용하는 위치인지 확인한다

**이 단계를 통과할 때까지 다음 태스크로 넘어가지 않는다.**

---

### Task 4: 문서 갱신 + 기기 검증 체크리스트

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/ar-app-split-device-check.md`

- [ ] **Step 1: CLAUDE.md에 두 앱 체계를 기록한다**

§1 표에 LH 전용 앱 행을 더하고, §9 외부 계정 표에 새 번들 ID를 더한다. §6 워크플로 절에 새 CI 입력
(`app`, `upload`)을 적는다. §5 굳은살에 한 줄 더한다:

```markdown
12. **앱이 두 개다 — 기능 차이는 `AppFeatures.swift` 한 곳에만 둔다.** 발주처 요청으로 연구과제
    앱(`kr.lh.rebar-ar`)과 LH 전용 앱(`kr.lh.rebar-lh`)으로 나뉘어 있다. 두 타겟은 **같은 소스를
    전부** 포함하고 `LH_ONLY` 플래그 하나로 갈린다. 새 기능을 앱별로 다르게 하려면 `AppFeatures`에
    스위치를 더하고 화면에서 그걸 읽는다. `#if LH_ONLY`를 화면 코드에 흩뿌리지 말 것 — 두 앱의
    차이를 한 파일에서 볼 수 없게 되는 순간 유지가 어려워진다.
```

- [ ] **Step 2: 기기 검증 체크리스트 작성**

`docs/ar-app-split-device-check.md`에 아래를 쓴다. 시뮬레이터에는 ARKit이 없어 **기기 확인이
필수**이고, 이 저장소가 있는 PC에서는 불가능하므로 사용자가 수행한다.

```markdown
# AR 앱 분할 — 기기 검증 체크리스트

두 앱을 같은 iPhone/iPad(LiDAR 탑재)에 설치한 뒤 확인한다. 각 항목은 화면 캡처로 근거를 남긴다.

| # | 확인 | 기대 |
|---|---|---|
| 1 | 홈 화면 | 두 앱이 **각각 별도 아이콘**으로 존재 (`철근 AR 연구`, `LH 철근검측`) |
| 2 | 두 앱 동시 실행 | 번들 ID 충돌 없이 각각 실행됨 |
| 3 | LH 앱 툴바 | 공유(shareplay) 버튼이 **없음**, 자(ruler) 버튼이 **있음** |
| 4 | 연구과제 앱 툴바 | 자 버튼이 **없음**, 공유 버튼이 **있음** |
| 5 | 양쪽 공통 | 현장 선택 → 모델 선택 → 배치가 동작 |
| 6 | 양쪽 공통 | 미세조정(mm/0.1°), 재고정(scope), 삭제가 동작 |
| 7 | 양쪽 공통 | 화면 캡쳐가 사진에 저장됨 |
| 8 | 양쪽 공통 | 미세조정 패드의 **투명도 슬라이더**가 모델을 실제로 반투명하게 만듦 (기존 기능) |
| 9 | 투명도 | 기본값 70%로 배치 직후부터 반투명 |
| 10 | LH 앱 | 측정이 정상 동작 (실↔실, 모델↔실) |
| 11 | 연구과제 앱 | 공유가 정상 동작 (오피스 대시보드에서 화면이 보임) |

실패 항목이 있으면 그대로 기록한다. "대체로 동작함"으로 넘기지 않는다.
```

- [ ] **Step 3: 커밋하고 PR을 연다**

```bash
cd /d/Projects/LH/AR && git add CLAUDE.md docs/ar-app-split-device-check.md
git commit -m "docs: two-app scheme and device verification checklist"
git push
gh pr create --title "feat: AR 앱 분할 — 연구과제 앱 / LH 전용 앱" --body "발주처 요청사항 2 반영. 두 타겟이 같은 소스를 전부 공유하고 AppFeatures 스위치 하나로 화면을 가른다. 연구과제 앱은 협업, LH 전용 앱은 길이 측정. 재고정·삭제는 양쪽 유지(표에 없지만 마커리스에서 유일한 드리프트 보정). CI에서 두 앱 모두 빌드 확인 완료. 기기 검증은 docs/ar-app-split-device-check.md 참조."
```

---

## 사용자가 해야 하는 단계 (구현 중 언제든 병행 가능)

이 두 가지는 **계정 소유자만** 할 수 있어 이 플랜에 태스크로 넣을 수 없다.

1. **Apple Developer → Identifiers**에서 번들 ID `kr.lh.rebar-lh` 등록
2. **App Store Connect → 새 앱** 생성 (해당 번들 ID, 이름 `LH 철근검측`) 후 ASC App ID 공유

둘 다 끝나기 전에는 Task 4의 CI를 `upload=false`로만 돌린다. 끝난 뒤 `upload=true`로 다시 돌리면
TestFlight에 올라간다.

## 다음 작업 (이 플랜 범위 밖)

- **철근 종류별 필터링 (LH 전용)** — 착수 전 **BriconLab USDZ가 철근별 노드로 나뉘어 있는지 확인 필요.**
  통짜 메시면 앱에서는 불가능하고 모델 생성 단계에 요청해야 한다. `AppFeatures.rebarFilter`는 이미
  자리를 잡아 두었다.
- **오차 시각화 (연구과제)** — 대시보드 분석 결과를 AR로 겹치는 기능. 별도 설계 필요.
