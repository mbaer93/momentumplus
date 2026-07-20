import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Sign in | TSLS Summit Companion",
};

export default function LoginPage() {
  return (
    <div className="login-inner">
        <div className="login-logo">TSLS</div>
        <div className="login-tagline">Tri-State Leadership Summit Companion</div>
        <Suspense fallback={<div className="login-card">Loading…</div>}>
          <LoginForm />
        </Suspense>
        <div
          style={{
            textAlign: "center",
            marginTop: 16,
            fontSize: 12,
            color: "var(--mid-gray)",
          }}
        >
          Registered for the summit? Sign in with the email you registered
          with — we&apos;ll send you a one-tap sign-in link.
      </div>
    </div>
  );
}
