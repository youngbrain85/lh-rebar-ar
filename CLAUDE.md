# LH Rebar AR — Project Context

Auto-loaded by Claude Code in this directory. It carries decisions, hard-won
gotchas, and the current plan across machines/sessions so a fresh session can
continue without re-deriving anything.

**Last updated**: 2026-07-23 · iOS build 32 on TestFlight · dashboard live on Vercel.

---

## 1. What this project is

Two shipped pieces that work together for on-site rebar QA:

| Piece | What it is | Where it runs |
|---|---|---|
| **LH Rebar AR** (iOS) | Field app: overlays the design rebar model on the real structure, measures, captures evidence, shares its AR screen live | iPhone/iPad w/ LiDAR, distributed via TestFlight |
| **office-dashboard** (Next.js) | Office console: site management, 3D model viewer, live AR collaboration (watch + talk + annotate) | https://office-dashboard-xi.vercel.app |

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
Actions workflow `.github/workflows/ios-testflight.yml` builds + uploads to
TestFlight on a macOS runner. Trigger it from the Actions tab → "Run workflow",
or `gh workflow run ios-testflight.yml`. It needs the repo secrets listed in
§6 → CI (notably an **Admin** ASC API key — the upload-only key `5J8MLZ4426`
cannot cloud-sign). Local `scripts/release.sh` is the Mac-only equivalent.

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

---

## 6. Workflows

### Ship an iOS build
**On a Mac:**
```bash
bash scripts/release.sh          # bumps build, xcodegen, archive, export, upload
.venv/bin/python scripts/build_status.py <build>   # poll until VALID
```
**From anywhere (CI, incl. Windows):** Actions tab → run **iOS TestFlight**, or
`gh workflow run ios-testflight.yml`. Auto-distributes when processing finishes.

### CI (GitHub Actions → `ios-testflight.yml`)
macOS runner: restores gitignored secrets → xcodegen → next build number (ASC
query, `scripts/next_build.py`) → archive + export with **API-key cloud
signing** → altool upload. Required repo secrets (`gh secret set NAME`):

| Secret | What |
|---|---|
| `ASC_KEY_ID` | ASC API key ID — **Admin** access (cloud signing needs it; `5J8MLZ4426` is upload-only and returns "Cloud signing permission error") |
| `ASC_ISSUER_ID` | `40dabd9c-8645-44e4-9754-c6eefe759320` |
| `ASC_API_KEY_P8` | the key's `.p8` contents |
| `LIVESHARE_CONFIG_SWIFT` | contents of `LHRebarAR/Services/LiveShareConfig.swift` (gitignored) |

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

**Ready to build when wanted:**
- Automatic periodic re-lock (currently manual scope button)
- Measurement depth accuracy: multi-sample averaging around the reticle to damp LiDAR noise
- Memo v3: edit/delete individual pins, persist memos to the backend
- Company domain on the dashboard (Vercel → add domain + DNS record)
- Version bump to 0.2.0 at the next feature milestone (still 0.1.0 through build 27)

**Field-test feedback status** (`TalkFile_어플 테스트 결과.pdf`): all AR-app items resolved
(button removals, label occlusion, fine-adjust reset, Visual SLAM). The LiDAR
scan app section of that document belongs to a **different repo and is out of scope here**.

---

## 9. External accounts / IDs

| Thing | Value |
|---|---|
| Bundle ID | `kr.lh.rebar-ar` |
| Apple team | `G88CPAZ3MP` |
| ASC app | LH Rebar AR (`6763446019`) — sibling `Rebar Capture` (`kr.lh.rebarcapture`) is a **different** app, don't touch |
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
