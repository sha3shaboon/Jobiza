import type { Metadata, Viewport } from "next";
import { Fraunces, Noto_Naskh_Arabic, Readex_Pro } from "next/font/google";
import "./globals.css";

/* Readex Pro: one family for Latin and Arabic, used for all interface and reading text. */
const readex = Readex_Pro({ variable: "--font-readex", subsets: ["latin", "arabic"], weight: "variable" });
/* Fraunces and Noto Naskh appear only inside the logo lockup. */
const display = Fraunces({ variable: "--font-display", subsets: ["latin"], axes: ["opsz"] });
const naskh = Noto_Naskh_Arabic({ variable: "--font-naskh", subsets: ["arabic"], weight: ["500"] });

export const metadata: Metadata = {
  title: { default: "Jobiza: ask your papers, see the page", template: "%s | Jobiza" },
  description:
    "Ask questions of the papers you're reading and get answers that cite the exact page. Build literature reviews and write with every claim sourced. Powered by Claude, with your own API key.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#183021" },
    { media: "(prefers-color-scheme: dark)", color: "#132619" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${readex.variable} ${display.variable} ${naskh.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
