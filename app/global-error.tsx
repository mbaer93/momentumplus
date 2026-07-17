"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-error";

/*
 * Last-resort boundary for failures in the root layout itself. Renders its
 * own <html> because the layout didn't. Styles are inline — global CSS may
 * not have loaded when this fires. Reports home like app/error.tsx.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B1622",
          color: "#F8F6F1",
          fontFamily: "Georgia, serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 30, marginBottom: 12 }}>
            Momentum<span style={{ color: "#B8965A" }}>+</span>
          </div>
          <p
            style={{
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: 15,
              color: "rgba(248,246,241,0.8)",
              maxWidth: 420,
              lineHeight: 1.6,
            }}
          >
            Something went wrong loading Momentum+. It&apos;s usually
            momentary.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 18,
              padding: "11px 26px",
              borderRadius: 4,
              border: "none",
              background: "linear-gradient(135deg,#B8965A,#D4AE75)",
              color: "#0B1622",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
