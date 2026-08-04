"use client";

// 설계 고스트 + 판정색 철근 원통 오버레이 — spec §6. ModelViewer의 씬 관리 패턴 답습.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { contourColor, type ContourField } from "../../lib/analysis/contour";
import type { ClassifiedRebar, RebarRecord, Verdict } from "../../lib/analysis/types";

/** 뷰어 레이어 색 — 범례(AnalysisView)와 공유하는 단일 출처 */
export const LAYER_COLOR = {
  pass: "#2f9e44",
  out_of_tolerance: "#f08c00",
  extra: "#1971c2",
  missing: "#e03131",
  design: "#8a94a6",
  scanMesh: "#5c7cfa",
  /**
   * 설계모델 없이 분석("설계모델 없이 분석" 모드, registration.method:"none")했을 때
   * 시공 철근을 그리는 색. 판정(정상/허용초과/미시공/도면 외) 색 팔레트와 절대 겹치지
   * 않는 중립색이다 — 이 모드에는 비교할 설계가 없어 판정 자체가 없으므로, 판정색을
   * 쓰면 존재하지 않는 판정을 지어내는 셈이 된다. docs/design-system.md에도 이 색이
   * 판정 팔레트 밖이라는 점을 적어뒀다 — 바꿀 때 같이 고칠 것.
   */
  asBuilt: "#495057",
} as const;

const hex = (c: string) => parseInt(c.slice(1), 16);
const VERDICT_COLOR: Record<Verdict, number> = {
  pass: hex(LAYER_COLOR.pass),
  out_of_tolerance: hex(LAYER_COLOR.out_of_tolerance),
  extra: hex(LAYER_COLOR.extra),
  missing: hex(LAYER_COLOR.missing),
};

export interface ViewerProps {
  designObject: THREE.Object3D | null;
  records: RebarRecord[];
  design: ClassifiedRebar[];
  scan: ClassifiedRebar[];
  showVerdicts: Verdict[];
  /**
   * 이 결과에 판정이 없다(registration.method:"none" — 설계모델 없이 분석). records는
   * 항상 빈 배열이라 아래 판정 루프가 아무것도 그리지 않으므로, 이 플래그가 켜지면
   * scan을 판정색이 아닌 LAYER_COLOR.asBuilt로 직접 그린다.
   */
  noDesign: boolean;
  /** 설계모델 고스트 표시 */
  showDesign: boolean;
  /** 시공(as-built) 철근 오버레이 표시 — 끄면 설계모델만 보인다 */
  showScanBars: boolean;
  showMesh: boolean;
  meshUrl: string | null;
  /** 정합 행렬(column-major 16) — 스캔 메시는 스캔 좌표라 이 행렬로 설계 좌표에 겹친다 */
  registrationMatrix: number[] | null;
  /** 간격/위치 편차 보간 지도. null이면 그리지 않는다 */
  contour: ContourField | null;
  /** 컨투어 색 상한 (mm) */
  contourMax: number;
  focusKey: string | null;
}

