import type { Metadata } from "next";
import { landingFontVars } from "@/components/landing/fonts";
import { SignInView } from "./sign-in-view";
import styles from "./sign-in.module.css";

export const metadata: Metadata = {
  title: "Sign In",
  description:
    "Sign in to Stella with Google or a magic link — no password needed.",
  alternates: { canonical: "/sign-in" },
  robots: {
    index: false,
    follow: false,
  },
};

export default function SignInPage() {
  return (
    <div className={`stella-page ${landingFontVars} ${styles.root}`}>
      <SignInView />
    </div>
  );
}
