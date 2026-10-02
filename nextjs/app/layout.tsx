import type { Metadata } from "next";
import { Newsreader, Urbanist, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

const urbanist = Urbanist({
  variable: "--font-urbanist",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Commercial Command Center",
  description: "Atlas Commercial Command Center dashboard template",
};

export default function RootLayout(props: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${urbanist.variable} ${splineMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{props.children}</body>
    </html>
  );
}
