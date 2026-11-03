import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "J.A.R.V.I.S. — Holographic Console",
  description:
    "A JARVIS-style holographic orb console rebuilt from the original Ultron source. Three.js orb, hand-gesture tracking, and an AI assistant.",
  keywords: ["JARVIS", "ULTRON", "Three.js", "holographic orb", "AI assistant", "Next.js"],
  // No `icons` entry on purpose. This previously pointed the browser tab at
  // https://z-cdn.chatglm.cn/z-ai/static/logo.svg — third-party GLM/Z.ai
  // scaffold branding left over in the JARVIS shell. That mislabelled the
  // product in the tab and made a loopback-only development console issue a
  // request to a foreign CDN on every load (an offline-build and privacy
  // liability). The owner should supply a JARVIS/ULTRON-derived icon under
  // public/ and reference it here; note that public/logo.svg is ALSO the Z.ai
  // "Z" mark and must not be reused as the JARVIS icon.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
