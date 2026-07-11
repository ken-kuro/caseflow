import type { Metadata } from "next";
import CaseFlowApp from "./CaseFlowApp";

export const metadata: Metadata = {
  title: "CaseFlow — AML/KYT analyst review",
  description: "A synthetic, evidence-first AML/KYT alert-resolution prototype for GoTyme.",
};

export default function Home() {
  return <CaseFlowApp />;
}
