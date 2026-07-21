#!/usr/bin/env python3
"""
Convert Revit-exported OBJ+MTL to USDZ for the LHRebarAR app.

Usage:
    .venv/bin/python source-models/convert_to_usdz.py \
        --obj source-models/highlighted_design_model.obj \
        --out LHRebarAR/Resources/Models/highlighted_design_model.usdz

Assumes OBJ units = meters. Revit OBJ export is typically Z-up; use
--up-axis z (default) to rotate into USDZ's required Y-up convention.
Materials are taken from the sibling .mtl (Kd color + d alpha).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from dataclasses import dataclass, field

from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, UsdUtils, Vt


@dataclass
class Material:
    name: str
    kd: tuple[float, float, float] = (0.8, 0.8, 0.8)
    alpha: float = 1.0


@dataclass
class ObjGroup:
    name: str
    material: str | None = None
    face_counts: list[int] = field(default_factory=list)
    face_indices: list[int] = field(default_factory=list)


def parse_mtl(path: str) -> dict[str, Material]:
    mats: dict[str, Material] = {}
    current: Material | None = None
    if not os.path.exists(path):
        return mats
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            tag = parts[0]
            if tag == "newmtl":
                current = Material(name=parts[1])
                mats[current.name] = current
            elif current is None:
                continue
            elif tag == "Kd" and len(parts) >= 4:
                current.kd = (float(parts[1]), float(parts[2]), float(parts[3]))
            elif tag == "d" and len(parts) >= 2:
                current.alpha = float(parts[1])
            elif tag == "Tr" and len(parts) >= 2:
                current.alpha = 1.0 - float(parts[1])
    return mats


def parse_obj(path: str) -> tuple[list[tuple[float, float, float]], list[ObjGroup]]:
    vertices: list[tuple[float, float, float]] = []
    groups: list[ObjGroup] = []
    current: ObjGroup | None = None
    current_mtl: str | None = None

    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if not line or line[0] == "#":
                continue
            parts = line.split()
            if not parts:
                continue
            tag = parts[0]
            if tag == "v":
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif tag == "o" or tag == "g":
                name = parts[1] if len(parts) > 1 else f"group_{len(groups)}"
                current = ObjGroup(name=_sanitize(name), material=current_mtl)
                groups.append(current)
            elif tag == "usemtl":
                current_mtl = parts[1] if len(parts) > 1 else None
                if current is not None and not current.face_counts:
                    current.material = current_mtl
            elif tag == "f":
                if current is None:
                    current = ObjGroup(name="group_default", material=current_mtl)
                    groups.append(current)
                # Face indices may be v, v/vt, v/vt/vn, v//vn
                face_verts: list[int] = []
                for token in parts[1:]:
                    v_str = token.split("/")[0]
                    if not v_str:
                        continue
                    idx = int(v_str)
                    # OBJ is 1-indexed; negatives are relative-to-end
                    if idx < 0:
                        idx = len(vertices) + idx + 1
                    face_verts.append(idx - 1)
                if len(face_verts) >= 3:
                    current.face_counts.append(len(face_verts))
                    current.face_indices.extend(face_verts)
    return vertices, groups


_SANITIZE_RE = re.compile(r"[^A-Za-z0-9_]")


def _sanitize(name: str) -> str:
    out = _SANITIZE_RE.sub("_", name)
    if not out or out[0].isdigit():
        out = "_" + out
    return out


def _create_material(stage: Usd.Stage, parent_path: str, mat: Material) -> UsdShade.Material:
    mat_path = f"{parent_path}/{_sanitize(mat.name)}"
    usd_mat = UsdShade.Material.Define(stage, mat_path)

    shader = UsdShade.Shader.Define(stage, f"{mat_path}/PreviewSurface")
    shader.CreateIdAttr("UsdPreviewSurface")
    shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*mat.kd))
    shader.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(mat.alpha)
    shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.6)
    shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.0)
    # Help RealityKit render translucent rebar cleanly
    if mat.alpha < 1.0:
        shader.CreateInput("opacityThreshold", Sdf.ValueTypeNames.Float).Set(0.0)

    usd_mat.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
    return usd_mat


def _to_y_up(p: tuple[float, float, float], src: str) -> tuple[float, float, float]:
    """Rotate a point from the source up-axis into Y-up, keeping right-handed."""
    x, y, z = p
    if src == "z":
        # Z-up → Y-up: rotate -90° around X → (x, z, -y)
        return (x, z, -y)
    if src == "x":
        # X-up → Y-up: rotate +90° around Z → (-y, x, z)
        return (-y, x, z)
    return (x, y, z)


def _compute_offset(
    points_y_up: list[tuple[float, float, float]], mode: str
) -> tuple[float, float, float]:
    if mode == "none" or not points_y_up:
        return (0.0, 0.0, 0.0)
    xs = [p[0] for p in points_y_up]
    ys = [p[1] for p in points_y_up]
    zs = [p[2] for p in points_y_up]
    cx = 0.5 * (min(xs) + max(xs))
    cz = 0.5 * (min(zs) + max(zs))
    if mode == "ground":
        # Bottom-center at origin: X/Z centered, Y min → 0
        return (-cx, -min(ys), -cz)
    if mode == "bbox":
        cy = 0.5 * (min(ys) + max(ys))
        return (-cx, -cy, -cz)
    return (0.0, 0.0, 0.0)


def build_stage(
    vertices: list[tuple[float, float, float]],
    groups: list[ObjGroup],
    materials: dict[str, Material],
    out_path: str,
    root_name: str,
    src_up: str = "y",
    center: str = "none",
) -> None:
    # Pre-transform all vertices to Y-up so the centering offset is computed
    # in the output coordinate frame.
    points_y_up = [_to_y_up(v, src_up) for v in vertices]
    ox, oy, oz = _compute_offset(points_y_up, center)

    stage = Usd.Stage.CreateNew(out_path)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)

    root = UsdGeom.Xform.Define(stage, f"/{root_name}")
    stage.SetDefaultPrim(root.GetPrim())

    mats_scope = UsdGeom.Scope.Define(stage, f"/{root_name}/Materials").GetPrim()
    usd_mats: dict[str, UsdShade.Material] = {}
    for name, mat in materials.items():
        usd_mats[name] = _create_material(stage, mats_scope.GetPath().pathString, mat)

    meshes_scope = UsdGeom.Scope.Define(stage, f"/{root_name}/Meshes").GetPrim()

    used_names: set[str] = set()
    for grp in groups:
        if not grp.face_counts:
            continue
        # Remap global → local vertex indices
        local_map: dict[int, int] = {}
        local_points: list[tuple[float, float, float]] = []
        local_indices: list[int] = []
        for gi in grp.face_indices:
            li = local_map.get(gi)
            if li is None:
                li = len(local_points)
                local_map[gi] = li
                px, py, pz = points_y_up[gi]
                local_points.append((px + ox, py + oy, pz + oz))
            local_indices.append(li)

        mesh_name = grp.name
        base = mesh_name
        counter = 1
        while mesh_name in used_names:
            counter += 1
            mesh_name = f"{base}_{counter}"
        used_names.add(mesh_name)

        mesh_path = f"{meshes_scope.GetPath().pathString}/{mesh_name}"
        mesh = UsdGeom.Mesh.Define(stage, mesh_path)
        mesh.CreatePointsAttr(Vt.Vec3fArray([Gf.Vec3f(*p) for p in local_points]))
        mesh.CreateFaceVertexCountsAttr(Vt.IntArray(grp.face_counts))
        mesh.CreateFaceVertexIndicesAttr(Vt.IntArray(local_indices))
        mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
        mesh.CreateDoubleSidedAttr(True)

        if grp.material and grp.material in usd_mats:
            UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(usd_mats[grp.material])

    stage.GetRootLayer().Save()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--obj", required=True, help="Input OBJ path")
    ap.add_argument("--mtl", default=None, help="Input MTL path (defaults to sibling .mtl)")
    ap.add_argument("--out", required=True, help="Output .usdz path")
    ap.add_argument(
        "--root", default=None, help="Root prim name (defaults to stem of OBJ file)"
    )
    ap.add_argument(
        "--up-axis",
        choices=["x", "y", "z"],
        default="z",
        help="Up axis of the source OBJ (Revit default: z). Output is always Y-up.",
    )
    ap.add_argument(
        "--center",
        choices=["none", "ground", "bbox"],
        default="ground",
        help="Re-origin the model: ground = bottom-center at origin, bbox = full bbox center at origin, none = keep authored coords.",
    )
    args = ap.parse_args()

    obj_path = os.path.abspath(args.obj)
    out_path = os.path.abspath(args.out)
    mtl_path = args.mtl or os.path.splitext(obj_path)[0] + ".mtl"
    root_name = args.root or _sanitize(os.path.splitext(os.path.basename(obj_path))[0])

    if not os.path.exists(obj_path):
        print(f"error: OBJ not found: {obj_path}", file=sys.stderr)
        return 1

    print(f"[1/4] parsing {os.path.basename(obj_path)} ...")
    vertices, groups = parse_obj(obj_path)
    print(f"       vertices={len(vertices)} groups={len(groups)}")

    print(f"[2/4] parsing {os.path.basename(mtl_path)} ...")
    materials = parse_mtl(mtl_path)
    print(f"       materials={list(materials)}")

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        usdc_path = os.path.join(td, root_name + ".usdc")
        print(
            f"[3/4] building stage (src up-axis={args.up_axis}, center={args.center}) "
            f"→ {os.path.basename(usdc_path)} ..."
        )
        build_stage(
            vertices,
            groups,
            materials,
            usdc_path,
            root_name,
            src_up=args.up_axis,
            center=args.center,
        )

        print(f"[4/4] packaging → {out_path} ...")
        if os.path.exists(out_path):
            os.remove(out_path)
        ok = UsdUtils.CreateNewUsdzPackage(usdc_path, out_path)
        if not ok:
            print("error: CreateNewUsdzPackage failed", file=sys.stderr)
            return 2

    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"done: {out_path} ({size_mb:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
