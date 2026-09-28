import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { UiProvider } from "@/components/ui-provider";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "Control Room — The Accelerator", template: "%s — Control Room" },
  description: "Run your site from one place: requests, changes, proof, data, knowledge and health.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen">
        <UiProvider>{children}</UiProvider>
      </body>
    </html>
  );
}
