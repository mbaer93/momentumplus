import { Suspense } from "react";
import { WelcomeForm } from "./WelcomeForm";

export const metadata = {
  title: "Welcome | Momentum+",
};

/*
 * First-login landing for invited members: the invite email signs them in
 * via /auth/callback?redirect=/welcome; here they set a password (and can
 * confirm their name) before entering the portal.
 */
export default function WelcomePage() {
  return (
    <div className="login-inner">
      <div className="login-logo">Momentum+</div>
      <div className="login-tagline">Premium Member Portal</div>
      <Suspense fallback={<div className="login-card">Loading…</div>}>
        <WelcomeForm />
      </Suspense>
    </div>
  );
}
