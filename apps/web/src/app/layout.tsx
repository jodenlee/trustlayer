import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { Providers } from "@/components/providers";
export const metadata: Metadata = {
  title: {
    default: "TrustLayer — Work built on trust",
    template: "%s | TrustLayer",
  },
  description:
    "A local interface preview for milestone escrow and independent dispute resolution. No wallet connection or transactions.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
