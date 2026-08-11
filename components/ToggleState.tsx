/*
 * The word "On" / "Off" printed beside a .pref-toggle switch.
 *
 * Matt, twice: "I still can't tell if the toggles are on or off." Two passes
 * at the switch itself (a border, then a ring on the knob) both measured
 * better and both still failed in use, so the state is now also written out
 * in words. Text is the one cue that doesn't depend on seeing a colour, a
 * 1px edge, or which end of a 34px pill a circle is sitting at.
 *
 * aria-hidden: a checkbox already announces "checked"/"not checked" to
 * assistive tech, so this would only be a duplicate reading. It exists for
 * the eye.
 */
export function ToggleState({ on }: { on: boolean }) {
  return (
    <span className="toggle-state" aria-hidden="true">
      {on ? "On" : "Off"}
    </span>
  );
}
