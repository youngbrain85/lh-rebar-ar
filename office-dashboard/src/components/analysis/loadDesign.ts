// office-dashboard/src/components/analysis/loadDesign.ts
"use client";

// 설계 USDZ 1회 로드 → (뷰어용 Object3D, 분석용 Rebar[]) 동시 산출 — spec §5.1.
// three 의존은 components/ 아래에만 둔다 (lib/analysis는 순수 TS).
import * as THREE from "three";
import { USDLoader } from "three/addons/loaders/USDLoader.js";
import {
  extractCenterline, rebarsFromGroups, splitByConnectivity,
} from "../../lib/analysis/designExtract";
import type { Rebar, Vec3 } from "../../lib/analysis/types";

function worldVertices(mesh: THREE.Mesh): Vec3[] {
  const pos = mesh.geometry.getAttribute("position");
  const out: Vec3[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

export async function loadDesign(arId: string): Promise<{ object: THREE.Object3D; rebars: Rebar[] }> {
  const loader = new USDLoader();
  const object: THREE.Object3D = await loader.loadAsync(
    `/api/model?ar_id=${encodeURIComponent(arId)}`,
  );
  object.updateMatrixWorld(true);

  // 1차: 이름 있는 메시들을 상위 오브젝트 이름으로 그룹핑
  const groups = new Map<string, Vec3[]>();
  const meshes: THREE.Mesh[] = [];
  object.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) meshes.push(n as THREE.Mesh);
  });
  for (const mesh of meshes) {
    // rebar_N 같은 이름은 메시 자신 또는 부모 프림에 있다
    let name = mesh.name;
    let p: THREE.Object3D | null = mesh.parent;
    while ((!name || name === "") && p) {
      name = p.name;
      p = p.parent;
    }
    if (!name) name = `mesh_${meshes.indexOf(mesh)}`;
    const arr = groups.get(name) ?? [];
    arr.push(...worldVertices(mesh));
    groups.set(name, arr);
  }

  let rebars: Rebar[] = rebarsFromGroups(
    [...groups.entries()].map(([name, vertices]) => ({ name, vertices })),
  );

  // 폴백: 그룹이 1개뿐이면 연결요소 분리 시도
  if (rebars.length <= 1 && meshes.length > 0) {
    const parts: Vec3[][] = [];
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute("position");
      const idx = mesh.geometry.getIndex();
      if (!idx) continue;
      const flat: number[] = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
        flat.push(v.x, v.y, v.z);
      }
      parts.push(...splitByConnectivity(flat, Array.from(idx.array)));
    }
    rebars = parts
      .filter((p) => p.length >= 3)
      .map((vertices, i) => {
        const { centerline, radius } = extractCenterline(vertices);
        return { id: `part_${i}`, centerline, radius };
      });
  }

  if (rebars.length <= 1) {
    throw new Error("설계모델에서 철근을 분리할 수 없습니다 (서브오브젝트/연결요소 없음)");
  }
  return { object, rebars };
}
