import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * THE FONT IS THE BRAND. The app shipped on ui-sans-serif, which renders as
 * whatever the OS defaults to — the single loudest "nobody chose this" signal
 * an interface can send. Inter is what the products this one is measured
 * against (Linear, Figma, Vercel) actually run on, and next/font self-hosts
 * it at build time: no runtime fetch, no layout shift, no third-party request.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { withAuth } from "@workos-inc/authkit-nextjs";
import type { UserInfo, NoUserInfo } from "@workos-inc/authkit-nextjs";

export const metadata: Metadata = {
  title: "Namzilabs — all your tools' data in one place",
  description: "Unify Calendly, Close, Instantly, Google Sheets and more into one reliable dashboard.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Seed the client provider with server-known auth so it skips the initial
  // client fetch. Wrapped defensively so build-time rendering never fails.
  let initialAuth: Omit<UserInfo | NoUserInfo, "accessToken"> | undefined;
  try {
    const { accessToken: _accessToken, ...rest } = await withAuth();
    initialAuth = rest;
  } catch {
    initialAuth = undefined;
  }

  return (
    <html lang="en">
      <body className={inter.variable}>
        <AuthKitProvider initialAuth={initialAuth}>{children}</AuthKitProvider>
      </body>
    </html>
  );
}
