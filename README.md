# ForkCheck

People often leave a meeting thinking they agreed, then find out they understood the decision differently: whose job it is, what "Friday" means, what "done" includes.

ForkCheck reads a meeting transcript, either pasted or transcribed from a recording, and finds decisions whose details could be read more than one way. It then:

1. asks each participant short private questions about those details;
2. compares the answers by option, in code rather than with a model;
3. lets participants settle any difference in their own words;
4. checks the new wording with a follow-up question about its consequences;
5. writes a decision record that links back to the source and sorts each item as stated in the meeting, confirmed by participants, or unresolved.

## Setup

You need Node 24 or later, Docker (for Postgres), and pnpm (if it is missing, `corepack enable` installs it). ffmpeg is needed only to upload recordings.

```sh
pnpm install
cp .env.example .env.local
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000. With the default `LIVE=0`, nothing leaves your machine: every model reply comes from a recording in `packages/ai/fixtures`, and the screens say so with a "Replayed." note.

## Run the demo

The demo meeting, "Atlas launch sync", is in `scenarios/demo/atlas-launch.json`. Three people agree to launch "end of next week" and that "marketing" writes the help center page, and each of them reads both differently. Its model replies are recorded, so it runs offline.

To watch it run end to end, three times (precise resolutions, vague ones, and precise with names hidden from the model):

```sh
pnpm --filter @forkcheck/web exec playwright install chromium
pnpm e2e demo --project desktop
```

To run it by hand:

1. Print the transcript with `node -p "require('./scenarios/demo/atlas-launch.json').transcript"`.
2. On the start page, enter the title `Atlas launch sync`, the date and time `2026-11-03 10:00`, the time zone `America/New_York`, and the participants `Nadia`, `Tomas` and `June`, one per line. Paste the transcript, tick the consent box and create the meeting check.
3. Open the organizer link and select **Draft questions**, then publish them.
4. Open each participant link in its own tab and answer. To see splits, answer the launch question and the help center question differently for different people.
5. Reveal the answers. For each split, propose a resolution in a participant tab and confirm it from all three. Offline, only the wordings in the file's `scriptedResolutions` have recorded rechecks; the precise ones settle the split and the vague ones split again.
6. Send the recheck from the organizer view, answer it, then open the record.

Offline mode replays only meetings whose model requests were recorded. Any other meeting needs live calls.

## Live mode

Set `LIVE=1` and `MODEL_API_KEY` in `.env.local` and restart `pnpm dev`. Analysis uses Meta's Muse Spark model and recordings use Muse Voice Transcribe. `SPEND_CAP_USD` (default 100) stops live calls once the total spend logged in `var/spend.json` reaches it. If the API can't be reached, the app falls back to a recorded reply where one exists and labels it as replayed.

Other commands:

| Command              | What it does                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`        | lint, format check, typecheck, dependency rules and unit tests (in-memory Postgres, no Docker needed)                  |
| `pnpm e2e`           | browser tests against the dev server, desktop and mobile                                                               |
| `pnpm eval validate` | checks every scenario file; `packages/eval/scripts/eval.ts` lists the evaluation commands, most of which need `LIVE=1` |

## Privacy defaults

- A meeting check and everything in it (transcript, answers, resolutions, record, recording) is deleted 7 days after it is created. The organizer can delete it sooner from the organizer view.
- A recording is deleted when the organizer finishes reviewing the transcript, unless they choose to keep it for playback in the record.
- With `LIVE=1`, a recording is sent to Meta for transcription, and the transcript and participant names are sent to Meta's model API. The organizer can hide the names: the model then sees "Person A", "Person B" and so on, and replies are mapped back before anyone sees them. A recording is still transcribed as spoken, names included.
- Access is by link. The organizer's key is in the URL fragment, which browsers don't send to the server. Each participant gets their own link; participant pages send no referrer and aren't cached, and the dev server's request log leaves out their paths.
- A participant sees other people's answers only once the organizer reveals the round.
- The model writes questions and drafts. Whether answers differ and whether a resolution is confirmed are decided in code, from the participants' own choices.
- The call log shown in the app keeps stages, timings and costs, never prompts, replies or answers.

## Known limits

- On the evaluation set, the questions reveal 57% of planted mismatches (target 75%). Participants were simulated by the model, and all 26 meetings are synthetic. See `eval-results/2026-11-01/report.md`.
- Recordings must be at most 10 minutes and 32 MB, the Voice Transcribe limits. Speaker labels from transcription are matched to participants by the organizer.
- Questions and records are in English.
- Audio is stored on local disk. There are no accounts; anyone with a link can use it until the meeting is deleted.
- Rate limits (per participant link, and on wrong tokens per client) are counted in memory, so they hold for one server process only.

## Research and attribution

The detection half follows Liu et al., "Illusion of Alignment: Detecting Hidden Disagreement in Collaborative Dialogue" (EMNLP 2026; [arXiv:2608.08210](https://arxiv.org/abs/2608.08210), [code](https://github.com/THUNLP-MT/IoA)). Diagnostic multiple-choice questions drawn from a transcript, private answers, comparing answers by option, and asking participants whether a split is real all come from that paper. The question prompt `prompts/generateProbes.v1.md` is adapted from its repository; see [NOTICE](NOTICE).

What this project adds:

- recordings, with transcription, speaker labels and mapping speakers to participants (the paper used written transcripts);
- question templates per dimension (owner, deadline, scope and so on) with a fallback when a template doesn't fit; whether they help is not proven;
- resolution in the participants' own words, which counts only when everyone confirms it;
- a follow-up question about consequences, to check that the new wording settled the split;
- a decision record whose every item links to its source and is marked stated, confirmed or unresolved.

We found no prior work or product doing the last three, but that search was limited and is not a claim of novelty.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
