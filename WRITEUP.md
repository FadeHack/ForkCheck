# ForkCheck: hackathon write-up

Meta Global AI Developer Hackathon, Indie Developer track. Problem statement: **Build for Your World**.

## The problem

A meeting ends, nobody objected, and everyone leaves sure they agreed. A week later it turns out that "marketing writes the help page" meant a different person to each of them, and "end of next week" meant Friday to one person and the following Monday to another. Notes and summaries don't catch this, because they record the words everyone heard. The split is in how each person read those words, and nobody says that out loud.

## What ForkCheck does

ForkCheck takes a meeting transcript, pasted or transcribed from a recording, and finds the decisions whose details could be read more than one way. Then it runs a closed loop:

1. **Ask privately.** Each participant gets short multiple-choice questions about those details (who does it, what the date means, what "done" includes) and answers without seeing anyone else's answer.
2. **Compare.** Code compares the answers by option. The model never decides whether people disagree.
3. **Resolve.** Where answers split, participants write a resolution in their own words. It counts only when every participant confirms it.
4. **Recheck.** A new question about the resolution's consequences checks that the new wording actually settled the split, instead of hiding it again.
5. **Record.** A decision record sorts every item as _stated in the meeting_, _confirmed by participants_ or _unresolved_, and links each one to its source quote.

The organizer and each participant use their own browser link. No accounts.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/loop-dark.png">
  <img alt="How a check runs. It starts from a pasted transcript, or a recording that Muse Voice Transcribe turns into speaker-labelled turns. 1 Find: Muse Spark finds decisions and the details that could be read two ways, and code checks every quote against the transcript. 2 Ask privately: Muse Spark drafts multiple-choice questions and each person answers on their own link, sealed until the reveal. 3 Compare: code compares answers option by option; matching answers go straight to the record. 4 Settle: where answers differ, someone proposes wording and everyone confirms it, or they agree to disagree. 5 Recheck: Muse Spark writes a question about what the wording means in practice and code compares the answers; if they split again, it goes back to Settle. 6 Record: code sorts each item as stated, confirmed or unresolved, linked to its quote." src=".github/assets/loop-light.png">
</picture>

## What we built on and what we built

ForkCheck's repository was created on Oct 27, 2026, during the event, and all of its code was written during the hackathon.

