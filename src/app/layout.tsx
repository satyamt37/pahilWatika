import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { AudioProvider } from "@/components/AudioPlayer";
import { ToastProvider } from "@/components/toast";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "पाहिल वाटिका योगा ग्रुप, खजुराहो", template: "%s · पाहिल वाटिका" },
  description: "Pahil Vatika Yoga Group, Khajuraho — एक परिवार, एक पहचान। योग से स्वास्थ्य, साथ से खुशियाँ।",
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon.svg` },
  manifest: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/manifest.webmanifest`,
};

export const viewport: Viewport = {
  themeColor: "#183D32",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Devanagari:wght@400;500;600;700&family=Tiro+Devanagari+Hindi&display=swap"
        />
      </head>
      <body className="bg-cream font-sans text-forest-900 antialiased">
        <ToastProvider>
          <AuthProvider>
            <AudioProvider>
              <AppShell>{children}</AppShell>
            </AudioProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
