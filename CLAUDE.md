# LH Rebar AR — Project Context

This file is auto-loaded by Claude Code whenever this directory is opened. It carries the project's decisions and plan across machines (Windows ↔ macOS) so a fresh session can continue without losing context.

## Project

iOS native AR app for visualizing 3D rebar models on-site (construction/engineering QA for rebar placement).

- **Working directory**: the root of this project (contains `LHRebarAR/` Xcode project once scaffolded on macOS).
- **Primary users**: field engineers verifying rebar layout against design.

## Resolved decisions

- **Platform**: iOS 17+ native. ARKit + RealityKit + SwiftUI. No cross-platform frameworks.
- **Device support**: **LiDAR-only** (iPad Pro M1+, iPhone 12 Pro or newer). No fallback for non-LiDAR devices.
- **Both iPhone Pro and iPad Pro** are supported — use SwiftUI adaptive layout (size classes). FineAdjustPad: bottom sheet on iPhone, right side panel on iPad.
- **Model format**: app consumes **USDZ only**. Source is Revit OBJ/MTL in `source-models/`; convert to USDZ with Reality Converter on macOS (see `source-models/README.md`). Do not add IFC/Revit parsing to the app.
- **Model complexity**: low polygon (rebar = bundles of cylinders). No LOD/proxy loading — plain async USDZ load is fine.
- **Session restoration**: **NOT implemented.** User re-places the model on every launch. No ARWorldMap persistence. On session interruption, show "place again" prompt.
- **Markerless**: rely on plane detection + LiDAR scene mesh. No image anchors.
- **Scale is locked 1:1** — pinch-to-scale is disabled. Engineering tool, not a preview toy.

## Design & UX

- **Engineering-style UI**: monochrome base + single accent color. SF Pro Text for labels, **SF Mono for all numeric readouts** (coordinates, angles, steps).
- **Workflow**: scan → ready-to-place → placed → adjusting (gesture or fine) → locked.
- **Gestures (coarse)**: 1-finger pan (XZ on ground), 2-finger rotate (Y axis). Pinch disabled.
- **Fine adjustment**: ±X/Y/Z in mm steps (1 / 5 / 10 / 50) and ±Rx/Ry/Rz in 0.1° / 0.5° / 1° steps. Long-press for continuous increment with haptic tick. Undo/redo up to 50 steps. **Internal state stored as integer 1/10mm and 1/10° to prevent float drift.**
- **HUD**: live transform readout, tracking-state badge, model name.

## Anchoring strategy

- `ARWorldTrackingConfiguration` with `sceneReconstruction = .mesh`, `planeDetection = [.horizontal, .vertical]`, `frameSemantics.insert(.sceneDepth)`, `environmentTexturing = .automatic`.
- Raycast priority at placement: **LiDAR mesh hit → existing plane → estimated plane**.
- Entity tree under the anchor:
  ```
  AnchorEntity(anchor: ARAnchor)
    └── placementRoot  ← all fine-adjustment transforms applied HERE, not the anchor
         ├── modelEntity (USDZ)
         └── gizmoEntity (axis/bbox, shown while adjusting)
  ```
- When tracking state drops to `.limited`, lock gesture input and surface a banner.

## Directory layout (target, scaffolded on macOS)

```
LH/                          ← this directory (project root)
├── CLAUDE.md                ← this file
├── source-models/           ← Revit OBJ/MTL (not bundled in app)
│   ├── README.md            ← conversion pipeline
│   ├── highlighted_design_model.obj
│   └── highlighted_design_model.mtl
├── LHRebarAR.xcodeproj      ← created on macOS, step 0
└── LHRebarAR/
    ├── App/                 (LHRebarARApp.swift, AppRootView.swift)
    ├── AR/                  (ARSessionManager, ARViewContainer, AnchorStrategy, ModelAnchorController, CoachingOverlayCoordinator, ARDiagnostics)
    ├── Placement/           (PlacementStateMachine, PlacementViewModel, GestureCoordinator, FineAdjustmentViewModel)
    ├── Model/               (RebarModel, ModelLibrary, ModelLoader)
    ├── UI/
    │   ├── Screens/         (ModelPickerView, ARPlacementView, SettingsView)
    │   ├── Components/      (FineAdjustPad, StatusBadge, NumericStepper, PrimaryActionButton)
    │   └── Theme/           (LHColors, LHTypography, LHSpacing)
    ├── Services/            (HapticsService, Logger)
    ├── Resources/
    │   ├── Models/          (converted USDZ goes here, added to bundle)
    │   └── Assets.xcassets
    └── Info.plist
```

## Info.plist essentials

- `NSCameraUsageDescription` — "철근 모델을 현장에 증강 표시하기 위해 카메라가 필요합니다."
- `UIRequiredDeviceCapabilities`: `arkit`
- Enforce LiDAR at runtime: check `ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)` and show an unsupported-device screen if false.
- `UIApplication.isIdleTimerDisabled = true` while AR session active.

## Implementation roadmap (MVP ≈ 2 weeks)

0. **Xcode scaffolding** (0.5d) — create project, set bundle ID `kr.lh.rebar-ar`, iOS 17+, permissions, empty SwiftUI app builds to device.
1. **AR session basics** (1–2d) — ARSessionManager, ARViewContainer, coaching overlay, tracking badge, LiDAR mesh debug toggle.
2. **USDZ load + initial placement** (2–3d) — bundle sample USDZ, picker → AR view → tap to place. Anchor + placementRoot + modelEntity tree.
3. **Coarse gestures** (2d) — pan/rotate with state-machine gating. Input lock during `.limited`.
4. **Fine adjustment UI** (2–3d) — FineAdjustPad, integer-stored transform, haptics, undo/redo. Adaptive layout for iPhone vs iPad.
5. **UI polish** (2d) — theme, typography, micro-copy, light/dark.
6. **Stability & diagnostics** (2d) — 30-min drift test target < 2cm @ 5m, interruption recovery, diagnostics HUD in debug builds.

## Testing

- Simulator has no ARKit — only unit test VMs and pure logic (state machine, transform math, integer step arithmetic).
- **Real-device checklist**: indoor floor placement, vertical wall placement, backlit/dim conditions, fast motion drift, 5m/10m viewing angle, 30-min continuous use, call/home-button recovery.
- Performance target: 60fps with LiDAR on, memory < 400MB.

## Risks

- Anchor drift is an ARKit limitation — mitigated by LiDAR mesh + UI warning; cannot be fully solved without markers (out of scope).
- SwiftUI ↔ ARView state sync: high-frequency updates via Combine subject in the Coordinator; SwiftUI bindings only for state transitions.
- Float accumulation in fine adjustment — prevented by integer internal state.

## Open items

- Pick an accent color (candidate: engineering orange `#FF6A00` or system blue `#0A84FF`). Decide during step 5.
- Whether to ship a few sample USDZs alongside `highlighted_design_model.usdz` for demos.

## Conventions

- Branch: `main` protected, features on `feat/<area>-<short>`.
- Tag each milestone: `v0.1-ar-session`, `v0.2-placement`, ...
- PR must include "verified on real device" checkbox.
