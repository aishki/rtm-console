import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter is the BITS UI face for numbers, timers, table headers and IDs.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RTM Console · Real-Time Monitoring & Escalation",
  description: "Live-floor monitoring, rules engine and escalation ladder for CGSPH.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
