# ForkCheck evaluation, 2026-11-02

Conditions are `provider/source/resolution`. Each cell is the rate over every logged scenario run of the condition, with its count, so any number can be checked against the run logs below.

## Sources

| Condition | Run IDs | Logs |
| --- | --- | --- |
| `baseten/paste/precise` | `m7-compare` | eval-results/m7-compare/logs/ |
| `meta/audio/precise` | `m7-final` | eval-results/m7-final/logs/ |
| `meta/paste/precise` | `m7-final` | eval-results/m7-final/logs/ |
| `meta/paste/vague` | `m7-final` | eval-results/m7-final/logs/ |

## Pasted transcripts

| Metric | Target | `baseten/paste/precise` | `meta/paste/precise` | `meta/paste/vague` |
| --- | --- | --- | --- | --- |
| Scenario runs |  | 3 | 2 | 2 |
| Runs stopped by an error |  | 33.3% (1/3) | 0.0% (0/2) | 0.0% (0/2) |
| S2 precision |  | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) |
| S2 recall |  | 66.7% (8/12) | 100.0% (8/8) | 100.0% (8/8) |
| S2 evidence validity (substring) | ≥ 95% | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| S2 invented owners or dates | 0 | 0 | 0 | 0 |
| S3 reveal rate | ≥ 75% held-out | 66.7% (4/6) | 100.0% (4/4) | 100.0% (4/4) |
| S3 relevance |  | 66.7% (4/6) | 66.7% (4/6) | 66.7% (4/6) |
| S3 lint pass |  | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) |
| S4 precision |  | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| S4 recall |  | 66.7% (4/6) | 100.0% (4/4) | 100.0% (4/4) |
| S4 false splits on controls | ≤ 1 per 8 | 0 in 0 control runs | 0 in 0 control runs | 0 in 0 control runs |

## Audio

| Metric | Target | `meta/audio/precise` |
| --- | --- | --- |
| Scenario runs |  | 1 |
| Runs stopped by an error |  | 0.0% (0/1) |
| S2 precision |  | 100.0% (4/4) |
| S2 recall |  | 100.0% (4/4) |
| S2 evidence validity (substring) | ≥ 95% | 100.0% (6/6) |
| S2 invented owners or dates | 0 | 0 |
| S3 reveal rate | ≥ 75% held-out | 100.0% (2/2) |
| S3 relevance |  | 66.7% (2/3) |
| S3 lint pass |  | 100.0% (3/3) |
| S4 precision |  | 100.0% (2/2) |
| S4 recall |  | 100.0% (2/2) |
| S4 false splits on controls | ≤ 1 per 8 | 0 in 0 control runs |

| Metric | `meta/paste/precise` | `meta/audio/precise` | Audio − paste |
| --- | --- | --- | --- |
| S2 precision | 100.0% (8/8) | 100.0% (4/4) | 0.0 points |
| S2 recall | 100.0% (8/8) | 100.0% (4/4) | 0.0 points |
| S2 evidence validity | 100.0% (12/12) | 100.0% (6/6) | 0.0 points |
| S3 reveal rate | 100.0% (4/4) | 100.0% (2/2) | 0.0 points |
| S4 precision | 100.0% (4/4) | 100.0% (2/2) | 0.0 points |
| S4 recall | 100.0% (4/4) | 100.0% (2/2) | 0.0 points |

## Resolution, recheck and record

| Metric | Target | `meta/audio/precise` | `meta/paste/precise` | `meta/paste/vague` |
| --- | --- | --- | --- | --- |
| S5 confirmed only with every participant | 100% | 100.0% (2/2) | 100.0% (4/4) | 100.0% (4/4) |
| S5 resolution events by a model | 0 | 0 | 0 | 0 |
| S6 catch (vague resolution splits) | ≥ 70% | n/a | n/a | 100.0% (2/2) |
| S6 pass (precise resolution consistent) | ≥ 80% | 100.0% (1/1) | 100.0% (2/2) | n/a |
| S6 novel recheck stem |  | 100.0% (1/1) | 100.0% (2/2) | 100.0% (2/2) |
| S7 traceable items | 100% | 100.0% (8/8) | 100.0% (16/16) | 100.0% (16/16) |
| S7 open splits shown unresolved | 100% | 100.0% (1/1) | 100.0% (2/2) | 100.0% (4/4) |
| S7 inferred text in stated/confirmed | 0 | 0 | 0 | 0 |
| S7 records passing the validator | 100% | 100.0% (1/1) | 100.0% (2/2) | 100.0% (2/2) |

## Muse Spark and Spark Open

Rule, fixed before the run (R§7.3): Spark Open is a credible alternative for a stage if every quality metric is within 5 points of Muse Spark and JSON validity after repair is at least 98%. The demo path stays on Muse Spark either way.

| Stage | Metric | Muse Spark | Spark Open | Gap (points) |
| --- | --- | --- | --- | --- |
| S2 Extraction | precision | 100.0% | 100.0% | 0 |
| S2 Extraction | recall | 100.0% | 66.7% | -33.3 |
| S2 Extraction | evidence validity | 100.0% | 100.0% | 0 |
| S2 Extraction | JSON valid, first answer |  | 33.3% (1/3) |  |
| S2 Extraction | JSON valid after repair |  | 66.7% (2/3) |  |
| S3 Questions | reveal rate | 100.0% | 66.7% | -33.3 |
| S3 Questions | relevance | 66.7% | 66.7% | 0 |
| S3 Questions | lint pass | 100.0% | 100.0% | 0 |
| S3 Questions | JSON valid, first answer |  | 100.0% (10/10) |  |
| S3 Questions | JSON valid after repair |  | 100.0% (10/10) |  |

