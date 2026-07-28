import { describe, expect, it } from "vitest";
import { parseRebarsJson } from "./rebarsSchema";

const valid = JSON.stringify({
  version: 1, unit: "m",
  rebars: [
    { id: "r0", centerline: [[0, 0, 0], [0, 2, 0]], radius: 0.008 },
    { id: "r1", centerline: [[0.3, 0, 0], [0.3, 2, 0]], radius: 0.008 },
  ],
});

describe("parseRebarsJson", () => {
  it("accepts a valid file", () => {
    const r = parseRebarsJson(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rebars.length).toBe(2);
  });
  it("rejects malformed JSON", () => {
    expect(parseRebarsJson("{oops").ok).toBe(false);
  });
  it("rejects wrong unit", () => {
    const r = parseRebarsJson(valid.replace('"m"', '"mm"'));
    expect(r.ok).toBe(false);
  });
  it("rejects single-point centerline", () => {
    const bad = JSON.stringify({
      version: 1, unit: "m", rebars: [{ id: "r0", centerline: [[0, 0, 0]], radius: 0.008 }],
    });
    expect(parseRebarsJson(bad).ok).toBe(false);
  });
  it("rejects NaN coordinates", () => {
    const bad = valid.replace("0.3", "null");
    expect(parseRebarsJson(bad).ok).toBe(false);
  });
  it("rejects duplicate ids", () => {
    const bad = valid.replaceAll('"r1"', '"r0"');
    const r = parseRebarsJson(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("중복");
  });
  it("rejects empty rebars array", () => {
    const bad = JSON.stringify({ version: 1, unit: "m", rebars: [] });
    expect(parseRebarsJson(bad).ok).toBe(false);
  });
  it("rejects radius out of range", () => {
    const bad = valid.replaceAll("0.008", "0.2");
    expect(parseRebarsJson(bad).ok).toBe(false);
  });
});
