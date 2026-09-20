import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";

import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

import "./globals.css";

export const metadata: Metadata = {
  title: "ArcPay Link — Payments, without the friction",
  description:
    "Create a payment link. Share it anywhere. Receive USDC directly on Arc mainnet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        {/* Both Sentient faces paint the hero headline (the LCP element), so
            both are preloaded. They total ~45 KB and swap-load otherwise. */}
        <link
          rel="preload"
          href="/Sentient-Extralight.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/Sentient-LightItalic.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${GeistMono.variable} antialiased`}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