The detection half follows published research: Liu et al., "Illusion of Alignment: Detecting Hidden Disagreement in Collaborative Dialogue" (EMNLP 2026; [arXiv:2608.08210](https://arxiv.org/abs/2608.08210)). Diagnostic multiple-choice questions drawn from a transcript, private answers, comparing answers by option, and asking participants whether a split is real all come from that paper. Our question prompt `prompts/generateProbes.v1.md` is adapted from the paper's repository (see [NOTICE](NOTICE)). We don't claim the detection method as ours.

What we added during the hackathon:

- **Audio input.** Upload a recording, transcribe it with speaker labels, map speakers to participants, and review the transcript before analysis. The paper used written transcripts.
- **Question templates per dimension** (owner, deadline, scope, acceptance criteria), chosen per dimension from gate runs, with model-written questions as the fallback. We have not shown that templates beat free generation in general (see Limits).
- **Resolution in the participants' own words**, which counts only when everyone confirms it.
- **A recheck question about consequences**, to catch a resolution that is still vague.
- **A source-linked decision record** with the three categories above. A validator checks every record, and its result is shown on the record page.
- **The product around it:** a Next.js app for organizer and participants, Postgres storage, a 7-day retention default, optional name hiding, an offline replay mode, and an evaluation harness with 26 scenario meetings.

We found no prior work or product that does the last three loop steps (resolve, recheck, record). Our search was limited, so treat that as a note, not a claim of novelty.

## How Meta's models are used

| Model                                                | Access                                                          | What it does in ForkCheck                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Muse Spark (`muse-spark-1.3`)                        | Meta Model API, Chat Completions with strict JSON schema output | Every reasoning stage: extracting decisions with quotes, finding details that could be read two ways, writing and critiquing questions, mapping written-in answers to options, drafting a resolution on request, writing the recheck question, and drafting record prose. In evaluation it also plays the simulated participants. |
| Muse Voice Transcribe (`muse-voice-transcribe-1.0`)  | Meta Model API, diarization mode                                | Turns an uploaded recording into speaker-labelled turns.                                                                                                                                                                                                                                                                          |
| Muse Spark Open (`meta-models/muse-spark-open-1026`) | Baseten                                                         | Evaluation only: a side-by-side comparison with Muse Spark on extraction and question writing. The app itself runs on Muse Spark.                                                                                                                                                                                                 |

Two rules shape how the models are used:

- The model writes; code decides. Whether answers differ, whether a resolution is confirmed, and which category a record item goes in are computed from the participants' own choices. In the final evaluation, no resolution event came from a model ([report](eval-results/2026-11-01/report.md), "Resolution, recheck and record", S5).
- Every quote the model returns is checked against the transcript as a substring before it is used. Evidence validity was 100% in every condition ([report](eval-results/2026-11-01/report.md), S2 evidence validity).

## Evaluation

We ran 26 synthetic meetings with planted mismatches (8 development, 18 held out) plus an audio set of 6 synthetic renders and 4 recordings of scripts read by the project owner. Participants are simulated. The full report, with every count and run log, is [eval-results/2026-11-01/report.md](eval-results/2026-11-01/report.md). All numbers below come from it.

| What we measured                                           | Target    | Pasted transcripts (Muse Spark) | Audio (Muse Spark) |
| ---------------------------------------------------------- | --------- | ------------------------------- | ------------------ |
| Decisions found (S2 recall)                                |           | 97.8% (261/267)                 | 96.1% (124/129)    |
| Quotes that match the transcript (S2 evidence validity)    | ≥ 95%     | 100% (638/638)                  | 100% (305/305)     |
| Invented owners or dates                                   | 0         | 0                               | 0                  |
| Planted mismatches revealed by the questions (S3)          | ≥ 75%     | **57.4% (31/54)**               | 77.8% (14/18)      |
| False splits on control meetings with no mismatch (S4)     | ≤ 1 per 8 | 0 in 24 runs                    | 0 in 12 runs       |
| Items confirmed only when every participant confirmed (S5) | 100%      | 100% (36/36)                    | 100% (14/14)       |
| Records passing the validator (S7)                         | 100%      | 100% (78/78)                    | 100% (30/30)       |

The resolve and recheck steps were tested with two kinds of simulated resolution. When the resolution was precise, the recheck agreed in 87.5% of cases (28/32), against a target of 80%. When it was deliberately vague, the recheck caught it, splitting again, in 75.9% of cases (22/29), against a target of 70% ([report](eval-results/2026-11-01/report.md), S6). Every open split appeared as unresolved in the record (7/7 and 26/26, S7).

**Muse Spark against Muse Spark Open.** Before the run, we fixed the rule that Spark Open counts as a credible alternative for a stage if every quality metric is within 5 points of Muse Spark and at least 98% of its JSON is valid after repair. It met that rule for both stages tested. Extraction recall was 99.3% against 97.8%, and question reveal rate was 55.6% against 57.4%. Its JSON was valid on the first try in every call (78/78 and 439/439), and it cost $0.059 per meeting against $0.111 for Muse Spark ([report](eval-results/2026-11-01/report.md), "Muse Spark and Spark Open" and "Cost and latency").

**Cost.** A full meeting check on pasted text costs about $0.11 in Muse Spark calls (about 15 calls), and about $0.13 from audio ([report](eval-results/2026-11-01/report.md), "Cost and latency").

## Limits

- **Question quality is below target.** On pasted transcripts the questions reveal 57.4% of planted mismatches, against our 75% target. We report that number as measured; we did not tune against the held-out set to raise it. The audio set scored higher (77.8%), but it has fewer mismatches (18 against 54), so that gap is not evidence that audio helps.
- **Simulated participants.** Muse Spark answers each question from a private brief, and the same model family writes the questions, which may push reveal rates up. These results don't show how real teams would answer.
- **Synthetic meetings.** The 26 meetings were written for this evaluation.
- **One rater.** Human quality scores were pre-filled by a model, then reviewed and corrected by one rater, the project owner. No inter-rater agreement is reported.
- **Templates.** Per-dimension templates were picked on the development scenarios they were shaped against, so their benefit isn't proven on unseen data.
- **Product limits.** Recordings must be 10 minutes and 32 MB or less (the Voice Transcribe limits). Questions and records are English only. Audio is stored on local disk, and rate limits hold for one server process.

## What's next

- **Hosting, then sending links for you.** ForkCheck runs locally for now, so the organizer sends each link from their own mail app or phone share sheet. Once it is hosted, it can email the links itself and remind people who haven't answered.
- **Slack and Teams.** Send each person their link as a direct message, and post the record to the meeting's channel when it's done.
- **Better questions.** Raise the 57.4% reveal rate toward the 75% target, then measure it with real teams instead of simulated participants.

## Privacy

Every meeting check, including its transcript, answers, record and any recording, is deleted 7 days after it is created, and the organizer can delete it sooner. A recording is deleted once the organizer finishes reviewing the transcript, unless they choose to keep it. The organizer can hide participant names from the model, so it sees "Person A", "Person B" and so on. A participant sees others' answers only after the organizer reveals the round. Links go out from the organizer's own mail app or share sheet, so ForkCheck never sees an email address. The in-app call log keeps stages, timings and costs, never prompts or answers. Details are in the [README](README.md#privacy-defaults).

## Try it

The demo runs locally. With the default `LIVE=0` it runs fully offline: every model reply comes from a recorded fixture, and the screens label it as replayed. You need Node 24, Docker and pnpm:

```sh
pnpm install
cp .env.example .env.local
pnpm db:up
pnpm db:migrate
pnpm dev
```

Then follow "Run the demo" in the [README](README.md#run-the-demo) with the "Atlas launch sync" meeting, or run `pnpm e2e demo --project desktop` to watch the whole loop run three times in a browser. To use the live models, set `LIVE=1` and `MODEL_API_KEY` in `.env.local`.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