- **S2 Extraction:** does not meet the rule (recall: 33.3 points below Muse Spark; JSON validity after repair 66.7% < 98%); documented as a comparison only.
- **S3 Questions:** does not meet the rule (reveal rate: 33.3 points below Muse Spark); documented as a comparison only.

## Human ratings

Human scores come from one rater, the project owner, so no inter-rater agreement is reported. Treat them as one careful reader's judgement, not a measured consensus.

| Condition | Questions rated | Clarity (1–3) | Answerability (1–3) | Evidence supports claim | Simulated answer follows brief |
| --- | --- | --- | --- | --- | --- |
| `baseten/paste/precise` | 4 | 2.50 | 2.25 | 75.0% (3/4) | n/a |
| `meta/paste/precise` | 4 | 2.75 | 2.50 | 100.0% (4/4) | 90.0% (9/10) |

## Cost and latency

| Condition | Total | Billed to | Per meeting | Calls per meeting | Failed calls |
| --- | --- | --- | --- | --- | --- |
| `baseten/paste/precise` | $0.45 | baseten $0.16, meta $0.29 | $0.151 | 12.3 | 2.7% (1/37) |
| `meta/audio/precise` | $0.20 | meta $0.20 | $0.200 | 20.0 | 0.0% (0/20) |
| `meta/paste/precise` | $0.40 | meta $0.40 | $0.200 | 20.0 | 0.0% (0/40) |
| `meta/paste/vague` | $0.40 | meta $0.40 | $0.200 | 20.0 | 0.0% (0/40) |

| Condition | Stage | Calls | p50 | p95 | Tokens in / out | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| `baseten/paste/precise` | extract | 3 | 2.5 s | 3.0 s | 0 / 0 | $0.044 |
| `baseten/paste/precise` | findCandidates | 2 | 2.0 s | 2.5 s | 0 / 0 | $0.024 |
| `baseten/paste/precise` | generateProbes | 4 | 2.0 s | 2.5 s | 0 / 0 | $0.048 |
| `baseten/paste/precise` | critique | 4 | 2.0 s | 2.5 s | 0 / 0 | $0.048 |
| `baseten/paste/precise` | simulateAnswer | 24 | 2.0 s | 2.5 s | 0 / 0 | $0.288 |
| `meta/audio/precise` | extract | 1 | 1.2 s | 1.2 s | 0 / 0 | $0.010 |
| `meta/audio/precise` | findCandidates | 1 | 1.2 s | 1.2 s | 0 / 0 | $0.010 |
| `meta/audio/precise` | generateProbes | 2 | 1.2 s | 1.2 s | 0 / 0 | $0.020 |
| `meta/audio/precise` | critique | 2 | 1.2 s | 1.2 s | 0 / 0 | $0.020 |
| `meta/audio/precise` | simulateAnswer | 12 | 1.2 s | 1.2 s | 0 / 0 | $0.120 |
| `meta/audio/precise` | generateRecheck | 1 | 1.2 s | 1.2 s | 0 / 0 | $0.010 |
| `meta/audio/precise` | draftRecordProse | 1 | 1.2 s | 1.2 s | 0 / 0 | $0.010 |
| `meta/paste/precise` | extract | 2 | 1.2 s | 1.6 s | 0 / 0 | $0.020 |
| `meta/paste/precise` | findCandidates | 2 | 1.2 s | 1.6 s | 0 / 0 | $0.020 |
| `meta/paste/precise` | generateProbes | 4 | 1.2 s | 1.6 s | 0 / 0 | $0.040 |
| `meta/paste/precise` | critique | 4 | 1.2 s | 1.6 s | 0 / 0 | $0.040 |
| `meta/paste/precise` | simulateAnswer | 24 | 1.2 s | 1.6 s | 0 / 0 | $0.240 |
| `meta/paste/precise` | generateRecheck | 2 | 1.2 s | 1.6 s | 0 / 0 | $0.020 |
| `meta/paste/precise` | draftRecordProse | 2 | 1.2 s | 1.6 s | 0 / 0 | $0.020 |
| `meta/paste/vague` | extract | 2 | 1.2 s | 1.6 s | 0 / 0 | $0.020 |
| `meta/paste/vague` | findCandidates | 2 | 1.2 s | 1.6 s | 0 / 0 | $0.020 |
| `meta/paste/vague` | generateProbes | 4 | 1.2 s | 1.6 s | 0 / 0 | $0.040 |
| `meta/paste/vague` | critique | 4 | 1.2 s | 1.6 s | 0 / 0 | $0.040 |
| `meta/paste/vague` | simulateAnswer | 24 | 1.2 s | 1.6 s | 0 / 0 | $0.240 |
| `meta/paste/vague` | generateRecheck | 2 | 1.2 s | 1.6 s | 0 / 0 | $0.020 |
| `meta/paste/vague` | draftRecordProse | 2 | 1.2 s | 1.6 s | 0 / 0 | $0.020 |

## Limitations

- Participants are simulated: Muse Spark answers each probe from a private brief. The simulator and the question generator are the same model family, which may push reveal rates up. Simulated results do not establish how real teams would answer.
- The 26 meetings are synthetic, written for this evaluation with planted mismatches. The audio set is 6 synthetic renders and 4 volunteer recordings of scripts.
- Pasted and audio runs are reported separately; audio minus paste attributes the loss to transcription and speaker mapping.
- Model outputs vary between runs; each number sums every logged scenario run of its condition.
- Human scores come from a single rater (see above).
