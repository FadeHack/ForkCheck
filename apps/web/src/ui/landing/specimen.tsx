import type { Answer, Participant, Split } from "@forkcheck/core";
import { ForkView } from "../components";

/**
 * One split from the sample meeting, drawn by the same component as a real reveal. The question
 * and options are the recorded draft for the demo transcript; the answers are the ones the demo's
 * participant briefs give (scenarios/demo/atlas-launch.json).
 */
const meetingId = "sample";
const person = (id: string, displayName: string): Participant => ({
  id,
  meetingId,
  displayName,
  isSimulated: false,
  status: "active",
});
const people = [person("nadia", "Nadia"), person("tomas", "Tomas"), person("june", "June")];

const options = [
  { id: "thu", text: "Full release accessible to all accounts by Thursday the 12th" },
  { id: "fri", text: "Full release accessible to all accounts by Friday the 13th" },
];

const split: Split = {
  id: "sample-split",
  probeId: "sample-probe",
  outcome: "split",
  validity: [],
  status: "open",
};

const answer = (participantId: string, optionId: string): Answer => ({
  id: `${participantId}-answer`,
  probeId: split.probeId,
  participantId,
  choice: "option",
  optionId,
  writeInText: null,
  mappedOptionId: null,
  mappedByModel: false,
  simulated: false,
});
const answers = [answer("nadia", "fri"), answer("tomas", "fri"), answer("june", "thu")];

export function Specimen() {
  return (
    <ForkView
      quote={{
        quote: "I want Atlas out to every customer by the end of next week.",
        segment: {
          id: "seg-4",
          participantId: "nadia",
          startMs: 21_000,
          origin: "paste",
          edited: false,
        },
      }}
      stem='For "Atlas will be out to every customer", what has to exist by "the end of next week"?'
      options={options}
      split={split}
      answers={answers}
      people={people}
      stemAs="p"
    />
  );
}
