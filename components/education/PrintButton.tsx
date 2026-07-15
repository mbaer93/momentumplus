"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      className="btn-gold no-print"
      onClick={() => window.print()}
    >
      Print certificate
    </button>
  );
}