/** Group 하위의 지오메트리/머티리얼을 dispose하고 비운다 (Group.clear는 detach만 한다) */
function disposeChildren(group: THREE.Group) {
  group.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const m = mesh.material;
      const materials = Array.isArray(m) ? m : m ? [m] : [];
      for (const mat of materials) {
        // map(텍스처)은 머티리얼 dispose로 함께 해제되지 않는다 — 컨투어 평면의
        // DataTexture처럼 매 재렌더마다 새로 만드는 경우 여기서 안 지우면 GPU 메모리가 샌다.
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
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

/**
 * 편차 보간 지도를 벽면 평면에 붙인다.
 * 텍스처 필터를 NearestFilter로 두어 색이 부드럽게 섞이지 않고 **계단 띠**로 보이게 한다
 * (등고선처럼 읽혀야 어느 구간이 어느 단계인지 눈으로 셀 수 있다).
 */
function contourMesh(field: ContourField, maxMm: number): THREE.Mesh {
  const { cols, rows, plane, values } = field;
  const data = new Uint8Array(cols * rows * 4);
  const c = new THREE.Color();
  for (let i = 0; i < cols * rows; i++) {
    const v = values[i];
    if (v == null) continue; // alpha 0 = 표본이 없는 자리는 비운다
    c.set(contourColor(v, maxMm));
    data[i * 4] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    data[i * 4 + 3] = 205;
  }
  const tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  // ★ 행을 뒤집지 말 것. DataTexture는 flipY가 기본 false(일반 Texture는 true)이고
  //   PlaneGeometry는 아래 모서리가 v=0이다. field.values의 0행도 v=0(평면 origin)
  //   쪽이므로 그대로 올리면 방향이 맞는다. 뒤집으면 지도가 상하 반전된다.

  const geo = new THREE.PlaneGeometry(Math.max(plane.width, 1e-3), Math.max(plane.height, 1e-3));
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const u = new THREE.Vector3(...plane.axisU);
  const v = new THREE.Vector3(...plane.axisV);
  const n = new THREE.Vector3().crossVectors(u, v).normalize();
  mesh.setRotationFromMatrix(new THREE.Matrix4().makeBasis(u, v, n));
  // PlaneGeometry는 중심 기준이라 origin(좌하단)에서 절반씩 이동시킨다
  mesh.position.set(
    plane.origin[0] + u.x * plane.width / 2 + v.x * plane.height / 2,
    plane.origin[1] + u.y * plane.width / 2 + v.y * plane.height / 2,
    plane.origin[2] + u.z * plane.width / 2 + v.z * plane.height / 2,
  );
  mesh.renderOrder = -1; // 철근 원통보다 먼저 그려 뒤로 깔린다
  return mesh;
}

export default function AnalysisViewer({
  designObject, records, design, scan, showVerdicts, noDesign, showDesign, showScanBars,
  showMesh, meshUrl, registrationMatrix, contour, contourMax, focusKey,
}: ViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    overlay: THREE.Group;
    meshLayer: THREE.Group;
    contourLayer: THREE.Group;
    keyed: Map<string, THREE.Group>;
  } | null>(null);
  // 사용자가 카메라를 직접 조작했는지 — 조작한 뒤에는 자동 프레이밍(설계 고스트 등장,
  // 판정 없는 결과의 스캔 bbox 등)이 시야를 다시 빼앗지 않는다.
  const userMovedRef = useRef(false);
  // 판정 오버레이가 "빈 상태"였는지 — 없음→있음으로 바뀌는 전환 시점에만 카메라를
  // 다시 잡는다(매 렌더마다 재프레이밍하지 않는다).
  const overlayWasEmptyRef = useRef(true);

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
    // "start" = 사용자가 드래그/줌/팬을 시작한 시점. 이후로는 자동 프레이밍이 카메라를
    // 다시 옮기지 않는다 — 사용자가 원하는 대로 본 화면을 존중한다.
    controls.addEventListener("start", () => {
      userMovedRef.current = true;
    });
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d3e8, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(3, 6, 4);
    scene.add(dir);
    scene.add(new THREE.GridHelper(10, 20, 0x9db2d4, 0xdde5f2));
    const overlay = new THREE.Group();
    const meshLayer = new THREE.Group();
    const contourLayer = new THREE.Group();
    scene.add(overlay, meshLayer, contourLayer);
    sceneRef.current = { scene, camera, controls, overlay, meshLayer, contourLayer, keyed: new Map() };

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
          color: hex(LAYER_COLOR.design), transparent: true, opacity: 0.25, depthWrite: false,
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

  // ---- 설계모델 표시/숨김 (따로 보기) ----
  useEffect(() => {
    if (designObject) designObject.visible = showDesign;
  }, [designObject, showDesign]);

  // ---- 판정 오버레이 (records 변경 시 재구성) ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    disposeChildren(s.overlay);
    s.keyed.clear();
    if (!showScanBars) {
      overlayWasEmptyRef.current = true; // 설계모델만 보기 — 다음에 켜지면 다시 빈→참 전환
      return;
    }
    if (noDesign) {
      // 판정할 설계가 없는 결과라 records는 항상 빈 배열이다 — 그렇다고 화면을 비워두면
      // 3D 뷰 왼쪽이 통째로 빈 채로 열린다. scan(이미 스캔 자신의 프레임으로 분류됨)을
      // 판정색이 아닌 중립색(LAYER_COLOR.asBuilt)으로 그린다 — 정상/도면외 같은 판정색을
      // 쓰면 존재하지 않는 판정을 지어내는 거짓이 된다. 「시공 철근」 칩이 계속
      // showScanBars를 통해 이 표시를 껐다 켰다 할 수 있게 한다.
      const color = hex(LAYER_COLOR.asBuilt);
      for (const sc of scan) {
        const group = rebarGroup(sc, color, 1);
        s.overlay.add(group);
        s.keyed.set(sc.id, group);
      }
    } else {
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
    }

    // 설계모델이 없거나 숨겨진 상태에서(frameSource:"scan" 등) 오버레이가 비어 있다가
    // 뭔가 생기는 "전환" 시점에만 카메라를 그 위로 옮긴다. 설계 고스트가 보이는 동안은
    // 그쪽 프레이밍 이펙트가 이미 담당하므로 건드리지 않고, 매 렌더마다(예: 요구간격
    // 입력 중 재구성) 다시 잡지도 않으며, 사용자가 카메라를 이미 조작했으면 존중한다.
    const isEmpty = s.overlay.children.length === 0;
    const designVisible = !!designObject && showDesign;
    if (!isEmpty && overlayWasEmptyRef.current && !designVisible && !userMovedRef.current) {
      const box = new THREE.Box3().setFromObject(s.overlay);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        s.camera.position.set(center.x + maxDim * 1.5, center.y + maxDim, center.z + maxDim * 1.5);
        s.controls.target.copy(center);
        s.controls.update();
      }
    }
    overlayWasEmptyRef.current = isEmpty;
  }, [records, design, scan, showVerdicts, showScanBars, noDesign, designObject, showDesign]);

  // ---- 컨투어 평면 ----
  // 정합이 실패했을 때는 호출부(Task 7)가 contour에 null을 넘긴다. 실패한 정합의
  // scanTransformed는 엉뚱한 자리에 놓인 점군이라 그 위에서 잰 간격·평면은 부정확한
  // 게 아니라 무의미하다 — 확신에 찬 쓰레기 지도를 그리느니 아무것도 안 그리는 게 맞다.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    disposeChildren(s.contourLayer);
    if (!contour) return;
    s.contourLayer.add(contourMesh(contour, contourMax));
  }, [contour, contourMax]);

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
            color: hex(LAYER_COLOR.scanMesh), transparent: true, opacity: 0.3, depthWrite: false,
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
