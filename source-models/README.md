# Source Models

Raw 3D models exported from Revit. **Not consumed by the app directly.**

## Pipeline

```
Revit  →  OBJ + MTL (here)  →  Reality Converter (macOS)  →  USDZ  →  LHRebarAR/Resources/Models/
```

## Conversion steps (macOS)

1. Open **Reality Converter** (free, Apple Developer downloads).
2. Drag `highlighted_design_model.obj` into the window. The `.mtl` is picked up automatically if it sits next to the `.obj`.
3. Verify scale — OBJ has no intrinsic units, so confirm 1 unit = 1 meter. If the model looks 1000x too big/small, re-export from Revit in meters, or scale in Reality Converter before exporting.
4. File → Export → `highlighted_design_model.usdz`.
5. Drop the `.usdz` into `LHRebarAR/Resources/Models/` and add it to the Xcode app target (Copy Bundle Resources).

## Re-export notes

- When the Revit source updates, replace the OBJ/MTL here and re-run the conversion.
- Keep filenames stable so the app's `ModelLibrary` doesn't need updates.
