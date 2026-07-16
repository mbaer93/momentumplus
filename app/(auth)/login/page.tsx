import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Sign in | Momentum+",
};

export default function LoginPage() {
  return (
    <div className="login-inner">
      <div className="login-logo">Momentum+</div>
      <div className="login-tagline">Premium Member Portal</div>
      <Suspense fallback={<div className="login-card">Loading…</div>}>
        <LoginForm />
      </Suspense>
      <div style={{ textAlign: "center", marginTop: 16 }}>
        <Link href="/privacy" style={{ fontSize: 12, color: "var(--mid-gray)" }}>
          Privacy Policy
        </Link>
      </div>
    </div>
  );
}
