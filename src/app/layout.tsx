import type { Metadata } from "next";
import "./globals.css";
import "./editorial.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "MacroHub · Global Macro Dashboard",
  description:
    "Inflation, growth and jobs dashboard for the United States, United Kingdom and Euro Area, with component hierarchies, history and automatic release reconciliation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
