// office-dashboard/scripts/make-demo-scan.mjs
// 라이다 앱 대역: 설계 OBJ를 교란해 as-built 데모 스캔을 만들어 업로드한다.
// 사용: node scripts/make-demo-scan.mjs                       → scratch/demo-rebars.json만 생성
//       node scripts/make-demo-scan.mjs --upload http://localhost:3000 --site 5
// 환경: SCAN_UPLOAD_TOKEN (선택 — 서버에 설정돼 있을 때만 필요)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const objPath = resolve(here, "../../source-models/highlighted_design_model.obj");

// --- 미니 OBJ 파서 (o 그룹별 정점) ---
const groups = [];
let cur = null;
for (const line of readFileSync(objPath, "utf8").split("\n")) {
  if (line.startsWith("o ")) {
    cur = { name: line.slice(2).trim(), vertices: [] };
    groups.push(cur);
  } else if (line.startsWith("v ") && cur) {
    cur.vertices.push(line.slice(2).trim().split(/\s+/).map(Number));
  }
}

// --- PCA 중심선 추출 (designExtract.ts와 동일 알고리즘의 단독 구현) ---
function centerlineOf(verts) {
  const n = verts.length;
  const mean = [0, 0, 0];
  for (const v of verts) for (let k = 0; k < 3; k++) mean[k] += v[k] / n;
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const v of verts) {
    const d = [v[0] - mean[0], v[1] - mean[1], v[2] - mean[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += (d[i] * d[j]) / n;
  }
  // 멱승법으로 주축 (합성 데이터라 충분)
  let a = [1, 1, 1];
  for (let it = 0; it < 100; it++) {
    const b = [
      c[0][0] * a[0] + c[0][1] * a[1] + c[0][2] * a[2],
      c[1][0] * a[0] + c[1][1] * a[1] + c[1][2] * a[2],
      c[2][0] * a[0] + c[2][1] * a[1] + c[2][2] * a[2],
    ];
    const l = Math.hypot(...b);
    a = b.map((x) => x / l);
  }
  let tMin = Infinity, tMax = -Infinity;
  const radial = [];
  for (const v of verts) {
    const d = [v[0] - mean[0], v[1] - mean[1], v[2] - mean[2]];
    const t = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
    radial.push(Math.sqrt(Math.max(0, d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - t * t)));
  }
  radial.sort((x, y) => x - y);
  const p = (t) => [mean[0] + a[0] * t, mean[1] + a[1] * t, mean[2] + a[2] * t];
  return { centerline: [p(tMin), p(tMax)], radius: radial[Math.floor(radial.length / 2)] };
}

// --- 교란: MISSING 제거, rebar_3 15mm 오프셋, 2mm 노이즈, 강체변환 ---
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff - 0.5;
};
const gauss = (s) => (rnd() + rnd() + rnd()) * 2 * s;
const yaw = (40 * Math.PI) / 180;
const R = [[Math.cos(yaw), 0, Math.sin(yaw)], [0, 1, 0], [-Math.sin(yaw), 0, Math.cos(yaw)]];
const T = [2.5, -0.3, 1.1];
const xform = (p) => {
  const q = [
    R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + T[0],
    R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + T[1],
    R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + T[2],
  ];
  return q.map((x) => x + gauss(0.002));
};

const rebars = [];
let i = 0;
for (const g of groups) {
  if (g.vertices.length < 3) continue;
  if (g.name.includes("MISSING")) continue; // 미시공 시뮬레이션
  const { centerline, radius } = centerlineOf(g.vertices);
  let line = centerline;
  if (g.name.startsWith("rebar_3_")) {
    line = line.map((p) => [p[0] + 0.015, p[1], p[2]]); // 허용초과 시뮬레이션
  }
  rebars.push({ id: `s${i++}`, centerline: line.map(xform), radius });
}

const file = { version: 1, unit: "m", rebars };
mkdirSync(resolve(here, "../scratch"), { recursive: true });
const outPath = resolve(here, "../scratch/demo-rebars.json");
writeFileSync(outPath, JSON.stringify(file));
console.log(`wrote ${outPath} (${rebars.length} rebars)`);

// --- 업로드 ---
const uploadIdx = process.argv.indexOf("--upload");
if (uploadIdx > 0) {
  const base = process.argv[uploadIdx + 1];
  const siteIdx = process.argv.indexOf("--site");
  const site = siteIdx > 0 ? process.argv[siteIdx + 1] : "5";
  const token = process.env.SCAN_UPLOAD_TOKEN;
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const form = new FormData();
  form.set("site_id", site);
  form.set("captured_at", new Date().toISOString());
  form.set("rebars", new Blob([JSON.stringify(file)], { type: "application/json" }), "rebars.json");
  const res = await fetch(`${base}/api/scan-upload`, {
    method: "POST",
    headers,
    body: form,
  });
  console.log(res.status, await res.text());
}
