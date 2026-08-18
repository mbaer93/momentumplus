/*
 * The compact form: one word next to a name, in the directory and on chat
 * messages.
 *
 * One chip, not six badges. A directory row has space for a name, a title,
 * a company and about two more words — six badges there would bury the
 * information members actually came for. The full picture is on the
 * member's own profile.
 *
 * Renders NOTHING at the lowest level. A brand-new member does not need
 * "Getting Started" stamped next to their name in front of the whole
 * community; the point is to reward engagement, not to label its absence.
 */

export function LevelChip({
  label,
  levelKey,
  size = "sm",
}: {
  label: string;
  levelKey: string;
  size?: "sm" | "xs";
}) {
  if (levelKey === "start") return null;
  return (
    <span
      title={`Momentum+ engagement: ${label}`}
      style={{
        display: "inline-block",
        fontSize: size === "xs" ? 10.5 : 11.5,
        fontWeight: 600,
        letterSpacing: 0.2,
        padding: size === "xs" ? "1px 6px" : "2px 8px",
        borderRadius: 4,
        border: "1px solid rgba(184, 150, 90, 0.5)",
        background: "var(--gold-pale, rgba(184,150,90,0.12))",
        color: "var(--gold-text)",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      {label}
    </span>
  );
}
