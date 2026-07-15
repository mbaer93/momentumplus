"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkAddMembers } from "@/app/(portal)/admin/members/actions";

/*
 * Paste-a-list member importer. One line per member:
 *   email, Full Name, plan
 * New members get an invite email that lands on /welcome to set a password.
 */
export function BulkAddMembers() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [results, setResults] = useState<string[]>([]);

  function runImport() {
    setSummary(null);
    setResults([]);
    startTransition(async () => {
      try {
        const res = await bulkAddMembers(csv);
        setSummary(
          res.message ? { text: res.message, ok: res.ok } : null,
        );
        setResults(res.results ?? []);
        if (res.ok) {
          setCsv("");
          router.refresh();
        }
      } catch {
        setSummary({
          text: "Import failed — check your connection and try again.",
          ok: false,
        });
      }
    });
  }

  return (
    <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
      <div className="admin-field" style={{ marginBottom: 4 }}>
        <label style={{ fontSize: 13 }}>Bulk add members</label>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 8 }}>
        Paste one member per line: <strong>email, Full Name, plan</strong>.
        Plans: basic, gift (free Basic, 1 month), vip (free Basic-level, 3
        months), pro, monthly, 3month, 6month, 12month (or annual), attendee,
        speaker. New members receive an invite email and set their password on
        first login. Re-importing the same person is safe — no double-grants.
        Up to 200 lines per run.
      </div>
      <div className="admin-field">
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={5}
          placeholder={
            "jane@company.com, Jane Rivers, 12month\nmarcus@firm.com, Marcus Lee, monthly"
          }
          style={{ fontFamily: "monospace", fontSize: 12.5 }}
          aria-label="Members to import"
        />
      </div>
      <div className="admin-form-actions">
        <button
          type="button"
          className="btn-purple"
          disabled={pending || !csv.trim()}
          onClick={runImport}
        >
          {pending ? "Importing…" : "Import members"}
        </button>
        {summary && (
          <span className={`admin-form-msg ${summary.ok ? "ok" : "err"}`}>
            {summary.text}
          </span>
        )}
      </div>
      {results.length > 0 && (
        <ul
          style={{
            marginTop: 10,
            fontSize: 12.5,
            color: "var(--mid-gray)",
            lineHeight: 1.7,
            paddingLeft: 18,
          }}
        >
          {results.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
