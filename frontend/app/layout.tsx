import type { Metadata } from "next";
import { Geist_Mono, Baloo_2 } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Rounded, friendly display face for headings and the big pot numbers.
const baloo = Baloo_2({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Infinite Cash Point ($ICP) — last buyer wins",
  description:
    "A jackpot token on Flap: every buy resets the countdown, the last buyer takes the pot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistMono.variable} ${baloo.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#05070a] font-mono text-cream">{children}</body>
    </html>
  );
}
