import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Kanako SEO AutoPilot", description: "Clear, evidence-aware initial HTML SEO checks." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
