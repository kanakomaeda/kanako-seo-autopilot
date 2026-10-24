import type { Metadata } from "next";
import "./globals.css";

const siteUrl = "https://kanako-seo-autopilot-mu.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Kanako SEO AutoPilot",
  description: "Clear, evidence-aware initial HTML SEO checks for public web pages.",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Kanako SEO AutoPilot",
    title: "Kanako SEO AutoPilot",
    description: "Clear, evidence-aware initial HTML SEO checks for public web pages.",
  },
  twitter: {
    card: "summary",
    title: "Kanako SEO AutoPilot",
    description: "Clear, evidence-aware initial HTML SEO checks for public web pages.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
