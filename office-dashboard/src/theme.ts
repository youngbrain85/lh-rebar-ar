import { createTheme, rem } from "@mantine/core";

/// BriconLab 네이비(#002961) 기반. 계측기/도면 톤을 위해 채도를 낮춘 회청색 계조와
/// 종이빛 중립색을 함께 쓴다. 폰트는 layout.tsx가 심는 CSS 변수를 참조한다.
export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: 9,
  defaultRadius: "sm",
  fontFamily: "var(--font-sans), system-ui, sans-serif",
  fontFamilyMonospace: "var(--font-mono), ui-monospace, monospace",
  colors: {
    brand: [
      "#eef2f8", // 0
      "#dde5f0",
      "#b9c8de",
      "#93aacb",
      "#7290ba",
      "#5b7dae",
      "#4e73a9",
      "#3f6194",
      "#345684", // 8
      "#002961", // 9 — BriconLab navy
    ],
    // 종이빛 중립 — 카드/배경 계조에 쓴다
    paper: [
      "#faf9f7",
      "#f4f2ee",
      "#e9e6e0",
      "#dcd8d0",
      "#c8c3b9",
      "#a9a396",
      "#87816f",
      "#666053",
      "#4a453b",
      "#2b2823",
    ],
  },
  headings: {
    fontWeight: "600",
    sizes: {
      h1: { fontSize: rem(30), lineHeight: "1.25" },
      h2: { fontSize: rem(24), lineHeight: "1.3" },
      h3: { fontSize: rem(19), lineHeight: "1.35" },
      h4: { fontSize: rem(16), lineHeight: "1.4" },
    },
  },
  components: {
    Card: { defaultProps: { withBorder: true, radius: "sm" } },
    Paper: { defaultProps: { radius: "sm" } },
    Button: { defaultProps: { radius: "sm" }, styles: { root: { letterSpacing: "-0.01em" } } },
    Badge: { defaultProps: { radius: "sm" }, styles: { label: { fontWeight: 600 } } },
    Table: { defaultProps: { verticalSpacing: "sm", horizontalSpacing: "md" } },
    Tabs: { styles: { tab: { fontWeight: 500 } } },
  },
});
