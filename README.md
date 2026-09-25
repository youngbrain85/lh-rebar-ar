# LH Rebar AR — AR Rebar Inspection Apps and Office Dashboard

Field and office software for on-site rebar quality inspection, developed for the Korea Land and Housing
Corporation (LH) project on digital quality inspection with BIM–AR convergence technology. On a LiDAR-equipped
iPhone or iPad, the design rebar model is overlaid on the real structure at 1:1 scale, so that an inspector can
compare what was built with what was designed, measure, capture evidence, and share the AR view live with the
office.

| Component | What it is | Platform |
|---|---|---|
| **Rebar AR (research app)** | Field app: places the design rebar model on the real structure, captures evidence, and shares its AR screen live with the office | iOS 17+, iPhone/iPad with LiDAR, distributed through TestFlight |
| **LH Rebar Inspection (LH app)** | LH-only field app with the same AR placement, fine-adjustment and visual-lock core, plus length measurement and a rebar hierarchy filter; no live collaboration | iOS 17+, iPhone/iPad with LiDAR, distributed through TestFlight |
| **office-dashboard** | Office console: site management, 3D model viewer, live AR collaboration (watch, talk, annotate) and as-built scan analysis | Next.js, deployed on Vercel |

Both iOS apps are built from one Xcode project with two targets that share all source files. The differences between
the two apps are defined in one place (`AppFeatures.swift`) through a single compile-time flag. The app interfaces
are in Korean.

## Field app features

- **Model placement** — tap to place the USDZ design model; raycasts prefer the LiDAR mesh, then detected planes,
  then estimated planes. Every model is re-pivoted to the bottom center of its bounding box when it is loaded, so it
  sits on the tapped surface regardless of how the source was authored.
- **Coarse and fine adjustment** — one-finger pan and two-finger rotation, plus fine adjustment in 1 mm and 0.1°
  steps with undo/redo (stored as integers, so there is no floating-point drift).
- **Re-anchoring** — on every adjustment commit the model is re-anchored at its current pose, which removes
  lever-arm drift.
- **Visual lock** — aligns the current LiDAR scan to a datum captured at commit time (point-to-plane ICP) and snaps
  the model back onto the real structure. It matches scan to scan only; the design model is never fitted to the
  scan.
- **Length measurement** (LH app) — reticle-based measurement between real points and between the model and real
  points, with total, horizontal and vertical components and a name for each measurement.
- **Rebar hierarchy filter** (LH app) — shows or hides bars by location (member > face > function) or by kind
  (kind > location), following the client's classification table. In the design model tested on 2026-08-18, all 45
  bars were classified.
- **Evidence capture** — screen capture with a footer listing the named measurements, saved to Photos.
- **Backend integration** — site list → model list → USDZ download and cache.
- **Live share** (research app) — in-app screen capture streamed through LiveKit into a room per site; video first,
  with the microphone as an opt-in toggle; two-way voice; receives 2D pings and world-locked 3D memo pins from the
  office.

## Office dashboard features

- **Site management** — site table with live badges, 3D model drawer and a three.js USDZ viewer.
- **Live collaboration** — the field screen at its native aspect ratio, participants, talk-back, and
  click-to-annotate (pointer and memo modes).
- **As-built analysis** — upload an as-built scan (rebar centerlines); the browser registers it to the design model
  (PCA + ICP), matches it bar by bar, and classifies bars as missing, out of tolerance or not in the drawings, with a
  3D overlay. Spacing and direction are computed per direction family derived from the design model (including
  inclined wall bars and 45° haunch bars). Because KDS 10 20 50 gives no tolerance for spacing error, deviations are
  shown as a five-level contour map on the wall (user-set upper limit; spacing deviation by default, position
  deviation as a toggle).

## Design decisions

- iOS 17+, ARKit + RealityKit + SwiftUI, LiDAR devices only, adaptive to iPhone and iPad
- USDZ models only; no IFC or Revit parsing in the app
- Scale locked at 1:1 (an engineering tool, so pinch-to-scale is disabled)
- Markerless: physical markers were ruled out by the client, so drift is handled by re-anchoring and the visual lock
- The design model is never fitted automatically to the scan — the purpose is to measure as-built deviation, so
  matching the model to reality would be circular
- Scene occlusion is on, so the design model is hidden behind real surfaces for depth realism

## Repository layout

```
LHRebarAR/          iOS source shared by both targets (AR, Placement, Measurement, Backend, Model, Services, UI)
LHRebarARTests/     Unit tests for the pure-logic parts (rebar taxonomy, filters, model decoding)
office-dashboard/   Next.js office console
api/                Backend API request specifications and a LiveKit token helper
scripts/            Release, build-number, build-status, certificate, app-icon and database helpers
source-models/      Raw Revit exports (OBJ/MTL) and the USDZ conversion notes
docs/               Design system, device-check list and design documents
.github/workflows/  CI: build both apps and upload them to TestFlight (manual dispatch)
```

## Building

**iOS** (macOS with Xcode; the project file is generated by XcodeGen):

```bash
brew install xcodegen
xcodegen generate
open LHRebarAR.xcodeproj
```

Secrets (LiveKit configuration and the like) are not in the repository and must be restored before the apps build.
Releases are built and uploaded to TestFlight by the GitHub Actions workflow `ios-testflight.yml`, which can build
either app or both.

**Dashboard:**

```bash
cd office-dashboard && npm install && npm run dev   # → http://localhost:3000
```

## Status and verification

- Version 0.2.0 — research-app build 39 and LH-app build 5 uploaded to TestFlight on 2026-08-20.
- 24 Swift unit tests pass in CI; the dashboard passes 209 Vitest tests and a clean `tsc --noEmit`.
- On-device check (2026-08-20): the rebar tree in the LH app works on a real device, confirming that RealityKit
  preserves USD prim names as entity names — the key assumption behind the rebar hierarchy filter.

Built with Swift 5.9, SwiftUI, ARKit, RealityKit, the LiveKit Swift SDK and XcodeGen for iOS; Next.js, Mantine,
three.js, LiveKit and Vercel Blob for the dashboard; GitHub Actions for CI and TestFlight delivery.
