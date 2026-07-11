import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: "CaseFlow — AML/KYT analyst review",
    description: "Evidence-first, policy-cited alert resolution with governed human review.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "CaseFlow",
      description: "Evidence-first AML/KYT alert resolution",
      images: [{ url: `${origin}/og.png`, width: 1728, height: 909, alt: "CaseFlow evidence timeline, decision packet, and human approval gate" }],
    },
    twitter: { card: "summary_large_image", title: "CaseFlow", description: "Evidence-first AML/KYT alert resolution", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
