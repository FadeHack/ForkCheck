import type { Metadata } from "next";
import { Patrick_Hand, Public_Sans, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import type { ReactNode } from "react";
import { THEME_SCRIPT } from "../ui/theme-script";
import { ThemeSelect } from "../ui/theme-select";
import "./globals.css";
import "./components.css";

// Downloaded at build and served from this app, so pages make no third-party font request.
const sans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif" });
// The red-pencil notes beside a split, and nothing else.
const hand = Patrick_Hand({ subsets: ["latin"], weight: "400", variable: "--font-patrick-hand" });

export const metadata: Metadata = {
  title: "ForkCheck",
  description: "Find where a meeting's decisions were understood differently, and settle them.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets data-theme before hydration, so the attribute can differ.
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable} ${hand.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        <header className="site-header">
          <Link href="/" className="wordmark">
            ForkCheck
          </Link>
          <ThemeSelect />
        </header>
        {children}
      </body>
    </html>
  );
}
