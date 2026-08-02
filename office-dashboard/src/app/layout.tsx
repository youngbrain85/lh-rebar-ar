import "@mantine/core/styles.css";
import "./globals.css";

import type { Metadata } from "next";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import { theme } from "../theme";

// 계측기·도면 톤: 본문은 한글을 지원하는 IBM Plex Sans KR,
// 치수·ID 등 숫자는 IBM Plex Mono(고정폭)로 자리수를 맞춘다.
const sans = IBM_Plex_Sans_KR({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BriconLab 현장 대시보드",
  description: "현장 관리 · 3D 모델 · 시공 분석 · 실시간 AR 협업",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="light">
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
