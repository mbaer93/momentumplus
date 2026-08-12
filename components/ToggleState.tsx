/*
 * The state of a .pref-toggle switch, written out as a badge.
 *
 * Matt, FOUR times now: "I still can't see the position." Three passes at the
 * switch itself — a border, a ring on the knob, then a pale track with a dark
 * rim and a knob that inverts — each measured better than the last and each
 * still failed in use. The common thread is that all three asked the same
 * thing of the reader: find a small shape and work out which end of a pill it
 * is sitting at. Measuring the contrast of that shape does not help if
 * locating it is the problem.
 *
 * So the word stops being an annotation and becomes the control's readout: a
 * filled badge for ON, an outlined one for OFF. Reading "ON" needs no
 * position, no colour discrimination, and no comparison against the other
 * state to make sense — which is what every previous pass quietly required.
 * The switch is still there and still moves; it is no longer what you have to
 * decode.
 *
 * aria-hidden: a checkbox already announces "checked"/"not checked" to
 * assistive tech, so this would only be a duplicate reading. It exists for
 * the eye.
 */
export function ToggleState({ on }: { on: boolean }) {
  return (
    <span
      className={`toggle-state ${on ? "toggle-state-on" : "toggle-state-off"}`}
      aria-hidden="true"
    >
      {on ? "ON" : "OFF"}
    </span>
  );
}
