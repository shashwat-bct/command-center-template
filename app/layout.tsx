import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Commercial Command Center",
  description: "Atlas Commercial Command Center dashboard template",
};

export default function RootLayout(props: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Google Fonts via <link> — next/font would require unrestricted network
            at Cloud Build time to download fonts for optimisation, which fails
            on the webpack path. The browser hits Google Fonts directly instead. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Spline+Sans+Mono:wght@400;500;600&family=Urbanist:wght@400;500;600;700;800;900&display=swap"
        />
      </head>
      <body className="min-h-full">{props.children}</body>
    </html>
  );
}
