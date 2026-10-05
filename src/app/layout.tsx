import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// Fonts are self-hosted (SIL OFL 1.1, files + licences in ./fonts) so builds never depend on downloading them.
// IBM Plex Sans Arabic ships as Arabic + Latin subsets (like Google Fonts); globals.css stacks both.
const plex = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-arabic",
  display: "swap",
});
const plexLatin = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-arabic-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-latin",
  display: "swap",
});

// Literary face reserved for trusted source text (matn) and the wordmark.
const naskh = localFont({
  src: [
    { path: "./fonts/noto-naskh-arabic-arabic-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/noto-naskh-arabic-arabic-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/noto-naskh-arabic-arabic-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-naskh-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "تفقّه | تعلّم الفقه بخطوات واضحة",
    template: "%s · تفقّه",
  },
  description:
    "مسار تعليمي متدرج في الفقه الحنبلي يجمع بين المادة العلمية المعتمدة والاختبارات التكيفية لمعرفة ما أتقنته وما يحتاج إلى مراجعة.",
  applicationName: "تفقّه",
};

export const viewport: Viewport = {
  themeColor: "#f8f5ee",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={`${plex.variable} ${plexLatin.variable} ${naskh.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
