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
    "A local TrustLayer workspace with injected wallet connection and verified contract reads. Project transactions are not enabled.",
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
