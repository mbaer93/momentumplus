import { Suspense } from "react";
import { ResetForm } from "./ResetForm";

export const metadata = {
  title: "Reset password | Momentum+",
};

export default function ResetPage() {
  return (
    <div className="login-inner">
      <div className="login-logo">Momentum+</div>
      <div className="login-tagline">Premium Member Portal</div>
      <Suspense fallback={<div className="login-card">Loading…</div>}>
        <ResetForm />
      </Suspense>
    </div>
  );
}
