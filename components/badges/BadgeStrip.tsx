import type { BadgeTier, MemberBadges } from "@/lib/badges";
import { tierFor, unitLabel } from "@/lib/badges";
import { BADGE_TRACKS } from "@/lib/badges";

/*
 * A member's badges, in full — their own profile.
 *
 * Shows UNEARNED tracks too, with what the next tier costs. A wall of
 * things you already have motivates nobody; "4 more sessions" is the whole
 * point of the thing. The compact views (directory, chat) show only the
 * overall level, which is why LevelChip exists separately.
 *
 * Colours are the brand's: gold for gold, and two muted metals that clear
 * AA on cream. Tier is never carried by colour ALONE — the tier word is in
 * the label — because a colour-only signal is invisible to a colourblind
 * member and to anyone reading a screen reader.
 */

const TIER_STYLE: Record<BadgeTier, { bg: string; border: string; ink: string }> = {
  bronze: { bg: "rgba(138, 106, 74, 0.10)", border: "rgba(138, 106, 74, 0.45)", ink: "#6f523a" },
  silver: { bg: "rgba(90, 102, 112, 0.10)", border: "rgba(90, 102, 112, 0.40)", ink: "#4a5560" },
  gold: { bg: "var(--gold-pale, rgba(184,150,90,0.12))", border: "rgba(184, 150, 90, 0.55)", ink: "var(--gold-text)" },
};

const TIER_LABEL: Record<BadgeTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

export function BadgeStrip({ badges }: { badges: MemberBadges }) {
  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 4,
        }}
      >
        <h3 style={{ fontSize: 15 }}>Your engagement</h3>
        <span style={{ fontSize: 13, color: "var(--gold-text)", fontWeight: 600 }}>
          {badges.level.label}
        </span>
      </div>
      <p
        style={{
          fontSize: 12.5,
          color: "var(--ink-secondary)",
          margin: "0 0 14px",
          lineHeight: 1.55,
        }}
      >
        {badges.hidden
          ? "Only you can see these — you've hidden them from other members."
          : "Your level shows next to your name in the directory and the community."}
      </p>

      {badges.milestones.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {badges.milestones.map((m) => (
            <span
              key={m.key}
              title={m.description}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: 4,
                background: "var(--navy)",
                color: "var(--cream, #F8F6F1)",
              }}
            >
              {m.label}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 10,
        }}
      >
        {badges.tracks.map((t) => {
          const def = BADGE_TRACKS.find((d) => d.key === t.key);
          const earned = def ? tierFor(t.count, def.thresholds) : null;
          const style = earned ? TIER_STYLE[earned] : null;
          return (
            <div
              key={t.key}
              style={{
                border: `1px solid ${style?.border ?? "var(--warm-gray, #E8E4DC)"}`,
                background: style?.bg ?? "transparent",
                borderRadius: 4,
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: style?.ink ?? "var(--ink-secondary)",
                  marginBottom: 2,
                }}
              >
                {t.label}
                {earned ? ` — ${TIER_LABEL[earned]}` : ""}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                {t.count} {def ? unitLabel(def.unit, t.count) : ""}
                {t.nextAt !== null && (
                  <>
                    {" · "}
                    {t.nextAt - t.count} more for{" "}
                    {earned === "bronze" ? "Silver" : earned === "silver" ? "Gold" : "Bronze"}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
