# LH Rebar AR — Project Context

Auto-loaded by Claude Code in this directory. It carries decisions, hard-won
gotchas, and the current plan across machines/sessions so a fresh session can
continue without re-deriving anything.

**Last updated**: 2026-08-05 · branch `feat/ar-app-split` (PR #14, open, not merged) splitting
the app into 철근 AR 연구 (`kr.lh.rebar-ar`) + LH 철근검측 (`kr.lh.rebar-lh`) — see §1 · research
app build 33 already on ASC (`next_build.py` returns 34; processing state not re-checked here) ·
LH app not yet uploaded, ASC record not yet registered (§9) · CI green for both apps' compile at
HEAD, nothing run on a device yet · dashboard live on Vercel.

---

## 1. What this project is

Two shipped pieces that work together for on-site rebar QA:

| Piece | What it is | Where it runs |
|---|---|---|
| **철근 AR 연구** (iOS, `kr.lh.rebar-ar`) | Research-project field app: overlays the design rebar model on the real structure, measures, captures evidence, shares its AR screen live | iPhone/iPad w/ LiDAR, distributed via TestFlight |
| **LH 철근검측** (iOS, `kr.lh.rebar-lh`) | LH-only field app: same AR placement/adjustment/visual-lock/measurement core as the research app, but no live collaboration | iPhone/iPad w/ LiDAR, distributed via TestFlight |
| **office-dashboard** (Next.js) | Office console: site management, 3D model viewer, live AR collaboration (watch + talk + annotate) | https://office-dashboard-xi.vercel.app |

Both iOS apps are built from **one Xcode project, two targets** (`LHRebarAR` /
`LHRebarARLH`) sharing all source files; a single compile-time flag decides which
screens each shows — see `AppFeatures.swift` and gotcha #13 in §5. The client's
feature table put 길이 측정 (length measurement) under LH-only, but it's an
existing, field-verified feature — the team decided (2026-08-05) to keep it in
the research app too rather than take that as a net loss. The two apps' only
remaining functional difference is 실시간 협업 (live collaboration) and
**철근 계층(부위/면/방향)별 필터** (`AppFeatures.rebarFilter`, LH app only —
built 2026-08-05, not yet device-verified). Note the axis: the client's feature
table said "철근 종류별 필터링" (main bar / stirrup / tie); what exists is the
**부위 계층** (전벽/저판/헌치 × 면 × 방향). The 종류 axis is still unbuilt.

Data comes from the **BriconLab backend** (`http://api.briconlab.com:50001`).
Live video/audio/data runs over **LiveKit Cloud** (`wss://ar-w5h0quhi.livekit.cloud`).

---

## 2. Setup on a new machine (READ FIRST)

### Windows vs macOS — what runs where

| Task | Windows | macOS |
|---|---|---|
| Edit Swift / TS / Python, git | ✅ | ✅ |
| **office-dashboard** dev + `vercel deploy` | ✅ | ✅ |
| Python helpers (token, build status) | ✅ | ✅ |
| **iOS build / archive / TestFlight upload** | ❌ Xcode is macOS-only | ✅ |

**To release the iOS app from Windows (no local Mac): use the CI.** The GitHub
Actions workflow `.github/workflows/ios-testflight.yml` builds either or both
apps on a macOS runner, and optionally uploads to TestFlight — see §6 → Ship
an iOS build for the exact command and its two inputs (`app`, `upload`). It
needs the repo secrets listed in §6 → CI (notably an **Admin** ASC API key —
the upload-only key `5J8MLZ4426` cannot cloud-sign). Local `scripts/release.sh`
is the Mac-only equivalent (research app only; it does not yet know about the
LH target).

### Secrets to restore

Secrets are gitignored, so a fresh clone does **not** build/run until you restore
them. Bring these over from the original machine (1Password/AirDrop/etc — never
commit them):

```
secrets/livekit.env                        # LIVEKIT_URL / API_KEY / API_SECRET
office-dashboard/.env.local                # same three (NEXT_PUBLIC_LIVEKIT_URL + key + secret)
office-dashboard/.env.local                # + BLOB_READ_WRITE_TOKEN (시공 분석)
                                           #   SCAN_UPLOAD_TOKEN은 선택 — 넣으면 업로드에 Bearer 인증이 켜진다
LHRebarAR/Services/LiveShareConfig.swift   # copy from LiveShareConfig.swift.example, fill in
```

**iOS:**
```bash
brew install xcodegen                # if missing — .xcodeproj is generated, not committed
cd lh-rebar-ar && xcodegen generate
open LHRebarAR.xcodeproj
```
Signing uses team `G88CPAZ3MP`, bundle `kr.lh.rebar-ar`, automatic signing.
App Store Connect API key must exist at `~/.appstoreconnect/private_keys/AuthKey_5J8MLZ4426.p8`
for `scripts/release.sh` and `scripts/build_status.py` to work.

**Dashboard:**
```bash
cd office-dashboard && npm install && npm run dev     # → http://localhost:3000
npx vercel login                                       # to deploy
```

**Python helpers** (`api/livekit_token.py`, `scripts/build_status.py`) use a
`.venv` at the repo root with `pyjwt`:
```bash
python3 -m venv .venv && .venv/bin/pip install pyjwt
```

---

## 3. Current status

### iOS app — build 27 (0.1.0) on TestFlight, VALID

Working and verified on device:
- **Model placement** — tap to place USDZ; raycast priority LiDAR mesh → plane → estimated plane
- **Coarse gestures** (1-finger pan XZ, 2-finger yaw) + **fine adjustment** (mm / 0.1° steps, undo/redo, integer-stored)
- **Re-anchoring** — on every adjustment commit, the model is re-anchored at its current pose (kills lever-arm drift)
- **Visual lock (재고정)** — scope button: ICP-aligns the current LiDAR scan to a datum captured at commit time and snaps the model back onto the real structure. **Real-scan ↔ real-scan only; the design model is never matched against anything.**
- **Measurement** — Apple-Measure-style reticle + `+` button; real↔real and **model↔real** (green reticle = model surface); total + horizontal/vertical breakdown; per-measurement **name** prompt; compact white label showing `#N 283mm` offset perpendicular to the line
- **Screen capture** — snapshot + footer annotation listing named measurements → Photos
- **Backend** — site list → model list → USDZ download/cache → AR
- **Live share** — in-app ReplayKit capture → LiveKit; per-site rooms (`site-<id>`); **video-first, mic is an opt-in toggle** (mic never blocks the share — see gotcha #11); two-way voice; receives office pings (2D) and memos (world-locked 3D pins)
- **Model origin** — every loaded model is re-pivoted to the **bottom-center of its bbox** (concrete base bottom face) at load time (`ModelLoader.normalizedToBottomCenter`), so it sits on the tapped surface regardless of source authoring

### Dashboard — deployed, permanent URL

`https://office-dashboard-xi.vercel.app` (Vercel project `office-dashboard`, alias is stable)
- Mantine 9 UI, BriconLab navy `#002961` + white
- **현장 관리**: site table from BriconLab, 🔴 LIVE badge (polls `/api/live` every 6s), 3D model drawer, three.js USDZ viewer
- **라이브 협업**: field screen at native aspect (`object-contain`), participants, 🎤 talk-back, click-to-annotate (포인터 / 📌 메모 modes), clear-memos
- **시공 분석**: as-built 스캔(철근 중심선 JSON) 업로드 → 브라우저 메인스레드에서 설계모델과
  정합(PCA+ICP)·철근별 매칭 → 미시공/허용초과/도면외 판정 + 3D 오버레이.
  간격·방향은 설계모델에서 뽑아낸 **방향군**(수직 철근뿐 아니라 경사진 벽체 주철근·45° 헌치
  사재도 포함) 기준으로 계산한다. 판정 임계선 대신, KDS 10 20 50에 간격 오차 기준이 없다는
  점 때문에 **편차 크기를 5단계 색으로 칠하는 컨투어 지도**(사용자 지정 상한, 기본 지표는
  간격 편차·토글로 위치 편차)를 벽면에 띄운다.
  스토리지는 Vercel Blob (BriconLab 이관 스펙: `api/SCAN_STORAGE_REQUEST.md`).
  데모 업로드: `node office-dashboard/scripts/make-demo-scan.mjs --upload <url> --site 5`

---

## 4. Architecture notes

### iOS entity tree
```
AnchorEntity(world:)          ← world-fixed (NOT ARAnchor-backed — see gotchas)
  └── placementRoot           ← all adjustment transforms applied HERE
       └── modelEntity (USDZ)
```

### Key files
| Area | File |
|---|---|
| AR session | `LHRebarAR/AR/ARSessionManager.swift`, `ARViewContainer.swift` |
| Anchoring | `AR/ModelAnchorController.swift` (place, reanchor, collision install) |
| Visual lock | `AR/VisualLockService.swift` (mesh extraction + point-to-plane ICP) |
| Office memos | `AR/MemoAnnotationController.swift` (3D pins) |
| Measurement | `Measurement/MeasurementController.swift` (+ ViewModel, DistanceMeasurement) |
| Placement | `Placement/PlacementViewModel.swift`, `FineAdjustmentViewModel.swift`, `GestureCoordinator.swift` |
| Backend | `Backend/BackendClient.swift`, `ModelFileStore.swift`, `BackendDTOs.swift` |
| Live share | `Services/LiveShareService.swift`, `LiveShareConfig.swift` (gitignored) |
| Capture | `Services/ScreenCaptureService.swift` |
| Main AR screen | `UI/Screens/ARPlacementView.swift` (large — all overlays wired here) |

### 디자인 시스템

브리콘랩 납품 화면 공통 규칙: `docs/design-system.md`.
드롭인 스타일시트와 로고 자산은 대시보드가 호스팅한다 —
`https://office-dashboard-xi.vercel.app/brand/briconlab.css`,
`/brand/briconlab-logo.png`(워드마크), `/brand/briconlab-symbol.png`(심볼),
`/brand/briconlab-icon-512.png`(아이콘 소스).
라이다 스캔 앱 등 다른 도구도 이 문서·자산을 따른다. 판정 색(정상/허용초과/
미시공/도면외)은 앱 간 반드시 동일해야 하므로, 바꿀 때는 문서와 두 앱을 함께 고친다.

### Dashboard routes
| Route | Purpose |
|---|---|
| `/api/token` | Mints LiveKit JWT server-side (`room`, `identity`, `name` params). **Secret never reaches the client.** |
| `/api/sites` | Proxy → BriconLab `analysis/site-list` |
| `/api/models?site_id=` | Proxy → `analysis/ar-list` |
| `/api/model?ar_id=` | Streams USDZ → `analysis/usdz` (proxy exists to dodge HTTPS→HTTP mixed content) |
| `/api/live` | Lists active LiveKit rooms (for LIVE badges) |
| `/api/scan-upload` | POST — 라이다 앱의 as-built 업로드 → Vercel Blob. **인증은 선택**: `SCAN_UPLOAD_TOKEN`이 설정돼 있으면 Bearer 일치를 요구하고, 없으면 누구나 업로드 가능(현재 테스트 운영 모드). 실운영 전환 시 환경변수만 다시 설정하면 잠긴다 |
| `/api/scans?site_id=` | 사이트별 스캔 목록 (Blob meta.json 취합) |
| `/api/scan?site_id=&scan_id=` | 스캔 파일 URL 해석 (rebars/mesh) |
| `/api/analysis-result?site_id=&scan_id=` | PUT/GET 분석결과 JSON |

### Annotation data protocol (LiveKit data channel, topic `annotation`)
```jsonc
{"type":"ping","u":0.5,"v":0.4}                       // transient 2D marker
{"type":"memo","u":0.5,"v":0.4,"text":"피복 확인"}      // world-locked 3D pin
{"type":"clearMemos"}                                  // remove all pins
```
`u,v` are normalized to the **video content** (letterboxing excluded). The shared
screen is the device screen, so the field app raycasts that point directly.

---

## 5. Hard-won gotchas (do not regress these)

1. **Do NOT add `arkit` to `UIRequiredDeviceCapabilities`** — visionOS rejects it (ITMS-90984). LiDAR is enforced at runtime instead.
2. **Never bind the model to an ARAnchor — use `AnchorEntity(world:)`** in BOTH `place()` and `reanchor()`. ARAnchor-backed content (a) sits at the world origin until ARKit reports the anchor next frame — a synchronous read of the fine-adjust base / visual-lock datum in that window captures garbage; and (b) is only rendered while the anchor is actively *tracked*, so in low-feature / narrow spaces the model appears for a few seconds then **vanishes** as ARKit relocalizes. World anchors have neither problem; drift is handled by re-anchoring + visual lock. (Three separate field-reported bugs traced to this — teleport-on-adjust, blink-on-reanchor, vanish-in-narrow-space.)
3. **Setting `@State` synchronously inside `makeUIView`/`onViewReady` is unreliable** — the write can be dropped. Defer with `DispatchQueue.main.async`. (This silently broke the capture button: `arViewRef` stayed nil so the guard returned with zero feedback.)
4. **USDZ from the backend is Z-up.** RealityKit honors the `upAxis` metadata and renders it correctly — verified on device. Do not "fix" it.
5. **three.js needs `USDLoader`, not `USDZLoader`** (deprecated in r179+), and BriconLab serves `.usdz` (the old `/analysis/fbx` endpoint is gone → 404).
6. **Next dev server blocks cross-origin requests** — a tunneled/proxied host hangs on a loading spinner until the origin is added to `allowedDevOrigins` in `next.config.ts`.
7. **ASC `filter[bundleId]` is a loose prefix match** — `kr.lh.rebar-ar` also returns the sibling app `kr.lh.rebarcapture`. `scripts/build_status.py` filters for the exact match; keep it that way.
8. **Apple agreement expiry blocks uploads** with a misleading `Cannot determine the Apple ID from Bundle ID` / HTTP 403 `REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`. Fix: accept the new agreement in App Store Connect → Business, then retry (propagation can lag a few minutes). Distribution certs/profiles also expire yearly — export now uses automatic signing + `-allowProvisioningUpdates`.
9. **Freshly minted LiveKit tokens can 401 once** (clock skew). `LiveShareService` retries the same token after 1.5s before falling back to the static demo token.
10. **Adding a new Swift file requires `xcodegen generate`** before it compiles — a "cannot find X in scope" error on a brand-new file usually means the project wasn't regenerated.
11. **Do NOT enable the mic at LiveKit connect.** `ConnectOptions(enableMicrophone: true)` starts the audio engine during connect and can throw "Audio engine returned error code: -9000" on some devices/routes (Bluetooth, first-run permission race, init timing — LiveKit issue #849 family), which aborted the entire screen share. The mic is now **opt-in**: `LiveShareService.toggleMic()` enables it separately and swallows failures. Screen sharing must always work without the mic. (If robust always-on two-way voice is ever needed, set `AudioManager.shared.sessionConfiguration` explicitly — `.playAndRecord` / `.videoChat` / `.allowBluetooth` — instead of reverting this.)
12. **컨투어 텍스처는 `NearestFilter`로 둔다.** 선형 보간을 켜면 색이 섞여 단계 경계가 사라지고, "몇 단계인가"를 눈으로 셀 수 없게 된다. 보간은 값(IDW)에서 이미 끝났고 색은 계단이어야 한다.
13. **앱이 두 개다 — 기능 차이는 `AppFeatures.swift` 한 곳에만 둔다.** 발주처 요청으로 연구과제
    앱(`kr.lh.rebar-ar`)과 LH 전용 앱(`kr.lh.rebar-lh`)으로 나뉘어 있다. 두 타겟은 **같은 소스를
    전부** 포함하고 `LH_ONLY` 플래그 하나로 갈린다. 새 기능을 앱별로 다르게 하려면 `AppFeatures`에
    스위치를 더하고 화면에서 그걸 읽는다. `#if LH_ONLY`를 화면 코드에 흩뿌리지 말 것 — 두 앱의
    차이를 한 파일에서 볼 수 없게 되는 순간 유지가 어려워진다.

14. **CI는 실행마다 개발 인증서를 새로 만든다 — 고정 인증서를 시크릿에 넣어 막는다.**
    `xcodebuild archive`는 자동 서명 + Release 조합에서 **개발(Development) 서명**으로 아카이브를
    만들고(배포 서명은 `-exportArchive`에서 다시 입힌다), 러너 키체인은 매 실행 비어 있으므로
    `-allowProvisioningUpdates`가 Apple에 개발 인증서를 새로 요청한다. Apple의 인증서 한도에 걸리면
    아카이브가 이 오류로 죽는다 — 메시지가 "certificate"라고만 해서 배포 인증서 문제로 오해하기 쉽지만
    두 번째 줄이 **`iOS App Development` provisioning profiles**라고 정확히 말해준다:
    ```
    error: Choose a certificate to revoke. Your account has reached the maximum number of certificates.
    error: No profiles for 'kr.lh.rebar-ar' were found: Xcode couldn't find any
           iOS App Development provisioning profiles matching 'kr.lh.rebar-ar'.
    ```
    2026-08-06 실측: ASC 인증서 15개 중 **10개가 `Created via API` 개발 인증서**였고 생성 시각이 CI 실행
    10회와 하나씩 대응했다(배포 인증서는 사람 것 1개 그대로). 그 10개는 개인키가 러너와 함께 사라져
    아무도 못 쓰는 껍데기다. 폐기 후 `scripts/asc_cert.py create --type DEVELOPMENT`로 고정 인증서를
    하나 만들어 `IOS_DIST_CERT_P12`/`IOS_DIST_CERT_PASSWORD` 시크릿에 넣었다(`RBHF959AY5`). 검증:
    고정 인증서 도입 후 실행에서 **인증서 개수가 늘지 않았다**.
    - 인증서 관리는 `scripts/asc_cert.py list|create|revoke` — **Mac 없이 Windows에서 된다**(openssl + pyjwt + cryptography).
    - `Jisoo Park` 이름의 인증서는 사람 것이다. **폐기하지 말 것.**
    - `.p12`가 만료(1년)되면 같은 방법으로 다시 만들어 시크릿만 교체한다.

---

## 6. Workflows

### Ship an iOS build
**On a Mac:**
```bash
bash scripts/release.sh          # 연구과제 앱(LHRebarAR)만 — bumps build, xcodegen, archive, export, upload
.venv/bin/python scripts/build_status.py <build>   # poll until VALID (research app, default BUNDLE_ID)
BUNDLE_ID=kr.lh.rebar-lh .venv/bin/python scripts/build_status.py <build>   # same, for the LH app
```
`build_status.py`도 키 경로를 `ASC_KEY_PATH`(및 `ASC_KEY_ID`/`ASC_ISSUER_ID`)로
바꿀 수 있다 — 기본값은 처음 설정한 Mac에만 있는 경로라 Windows에서는 지정해야 한다:
```bash
ASC_KEY_ID=<키ID> ASC_KEY_PATH=<.p8 경로> .venv/Scripts/python.exe scripts/build_status.py 34
```

`release.sh` does not know about the LH target yet; it hardcodes scheme
`LHRebarAR` / bundle `kr.lh.rebar-ar`. There is no Mac-local equivalent for the
LH app — use the CI for it. `build_status.py`'s `BUNDLE_ID` defaults to the
research app but reads an env override (same pattern as `next_build.py`), so
the LH app is only pollable with that override set.

**From anywhere (CI, incl. Windows):** Actions tab → run **iOS TestFlight**, or
`gh workflow run ios-testflight.yml -f app=<research|lh|both> -f upload=<true|false>`.
Both inputs are **required with defaults** — a no-arg dispatch from the Actions
UI or a bare `gh workflow run ios-testflight.yml` resolves to `app=research
upload=false`, i.e. **it builds the research app only and does not upload**.
To actually ship, set `upload=true` explicitly. **Auto-distributes to
TestFlight testers when processing finishes — research app (`kr.lh.rebar-ar`)
only.** Auto-distribution is a per-tester-group setting and tester groups are
per-app; the research app has one because someone configured it once. The LH
app's ASC record is brand new (§9) and has no tester group yet, so its first
VALID build will sit in TestFlight unseen by anyone until an account owner
creates an internal tester group for it and enables automatic distribution.

`app=both` builds research and LH in parallel matrix jobs
(`fail-fast: false`, so one job failing doesn't cancel the other).
**Until the LH app has an App Store Connect record (§9 — still pending,
account-owner action), only run `app=research upload=true`.** An
`app=both upload=true` run will build both, but the LH job's upload step
fails for lack of an ASC record and the run finishes red even though the
research upload succeeded. Switch to `app=both` once that record exists.

### CI (GitHub Actions → `ios-testflight.yml`)
macOS runner, one matrix job per selected app (scheme/bundle/plist come from
`matrix.include`, see the workflow file): restores gitignored secrets →
xcodegen → next build number (ASC query, `scripts/next_build.py`) → archive +
export with **API-key cloud signing** → altool upload (only when
`upload=true`). Both matrix jobs share the same repo secrets
(`gh secret set NAME`):

| Secret | What |
|---|---|
| `ASC_KEY_ID` | ASC API key ID — **Admin** access (cloud signing needs it; `5J8MLZ4426` is upload-only and returns "Cloud signing permission error") |
| `ASC_ISSUER_ID` | `40dabd9c-8645-44e4-9754-c6eefe759320` |
| `ASC_API_KEY_P8` | the key's `.p8` contents |
| `LIVESHARE_CONFIG_SWIFT` | contents of `LHRebarAR/Services/LiveShareConfig.swift` (gitignored) |
| `IOS_DIST_CERT_P12` | base64 of a **fixed signing certificate** (`.p12`, cert + private key). Without it the archive creates a NEW Apple Development cert every run and jams on Apple's limit — see gotcha #14 |
| `IOS_DIST_CERT_PASSWORD` | that `.p12`'s password |

### Deploy the dashboard
```bash
cd office-dashboard && npm run build      # catch type errors first
npx vercel deploy --prod --yes            # same permanent alias
```

### Regenerate LiveKit tokens
```bash
.venv/bin/python api/livekit_token.py <room> <identity> <name> <canPublish> <ttlSec>
```
The app normally fetches tokens from the dashboard at runtime; the embedded
`devToken` in `LiveShareConfig.swift` is only a fallback.

---

## 7. Product decisions (settled — don't relitigate)

- iOS 17+, ARKit + RealityKit + SwiftUI, **LiDAR-only**, iPhone + iPad adaptive.
- **USDZ only**. No IFC/Revit parsing in-app.
- **Scale locked 1:1**, pinch disabled — engineering tool.
- **No session restoration / ARWorldMap.** Re-place on each launch.
- **Markerless.** Physical markers were ruled out by the client; drift is handled by re-anchoring + visual lock.
- **Auto-fitting the design model to the scan is out of scope** — the whole point is measuring as-built deviation, so matching the model to reality would be circular.
- Debug-only UI (mesh toggle, diagnostics HUD, sample-model picker) is wrapped in `#if DEBUG` — field users see only 측정 / 공유 / 재고정 / 삭제.
- **Scene occlusion is ON** (`sceneUnderstanding.options = [.occlusion, .collision]`): the design model is hidden behind real surfaces for depth realism. We briefly disabled it while chasing the vanish bug, then rolled back once the real cause (anchor tracking, gotcha #2) was found. If a future request is "the model hides behind real stuff, I want to always see it," that's this flag — consider a toggle rather than removing it.

---

## 8. Open items / next steps

**Blocked on BriconLab:**
- `POST /analysis/measurement-upload` — spec written in `api/MEASUREMENT_UPLOAD_REQUEST.md` (multipart: image + site_id + ar_id + inspector + remark + captured_at + `measurements[]` with name/points/distance/h/v/source). Once it exists, wire the capture flow to upload instead of only saving to Photos.
- as-built 스캔 저장 API — 스펙 `api/SCAN_STORAGE_REQUEST.md`. 구현되면
  대시보드 API 라우트 내부만 프록시로 교체 (클라이언트 무변경).
- **철근 계층 사이드카** `GET /analysis/rebar-meta?ar_id=` — 스펙
  `api/REBAR_TAXONOMY_REQUEST.md`. 구현되면 트리가 도면 기반 부위 계층
  (전벽-전면-수직철근-01)으로 올라간다. 없어도 prim 이름 코드북 폴백으로
  동작하므로 **대기 항목이지 블로커가 아니다**. 옹벽 설계 모델 샘플 1개도
  같이 요청해 뒀다 — 가닥별 prim 분리가 설계 변환 경로에서도 성립하는지는
  아직 미확인이다(as-built 생성기에서만 확인됨).

**Ready to build when wanted:**
- Automatic periodic re-lock (currently manual scope button)
- Measurement depth accuracy: multi-sample averaging around the reticle to damp LiDAR noise
- Memo v3: edit/delete individual pins, persist memos to the backend
- Company domain on the dashboard (Vercel → add domain + DNS record)
- Version bump to 0.2.0 at the next feature milestone (still 0.1.0 through build 27)

**Field-test feedback status** (`TalkFile_어플 테스트 결과.pdf`): all AR-app items resolved
(button removals, label occlusion, fine-adjust reset, Visual SLAM). The LiDAR
scan app section of that document belongs to a **different repo and is out of scope here**.

**Known limitation — registration can lock onto a 90°-wrong basin for near-square walls:**
`coarseCandidates` in `office-dashboard/src/lib/analysis/registration.ts` builds its 4 initial-guess
candidates by pairing the scan's PCA eigenvectors with the design's **by position** (1st axis ↔ 1st
axis, 2nd ↔ 2nd), not by chirality. When a wall's two in-plane extents are within ~10% of each other
(common for roughly square panels), the eigenvector ordering sits near a swap boundary — a single
extra or missing rebar in the scan can flip which eigenvector comes first, sending the initial guess
90° off into a stable-but-wrong ICP basin. Degradation is graceful, not silent: the trimmed-RMS gate
(fails registration above 30mm, see `registerScan`) catches the bad basin, so the user sees
"자동 정합 실패" and the manual initial-transform controls (X/Y/Z + yaw nudge, `AnalysisView.tsx`)
rather than a wrong answer being presented as good. Proper fix is pairing eigenvectors by chirality
instead of position — a change to the registration core, deliberately out of scope for the
direction-family/contour branch that surfaced this.

---

## 9. External accounts / IDs

| Thing | Value |
|---|---|
| Bundle ID (연구과제, target `LHRebarAR`) | `kr.lh.rebar-ar` |
| Bundle ID (LH 전용, target `LHRebarARLH`) | `kr.lh.rebar-lh` — registered 2026-08-05, ASC record created, tester group configured (all three account-owner steps done) |
| Apple team | `G88CPAZ3MP` |
| ASC app (연구과제) | LH Rebar AR (`6763446019`) — sibling `Rebar Capture` (`kr.lh.rebarcapture`) is a **different** app, don't touch |
| ASC app (LH 전용) | LH 철근검측 (`6798328356`) — poll with `BUNDLE_ID=kr.lh.rebar-lh` (§6) |
| ASC API key | `5J8MLZ4426`, issuer `40dabd9c-8645-44e4-9754-c6eefe759320` |
| LiveKit | project `ar-w5h0quhi`, `wss://ar-w5h0quhi.livekit.cloud` |
| Vercel | project `office-dashboard`, alias `office-dashboard-xi.vercel.app` |
| BriconLab API | `http://api.briconlab.com:50001` (plain HTTP → ATS exception + server-side proxy) |

---

## 10. Conventions

- Branch `main`; features on `feat/<area>-<short>`.
- Numeric readouts in SF Mono; engineering monochrome + orange accent.
- Fine-adjust state stored as integer 1/10 mm and 1/10° (no float drift).
- Simulator has no ARKit — device testing is mandatory for anything AR.
- Verify claims on device/real endpoints before reporting them as working.
