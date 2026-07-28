// 테스트 전용 미니 OBJ 파서: o 그룹별 정점만 수집 (면/노멀 무시).
// 주의: OBJ의 v 인덱스는 전역이지만, 이 모델은 그룹별로 정점을 순서대로 선언하므로
// "직전 o 이후 선언된 v"를 그 그룹 소속으로 본다.
import type { Vec3 } from "./types";

export function parseObjGroups(text: string): { name: string; vertices: Vec3[] }[] {
  const groups: { name: string; vertices: Vec3[] }[] = [];
  let current: { name: string; vertices: Vec3[] } | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("o ")) {
      current = { name: line.slice(2).trim(), vertices: [] };
      groups.push(current);
    } else if (line.startsWith("v ") && current) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
      current.vertices.push([x, y, z]);
    }
  }
  return groups.filter((g) => g.vertices.length > 0);
}
