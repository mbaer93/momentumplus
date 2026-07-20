"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  sendProTicketInvites,
  sendTicketInvites,
  setTeamRole,
  transferOwnership,
  updateSponsorPage,
  uploadOwnSponsorImage,
} from "@/app/(portal)/sponsor/actions";
import type { SponsorSeat } from "@/lib/sponsor-team";
import { RAIL_TIERS } from "@/lib/sponsor-tiers";

interface StudioSponsor {
  /** Normalized tier key — gates tier-dependent features like ad uploads. */
  tier: string;
  id: string;
  name: string;
  tierLabel: string;
  tagline: string;
  description: string;
  offer: string;
  website: string;
  archived: boolean;
  /** Set when the page is still pre-season (hidden from members): the date
      it goes live. Null once live, ongoing, or archived. */
  goLiveLabel: string | null;
  expiresLabel: string | null;
  /** Current artwork — shown next to the upload inputs so a failed or
      forgotten upload is visible instead of silently absent. */
  logoUrl: string | null;
  sidebarAdUrl: string | null;
}

interface SponsorStudioViewProps {
  sponsor: StudioSponsor;
  team: SponsorSeat[];
  viewerProfileId: string;
  isOwner: boolean;
  isSuperAdmin: boolean;
  ticketAllotment: number;
  ticketsUsed: number;
  /** Admin-granted full Momentum+ Pro tickets (one year each). */
  proTicketAllotment?: number;
  proTicketsUsed?: number;
}

const ROLE_LABEL: Record<SponsorSeat["role"], string> = {
  owner: "Primary manager",
  manager: "Manager",
  member: "Team member",
};

