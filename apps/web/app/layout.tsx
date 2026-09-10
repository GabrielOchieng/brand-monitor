import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = { title: "Brand Monitor — POC" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-gray-800 px-6 py-4">
          <nav className="flex items-center gap-6">
            <span className="font-semibold text-gray-100">Brand Monitor <span className="text-gray-500 font-normal">POC v0</span></span>
            <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-100">Dashboard</Link>
            <Link href="/threats" className="text-sm text-gray-400 hover:text-gray-100">Threats</Link>
          </nav>
        </header>
        <main className="px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
