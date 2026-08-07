// office-dashboard/src/components/analysis/loadDesign.ts
"use client";

// 설계 USDZ 1회 로드 → (뷰어용 Object3D, 분석용 Rebar[]) 동시 산출 — spec §5.1.
// three 의존은 components/ 아래에만 둔다 (lib/analysis는 순수 TS).
import * as THREE from "three";
import { USDLoader } from "three/addons/loaders/USDLoader.js";
import { rebarsFromMeshes, type MeshData } from "../../lib/analysis/designExtract";
import type { Rebar } from "../../lib/analysis/types";

/**
 * Object3D의 부모 체인으로 USDZ prim 절대 경로를 조립한다.
 * 최상위 로드 루트(부모 없음)는 경로에 넣지 않는다 — 로더가 붙이는 컨테이너라
 * 파일마다 이름이 달라 조인 키로 못 쓴다. 이름 없는 노드는 인덱스로 대체한다.
 */
function primPath(mesh: THREE.Object3D, fallbackIdx: number): string {
  const segs: string[] = [];
  let n: THREE.Object3D | null = mesh;
  while (n && n.parent) {
    segs.unshift(n.name || `_${fallbackIdx}`);
    n = n.parent;
  }
  return "/" + segs.join("/");
}

export async function loadDesign(arId: string): Promise<{ object: THREE.Object3D; rebars: Rebar[] }> {
  const loader = new USDLoader();
  const object: THREE.Object3D = await loader.loadAsync(
    `/api/model?ar_id=${encodeURIComponent(arId)}`,
  );
  object.updateMatrixWorld(true);

  // 메시별 월드좌표 정점 + 인덱스 수집. 신원은 **부모 체인으로 조립한 prim 경로**다.
  // Revit류 내보내기는 철근 "세트"(한 요소에 여러 가닥)를 쓰므로, 가닥 분리는
  // rebarsFromMeshes가 연결요소 기준으로 수행한다.
  const meshes: THREE.Mesh[] = [];
  object.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) meshes.push(n as THREE.Mesh);
  });
  const meshData: MeshData[] = meshes.map((mesh, mi) => {
    const name = mesh.name || `mesh_${mi}`;
    const path = primPath(mesh, mi);
    const pos = mesh.geometry.getAttribute("position");
    const idx = mesh.geometry.getIndex();
    const positions: number[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
    }
    return { name, path, positions, index: idx ? Array.from(idx.array) : null };
  });

  const { rebars } = rebarsFromMeshes(meshData);

  if (rebars.length <= 1) {
    throw new Error("설계모델에서 철근을 분리할 수 없습니다 (서브오브젝트/연결요소 없음)");
  }
  return { object, rebars };
}
