import type { ReplayedResults } from "../contracts/api";
import { Banner } from "./components";
import { REPLAYED } from "./labels";

/** Shown wherever a meeting's results include recorded replies, so none passes as a live call. */
export function ReplayedBanner({ replayed }: { replayed: ReplayedResults }) {
  const { model, transcription } = replayed;
  if (!model && !transcription) return null;
  const what =
    model && transcription
      ? "The transcript and the model's work in this meeting (decisions found, questions, drafted wording)"
      : transcription
        ? "The transcript of this meeting"
        : "The model's work in this meeting (decisions found, questions, drafted wording)";
  return (
    <Banner label={REPLAYED}>
      {what} {model && transcription ? "are" : "is"} played back from earlier recorded replies, not
      made by live calls.
    </Banner>
  );
}
