import { createTheme } from "@mantine/core";

/// BriconLab brand navy — sampled from briconlab.com (#002961) — on white.
export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: 9,
  defaultRadius: "md",
  colors: {
    brand: [
      "#eaf0fb", // 0
      "#d5e0f5",
      "#aac2ea",
      "#7da1de",
      "#5685d4",
      "#3a70cd",
      "#2c64c9",
      "#1d53b2",
      "#0e4292",
      "#002961", // 9 — BriconLab navy
    ],
  },
  headings: {
    fontWeight: "700",
  },
});
