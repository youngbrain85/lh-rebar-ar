"use client";

// 설계 고스트 + 판정색 철근 원통 오버레이 — spec §6. ModelViewer의 씬 관리 패턴 답습.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ClassifiedRebar, RebarRecord, Verdict } from "../../lib/analysis/types";

const VERDICT_COLOR: Record<Verdict, number> = {
  pass: 0x2f9e44,
  out_of_tolerance: 0xf08c00,
  extra: 0x1971c2,
  missing: 0xe03131,
};

export interface ViewerProps {
  designObject: THREE.Object3D | null;
  records: RebarRecord[];
  design: ClassifiedRebar[];
  scan: ClassifiedRebar[];
  showVerdicts: Verdict[];
  showMesh: boolean;
  meshUrl: string | null;
  /** 정합 행렬(column-major 16) — 스캔 메시는 스캔 좌표라 이 행렬로 설계 좌표에 겹친다 */
  registrationMatrix: number[] | null;
  focusKey: string | null;
}

/** Group 하위의 지오메트리/머티리얼을 dispose하고 비운다 (Group.clear는 detach만 한다) */
function disposeChildren(group: THREE.Group) {
  group.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
  });
  group.clear();
}

function cylinderBetween(a: [number, number, number], b: [number, number, number], radius: number, mat: THREE.Material): THREE.Mesh {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length() || 0.001;
  const geo = new THREE.CylinderGeometry(radius, radius, len, 12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(va.clone().add(vb).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** 철근 1개 = 중심선 각 선분의 원통 묶음 */
function rebarGroup(r: ClassifiedRebar, color: number, opacity: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: opacity < 1, opacity, roughness: 0.6,
  });
  const radius = Math.max(r.radius, 0.006); // 시인성 하한
  for (let i = 0; i + 1 < r.centerline.length; i++) {
    g.add(cylinderBetween(r.centerline[i], r.centerline[i + 1], radius, mat));
  }
  return g;
}

export default function AnalysisViewer({
  designObject, records, design, scan, showVerdicts, showMesh, meshUrl, registrationMatrix, focusKey,
}: ViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    overlay: THREE.Group;
    meshLayer: THREE.Group;
    keyed: Map<string, THREE.Group>;
  } | null>(null);

  // ---- 씬 부트스트랩 (1회) ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f1f4fa");
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    camera.position.set(2, 1.5, 2);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d3e8, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(3, 6, 4);
    scene.add(dir);
    scene.add(new THREE.GridHelper(10, 20, 0x9db2d4, 0xdde5f2));
    const overlay = new THREE.Group();
    const meshLayer = new THREE.Group();
    scene.add(overlay, meshLayer);
    sceneRef.current = { scene, camera, controls, overlay, meshLayer, keyed: new Map() };

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // ---- 설계 고스트 ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !designObject) return;
    designObject.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = new THREE.MeshStandardMaterial({
          color: 0x8a94a6, transparent: true, opacity: 0.25, depthWrite: false,
        });
      }
    });
    s.scene.add(designObject);
    // 카메라 프레이밍 (ModelViewer와 동일 방식)
    const box = new THREE.Box3().setFromObject(designObject);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    s.camera.position.set(center.x + maxDim * 1.5, center.y + maxDim, center.z + maxDim * 1.5);
    s.controls.target.copy(center);
    s.controls.update();
    return () => {
      s.scene.remove(designObject);
    };
  }, [designObject]);

  // ---- 판정 오버레이 (records 변경 시 재구성) ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    disposeChildren(s.overlay);
    s.keyed.clear();
    const designById = new Map(design.map((r) => [r.id, r]));
    const scanById = new Map(scan.map((r) => [r.id, r]));
    for (const rec of records) {
      if (!showVerdicts.includes(rec.verdict)) continue;
      const key = rec.designId ?? rec.scanId ?? "";
      const color = VERDICT_COLOR[rec.verdict];
      let group: THREE.Group | null = null;
      if (rec.verdict === "missing" && rec.designId) {
        const d = designById.get(rec.designId);
        if (d) group = rebarGroup(d, color, 0.45); // 설계 위치 고스트
      } else if (rec.scanId) {
        const sc = scanById.get(rec.scanId);
        if (sc) group = rebarGroup(sc, color, 1);
      }
      if (group) {
        s.overlay.add(group);
        s.keyed.set(key, group);
      }
    }
  }, [records, design, scan, showVerdicts]);

  // ---- 스캔 메시 토글 ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    disposeChildren(s.meshLayer);
    if (!showMesh || !meshUrl || !registrationMatrix) return;
    let cancelled = false;
    new GLTFLoader().load(meshUrl, (gltf) => {
      if (cancelled || !sceneRef.current) return;
      gltf.scene.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0x5c7cfa, transparent: true, opacity: 0.3, depthWrite: false,
          });
        }
      });
      // 메시는 스캔 좌표계 그대로 저장돼 있다 — 정합 행렬을 적용해 설계 위에 겹친다
      gltf.scene.applyMatrix4(new THREE.Matrix4().fromArray(registrationMatrix));
      sceneRef.current.meshLayer.add(gltf.scene);
    });
    return () => {
      cancelled = true;
    };
  }, [showMesh, meshUrl, registrationMatrix]);

  // ---- 포커스 ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !focusKey) return;
    const g = s.keyed.get(focusKey);
    if (!g) return;
    const box = new THREE.Box3().setFromObject(g);
    const center = box.getCenter(new THREE.Vector3());
    s.controls.target.copy(center);
    s.controls.update();
    // 하이라이트: 잠깐 에미시브
    g.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (mesh.isMesh) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.emissive = new THREE.Color(0xffff00);
        m.emissiveIntensity = 0.6;
      }
    });
    const t = setTimeout(() => {
      g.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [focusKey]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
}
