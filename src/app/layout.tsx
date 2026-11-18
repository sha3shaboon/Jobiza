import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono, Noto_Naskh_Arabic, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });
const display = Fraunces({ variable: "--font-display", subsets: ["latin"], axes: ["opsz"] });
const arabic = Noto_Naskh_Arabic({ variable: "--font-arabic", subsets: ["arabic"], weight: ["500"] });

export const metadata: Metadata = {
  title: { default: "Jobiza — plant your sources, watch your research grow", template: "%s · Jobiza" },
  description:
    "A research library that grows on its own, like خُبَّيْزَة after the rain. Chat with your papers, grow literature reviews and write with every claim cited. Powered by Claude, with your own API key.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} ${arabic.variable} ${display.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
