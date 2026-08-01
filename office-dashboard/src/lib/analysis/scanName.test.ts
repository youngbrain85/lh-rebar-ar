import { describe, expect, it } from "vitest";
import { formatWhen, scanDisplayName } from "./scanName";

describe("formatWhen", () => {
  it("초 있는 ISO → 분까지", () => {
    expect(formatWhen("2026-07-30T21:15:07.123Z")).toBe("2026-07-30 21:15");
  });
  it("분까지만 있는 ISO도 처리", () => {
    expect(formatWhen("2026-07-30T21:15")).toBe("2026-07-30 21:15");
  });
  it("빈 값·형식 불일치 → 빈 문자열", () => {
    expect(formatWhen(null)).toBe("");
    expect(formatWhen("")).toBe("");
    expect(formatWhen("2026/07/30 21:15")).toBe("");
  });
});

describe("scanDisplayName", () => {
  it("이름 + 촬영 날짜/시간", () => {
    expect(scanDisplayName({ label: "B동 옹벽 東면", captured_at: "2026-07-30T21:15" }))
      .toBe("B동 옹벽 東면 · 2026-07-30 21:15");
  });
  it("이름 없으면 촬영 시각만", () => {
    expect(scanDisplayName({ captured_at: "2026-07-30T21:15:00Z" })).toBe("스캔 2026-07-30 21:15");
  });
  it("촬영 시각이 없으면 업로드 시각으로 대체", () => {
    expect(scanDisplayName({ uploaded_at: "2026-08-01T00:20:02.101Z" })).toBe("스캔 2026-08-01 00:20");
  });
  it("둘 다 없으면 scan_id 앞 8자", () => {
    expect(scanDisplayName({ scan_id: "050bd56c-b645-4e87" })).toBe("스캔 050bd56c");
  });
  it("공백만 있는 label은 이름으로 치지 않는다", () => {
    expect(scanDisplayName({ label: "   ", captured_at: "2026-07-30T21:15" })).toBe("스캔 2026-07-30 21:15");
  });
});
