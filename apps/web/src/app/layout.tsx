import type { Metadata } from "next";
import "./globals.css";
import { AppAuthProvider } from "@/components/auth/app-auth-provider";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.riskonradar.com"),
  title: "Risk on Radar",
  description: "Evidence-backed reliability intelligence workspace.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <AppAuthProvider>{children}</AppAuthProvider>
      </body>
    </html>
  );
}
