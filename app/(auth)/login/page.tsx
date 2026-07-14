import { Suspense } from "react";
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
    </div>
  );
}
