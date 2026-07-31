import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://bispastore.com.br"),
  title: {
    default: "Bispo Store | Tênis, Calças & Conjuntos",
    template: "%s | Bispo Store",
  },
  description: "Tênis, calças e conjuntos com curadoria urbana Bispo Store. Versão visual de demonstração.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-snippet": 0,
      "max-image-preview": "none",
      "max-video-preview": 0,
    },
  },
  icons: { icon: "/logo-bispo-store.png", shortcut: "/logo-bispo-store.png" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Bispo Store",
    title: "Bispo Store | Tênis, Calças & Conjuntos",
    description: "Tênis, calças e conjuntos com curadoria e atitude.",
    images: [{ url: "/og.png", width: 1536, height: 904, alt: "Bispo Store — tênis, calças e conjuntos" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bispo Store | Tênis, Calças & Conjuntos",
    description: "Tênis, calças e conjuntos com curadoria e atitude.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
      </body>
    </html>
  );
}
