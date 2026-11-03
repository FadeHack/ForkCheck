import { loadEnv } from "@forkcheck/config";
import { checkedDimensionsNote, parseProbeDimensions } from "@forkcheck/core";

/** Says which dimensions questions cover when PROBE_DIMENSIONS narrows them; renders nothing otherwise. */
export function CheckedDimensions() {
  const note = checkedDimensionsNote(parseProbeDimensions(loadEnv().PROBE_DIMENSIONS));
  return note ? <p role="note">{note}</p> : null;
}
