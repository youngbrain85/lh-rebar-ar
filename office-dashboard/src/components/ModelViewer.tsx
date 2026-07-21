"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { USDLoader } from "three/addons/loaders/USDLoader.js";
import { Alert, Center, Loader, Stack, Text } from "@mantine/core";

/// In-browser 3D preview of a site model. Loads the FBX through the server
/// proxy (/api/model) and renders with orbit controls on a light studio stage.
export default function ModelViewer({ arId }: { arId: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    const hemi = new THREE.HemisphereLight(0xffffff, 0xc8d3e8, 1.1);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(3, 6, 4);
    scene.add(dir);

    const grid = new THREE.GridHelper(10, 20, 0x9db2d4, 0xdde5f2);
    scene.add(grid);

    let disposed = false;
    // BriconLab serves USDZ (usdc inside); three r179+ USDLoader parses it.
    const loader = new USDLoader();
    loader.load(
      `/api/model?ar_id=${encodeURIComponent(arId)}`,
      (obj) => {
        if (disposed) return;
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        // Sit the model on the grid, centered at the origin.
        obj.position.set(-center.x, -box.min.y, -center.z);
        scene.add(obj);

        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const dist = maxDim * 1.7;
        camera.position.set(dist, dist * 0.75, dist);
        camera.near = maxDim / 100;
        camera.far = maxDim * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, size.y / 2, 0);
        controls.update();
        setLoading(false);
      },
      undefined,
      (err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : "모델을 불러오지 못했습니다");
        setLoading(false);
      }
    );

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
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
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [arId]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      {loading && !error && (
        <Center style={{ position: "absolute", inset: 0 }}>
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              3D 모델 불러오는 중…
            </Text>
          </Stack>
        </Center>
      )}
      {error && (
        <Center style={{ position: "absolute", inset: 0 }}>
          <Alert color="red" title="모델 로드 실패">
            {error}
          </Alert>
        </Center>
      )}
    </div>
  );
}