export function SponsorStudioView({
  sponsor,
  team,
  viewerProfileId,
  isOwner,
  isSuperAdmin,
  ticketAllotment,
  ticketsUsed,
  proTicketAllotment = 0,
  proTicketsUsed = 0,
}: SponsorStudioViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [tagline, setTagline] = useState(sponsor.tagline);
  const [description, setDescription] = useState(sponsor.description);
  const [offer, setOffer] = useState(sponsor.offer);
  const [website, setWebsite] = useState(sponsor.website);
  const [ticketEmails, setTicketEmails] = useState("");
  const [proEmails, setProEmails] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [adFile, setAdFile] = useState<File | null>(null);
  const [transferTo, setTransferTo] = useState("");

  const remaining = Math.max(0, ticketAllotment - ticketsUsed);
  const proRemaining = Math.max(0, proTicketAllotment - proTicketsUsed);

  function run(
    fn: () => Promise<{ ok: boolean; message?: string }>,
    onOk?: () => void,
  ) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Done." : "Error") });
        if (res.ok) {
          onOk?.();
          router.refresh();
        }
      } catch {
        setMsg({ ok: false, text: "That didn't save — refresh this page and try again (the app may have just been updated)." });
      }
    });
  }

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Sponsor Studio</h2>
          <p>
            {sponsor.name} · {sponsor.tierLabel}
            {sponsor.expiresLabel ? ` · live through ${sponsor.expiresLabel}` : ""}
          </p>
        </div>
        <Link href={`/sponsors/${sponsor.id}`} className="btn-mini">
          View public page
        </Link>
      </div>

      {isSuperAdmin && !isOwner && (
        <div className="admin-hint">
          You&apos;re viewing this studio as a Super Admin.
        </div>
      )}
      {sponsor.archived && (
        <div className="admin-hint">
          This sponsorship is archived — the page is hidden from members until
          the Momentum+ team reinstates it.
        </div>
      )}
      {sponsor.goLiveLabel && (
        <div className="admin-hint">
          Your page goes live to members on <strong>{sponsor.goLiveLabel}</strong>{" "}
          — until then only your team and the Momentum+ team can see it. Build
          it out now and it appears automatically.
        </div>
      )}
      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginBottom: 12 }}
        >
          {msg.text}
        </div>
      )}

      {/* ---- Page content (owner + managers) ---- */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>Your page</h3>
        <form
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              updateSponsorPage(sponsor.id, {
                tagline,
                description,
                offer,
                website,
              }),
            );
          }}
        >
          <div className="admin-field">
            <label htmlFor="sp-tagline">Tagline</label>
            <input
              id="sp-tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="One line under your name"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="sp-desc">About</label>
            <textarea
              id="sp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell members about your business…"
              rows={5}
            />
          </div>
          <div className="admin-field-row">
            <div className="admin-field">
              <label htmlFor="sp-offer">Member offer</label>
              <input
                id="sp-offer"
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                placeholder="e.g. 15% off for Momentum+ members"
              />
            </div>
            <div className="admin-field">
              <label htmlFor="sp-web">Website</label>
              <input
                id="sp-web"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>
          <div className="admin-field-row">
            <div className="admin-field">
              <label htmlFor="sp-logo-up">Logo (PNG/JPG/SVG/WebP, 2 MB)</label>
              <div style={{ marginBottom: 6 }}>
                {sponsor.logoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={sponsor.logoUrl}
                    alt={`${sponsor.name} current logo`}
                    style={{ maxHeight: 40, maxWidth: 140, objectFit: "contain" }}
                  />
                ) : (
                  <span style={{ fontSize: 11.5, color: "var(--mid-gray)" }}>
                    No logo yet — your page shows a text placeholder until you
                    add one.
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  id="sp-logo-up"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="btn-mini"
                  disabled={pending || !logoFile}
                  onClick={() =>
                    run(async () => {
                      const fd = new FormData();
                      fd.append("file", logoFile as File);
                      const res = await uploadOwnSponsorImage(sponsor.id, "logo", fd);
                      if (res.ok) setLogoFile(null);
                      return res;
                    })
                  }
                >
                  Upload logo
                </button>
              </div>
            </div>
            {RAIL_TIERS.has(sponsor.tier) && (
            <div className="admin-field">
              <label htmlFor="sp-ad-up">Ad artwork</label>
              <div style={{ marginBottom: 6 }}>
                {sponsor.sidebarAdUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={sponsor.sidebarAdUrl}
                    alt={`${sponsor.name} current ad artwork`}
                    style={{ maxHeight: 60, maxWidth: 140, objectFit: "contain" }}
                  />
                ) : (
                  <span style={{ fontSize: 11.5, color: "var(--mid-gray)" }}>
                    No ad artwork yet — your tier includes member-page ad
                    placements, activated by the Momentum+ team once artwork
                    is up.
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  id="sp-ad-up"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={(e) => setAdFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="btn-mini"
                  disabled={pending || !adFile}
                  onClick={() =>
                    run(async () => {
                      const fd = new FormData();
                      fd.append("file", adFile as File);
                      const res = await uploadOwnSponsorImage(sponsor.id, "ad", fd);
                      if (res.ok) setAdFile(null);
                      return res;
                    })
                  }
                >
                  Upload artwork
                </button>
              </div>
            </div>
            )}
          </div>
          <div className="admin-form-actions">
            <button type="submit" className="btn-purple" disabled={pending}>
              {pending ? "Saving…" : "Save page"}
            </button>
          </div>
        </form>
      </div>

      {/* ---- Team ---- */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Your team</h3>
        <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 12 }}>
          Managers can edit this page. Team members are tied to your
          sponsorship but can&apos;t make changes.
        </p>
        {team.map((s) => (
          <div
            key={s.profileId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "10px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                {s.name || s.email}
                {s.profileId === viewerProfileId ? " (you)" : ""}
              </div>
              <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
                {s.email}
              </div>
            </div>
            <span className="admin-status draft">{ROLE_LABEL[s.role]}</span>
            {isOwner && s.role === "member" && (
              <button
                type="button"
                className="btn-mini"
                disabled={pending || !s.regularMember}
                title={
                  s.regularMember
                    ? "Allow them to edit the page"
                    : "Needs their own regular Momentum+ membership first"
                }
                onClick={() => run(() => setTeamRole(sponsor.id, s.profileId, "manager"))}
              >
                Make manager
              </button>
            )}
            {isOwner && s.role === "manager" && (
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                onClick={() => run(() => setTeamRole(sponsor.id, s.profileId, "member"))}
              >
                Remove manager access
              </button>
            )}
            {isOwner && s.role === "member" && !s.regularMember && (
              <span style={{ fontSize: 11.5, color: "var(--mid-gray)" }}>
                Needs a regular membership to co-manage
              </span>
            )}
          </div>
        ))}

        {isOwner && team.some((s) => s.role === "manager") && (
          <div style={{ marginTop: 14 }}>
            <div className="admin-field" style={{ maxWidth: 420 }}>
              <label htmlFor="sp-transfer">Transfer ownership</label>
              {/* Managers only (Matt, 2026-07-20): a VIP-ticket guest must
                  not inherit the page and its free membership. */}
              <select
                id="sp-transfer"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
              >
                <option value="">Choose a manager…</option>
                {team
                  .filter((s) => s.role === "manager")
                  .map((s) => (
                    <option key={s.profileId} value={s.profileId}>
                      {s.name || s.email}
                    </option>
                  ))}
              </select>
              <span style={{ fontSize: 11.5, color: "var(--mid-gray)" }}>
                Ownership can only pass to a current manager — promote your
                successor first.
              </span>
            </div>
            <button
              type="button"
              className="btn-mini danger"
              disabled={pending || !transferTo}
              onClick={() => {
                const target = team.find((s) => s.profileId === transferTo);
                if (
                  target &&
                  confirm(
                    `Transfer ownership of ${sponsor.name} to ${target.name || target.email}? The sponsorship's free membership moves with it; you stay on as a manager.`,
                  )
                ) {
                  run(() => transferOwnership(sponsor.id, transferTo));
                }
              }}
            >
              Transfer ownership
            </button>
          </div>
        )}
      </div>

      {/* ---- Momentum+ Pro tickets (owner only; admin-granted) ---- */}
      {isOwner && proTicketAllotment > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>Momentum+ Pro tickets</h3>
          <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 12 }}>
            The Momentum+ team has granted your sponsorship {proTicketAllotment}{" "}
            full Momentum+ Pro membership{proTicketAllotment === 1 ? "" : "s"} —
            one year of everything Pro includes, free, for people you choose.{" "}
            {proRemaining} remaining. Each person gets an email invite to set up
            their own profile.
          </p>
          {proRemaining > 0 ? (
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => sendProTicketInvites(sponsor.id, proEmails),
                  () => setProEmails(""),
                );
              }}
            >
              <div className="admin-field">
                <label htmlFor="sp-pro-tickets">Email addresses</label>
                <textarea
                  id="sp-pro-tickets"
                  value={proEmails}
                  onChange={(e) => setProEmails(e.target.value)}
                  placeholder={"one@example.com\ntwo@example.com"}
                  rows={3}
                />
              </div>
              <div className="admin-form-actions">
                <button
                  type="submit"
                  className="btn-purple"
                  disabled={pending || !proEmails.trim()}
                >
                  {pending ? "Sending…" : "Send Pro invites"}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
              All Pro tickets are in use.
            </div>
          )}
        </div>
      )}

      {/* ---- VIP tickets (owner only) ---- */}
      {isOwner && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>VIP access tickets</h3>
          <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 12 }}>
            Your {sponsor.tierLabel} package includes {ticketAllotment} VIP
            access ticket{ticketAllotment === 1 ? "" : "s"} — free 3-month VIP
            access for people you choose. {remaining} remaining. Each person
            gets an email invite to set up their own profile.
          </p>
          {remaining > 0 ? (
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => sendTicketInvites(sponsor.id, ticketEmails),
                  () => setTicketEmails(""),
                );
              }}
            >
              <div className="admin-field">
                <label htmlFor="sp-tickets">Email addresses</label>
                <textarea
                  id="sp-tickets"
                  value={ticketEmails}
                  onChange={(e) => setTicketEmails(e.target.value)}
                  placeholder={"one@example.com\ntwo@example.com"}
                  rows={3}
                />
              </div>
              <div className="admin-form-actions">
                <button
                  type="submit"
                  className="btn-purple"
                  disabled={pending || !ticketEmails.trim()}
                >
                  {pending ? "Sending…" : "Send VIP invites"}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
              {ticketAllotment === 0
                ? "Your package doesn't include VIP tickets — talk to the Momentum+ team about upgrading."
                : "All tickets are in use."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
