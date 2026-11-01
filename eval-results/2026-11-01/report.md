# ForkCheck evaluation, 2026-11-01

Conditions are `provider/source/resolution`. Each cell is the rate over every logged scenario run of the condition, with its count, so any number can be checked against the run logs below.

## Sources

| Condition | Run IDs | Logs |
| --- | --- | --- |
| `baseten/paste/precise` | `m7-compare-20261101` | eval-results/m7-compare-20261101/logs/ |
| `meta/audio/precise` | `m7-final-20261101` | eval-results/m7-final-20261101/logs/ |
| `meta/paste/precise` | `m7-final-20261101` | eval-results/m7-final-20261101/logs/ |
| `meta/paste/vague` | `m7-final-20261101` | eval-results/m7-final-20261101/logs/ |

## Pasted transcripts

| Metric | Target | `baseten/paste/precise` | `meta/paste/precise` | `meta/paste/vague` |
| --- | --- | --- | --- | --- |
| Scenario runs |  | 78 | 78 | 78 |
| Runs stopped by an error |  | 0.0% (0/78) | 0.0% (0/78) | 0.0% (0/78) |
| S2 precision |  | 65.0% (265/408) | 65.9% (261/396) | 66.1% (261/395) |
| S2 recall |  | 99.3% (265/267) | 97.8% (261/267) | 97.8% (261/267) |
| S2 evidence validity (substring) | ≥ 95% | 100.0% (570/570) | 100.0% (638/638) | 100.0% (632/632) |
| S2 invented owners or dates | 0 | 0 | 0 | 0 |
| S3 reveal rate | ≥ 75% held-out | 55.6% (30/54) | 57.4% (31/54) | 53.7% (29/54) |
| S3 relevance |  | 25.3% (43/170) | 25.3% (39/154) | 21.9% (35/160) |
| S3 lint pass |  | 98.6% (219/222) | 98.4% (181/184) | 97.3% (180/185) |
| S4 precision |  | 76.9% (30/39) | 86.1% (31/36) | 87.9% (29/33) |
| S4 recall |  | 55.6% (30/54) | 57.4% (31/54) | 53.7% (29/54) |
| S4 false splits on controls | ≤ 1 per 8 | 0 in 24 control runs | 0 in 24 control runs | 0 in 24 control runs |

## Audio

| Metric | Target | `meta/audio/precise` |
| --- | --- | --- |
| Scenario runs |  | 30 |
| Runs stopped by an error |  | 0.0% (0/30) |
| S2 precision |  | 63.9% (124/194) |
| S2 recall |  | 96.1% (124/129) |
| S2 evidence validity (substring) | ≥ 95% | 100.0% (305/305) |
| S2 invented owners or dates | 0 | 0 |
| S3 reveal rate | ≥ 75% held-out | 77.8% (14/18) |
| S3 relevance |  | 31.5% (17/54) |
| S3 lint pass |  | 98.0% (97/99) |
| S4 precision |  | 100.0% (14/14) |
| S4 recall |  | 77.8% (14/18) |
| S4 false splits on controls | ≤ 1 per 8 | 0 in 12 control runs |

| Metric | `meta/paste/precise` | `meta/audio/precise` | Audio − paste |
| --- | --- | --- | --- |
| S2 precision | 65.9% (261/396) | 63.9% (124/194) | -2.0 points |
| S2 recall | 97.8% (261/267) | 96.1% (124/129) | -1.6 points |
| S2 evidence validity | 100.0% (638/638) | 100.0% (305/305) | 0.0 points |
| S3 reveal rate | 57.4% (31/54) | 77.8% (14/18) | 20.4 points |
| S4 precision | 86.1% (31/36) | 100.0% (14/14) | 13.9 points |
| S4 recall | 57.4% (31/54) | 77.8% (14/18) | 20.4 points |

## Resolution, recheck and record

| Metric | Target | `meta/audio/precise` | `meta/paste/precise` | `meta/paste/vague` |
| --- | --- | --- | --- | --- |
| S5 confirmed only with every participant | 100% | 100.0% (14/14) | 100.0% (36/36) | 100.0% (33/33) |
| S5 resolution events by a model | 0 | 0 | 0 | 0 |
| S6 catch (vague resolution splits) | ≥ 70% | n/a | n/a | 75.9% (22/29) |
| S6 pass (precise resolution consistent) | ≥ 80% | 100.0% (14/14) | 87.5% (28/32) | n/a |
| S6 novel recheck stem |  | 100.0% (14/14) | 100.0% (32/32) | 100.0% (29/29) |
| S7 traceable items | 100% | 100.0% (319/319) | 100.0% (674/674) | 100.0% (665/665) |
| S7 open splits shown unresolved | 100% | n/a | 100.0% (7/7) | 100.0% (26/26) |
| S7 inferred text in stated/confirmed | 0 | 0 | 0 | 0 |
| S7 records passing the validator | 100% | 100.0% (30/30) | 100.0% (78/78) | 100.0% (78/78) |

## Muse Spark and Spark Open

Rule, fixed before the run (R§7.3): Spark Open is a credible alternative for a stage if every quality metric is within 5 points of Muse Spark and JSON validity after repair is at least 98%. The demo path stays on Muse Spark either way.

| Stage | Metric | Muse Spark | Spark Open | Gap (points) |
| --- | --- | --- | --- | --- |
| S2 Extraction | precision | 65.9% | 65.0% | -1 |
| S2 Extraction | recall | 97.8% | 99.3% | +1.5 |
| S2 Extraction | evidence validity | 100.0% | 100.0% | 0 |
| S2 Extraction | JSON valid, first answer |  | 100.0% (78/78) |  |
| S2 Extraction | JSON valid after repair |  | 100.0% (78/78) |  |
| S3 Questions | reveal rate | 57.4% | 55.6% | -1.9 |
| S3 Questions | relevance | 25.3% | 25.3% | 0 |
| S3 Questions | lint pass | 98.4% | 98.6% | +0.3 |
| S3 Questions | JSON valid, first answer |  | 100.0% (439/439) |  |
| S3 Questions | JSON valid after repair |  | 100.0% (439/439) |  |

- **S2 Extraction:** meets the rule; Spark Open is a credible alternative for this stage.
- **S3 Questions:** meets the rule; Spark Open is a credible alternative for this stage.

## Human ratings

Human scores: ratings were pre-filled by a model, then reviewed and corrected by one rater, the project owner. No inter-rater agreement is reported.

| Condition | Questions rated | Clarity (1–3) | Answerability (1–3) | Evidence supports claim | Simulated answer follows brief |
| --- | --- | --- | --- | --- | --- |
| `baseten/paste/precise` | 64 | 2.78 | 2.80 | 81.8% (27/33) | n/a |
| `meta/audio/precise` | 28 | 2.71 | 2.75 | 75.0% (15/20) | 100.0% (8/8) |
| `meta/paste/precise` | 64 | 2.81 | 2.88 | 75.5% (37/49) | 100.0% (39/39) |

## Cost and latency

| Condition | Total | Billed to | Per meeting | Calls per meeting | Failed calls |
| --- | --- | --- | --- | --- | --- |
| `baseten/paste/precise` | $4.59 | baseten $3.28, meta $1.31 | $0.059 | 14.6 | 0.0% (0/1139) |
| `meta/audio/precise` | $3.83 | meta $3.83 | $0.128 | 17.0 | 0.0% (0/509) |
| `meta/paste/precise` | $8.69 | meta $8.69 | $0.111 | 14.8 | 0.0% (0/1156) |
| `meta/paste/vague` | $8.40 | meta $8.40 | $0.108 | 14.7 | 0.0% (0/1144) |

| Condition | Stage | Calls | p50 | p95 | Tokens in / out | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| `baseten/paste/precise` | extract | 78 | 9.5 s | 13.1 s | 99267 / 216171 | $0.972 |
| `baseten/paste/precise` | findCandidates | 78 | 12.0 s | 20.2 s | 141626 / 241495 | $1.143 |
| `baseten/paste/precise` | generateProbes | 188 | 3.5 s | 5.6 s | 144973 / 181472 | $0.874 |
| `baseten/paste/precise` | critique | 173 | 1.6 s | 2.8 s | 106039 / 51767 | $0.287 |
| `baseten/paste/precise` | simulateAnswer | 622 | 1.8 s | 3.9 s | 199394 / 271393 | $1.313 |
| `meta/audio/precise` | extract | 30 | 26.7 s | 38.9 s | 34521 / 246447 | $1.076 |
| `meta/audio/precise` | findCandidates | 30 | 27.9 s | 44.3 s | 53002 / 214686 | $0.963 |
| `meta/audio/precise` | generateProbes | 68 | 5.1 s | 9.0 s | 41539 / 109025 | $0.495 |
| `meta/audio/precise` | critique | 63 | 2.1 s | 4.6 s | 27447 / 40849 | $0.193 |
| `meta/audio/precise` | simulateAnswer | 274 | 1.5 s | 3.0 s | 85777 / 114061 | $0.553 |
| `meta/audio/precise` | draftRecordProse | 30 | 7.3 s | 9.7 s | 19517 / 68879 | $0.312 |
| `meta/audio/precise` | generateRecheck | 14 | 12.6 s | 23.0 s | 10234 / 52683 | $0.234 |
| `meta/paste/precise` | extract | 78 | 22.7 s | 39.0 s | 87879 / 559203 | $2.452 |
| `meta/paste/precise` | findCandidates | 78 | 27.7 s | 38.4 s | 129697 / 497783 | $2.244 |
| `meta/paste/precise` | generateProbes | 145 | 5.3 s | 7.9 s | 88304 / 233969 | $1.071 |
| `meta/paste/precise` | critique | 138 | 2.1 s | 3.1 s | 60516 / 79030 | $0.386 |
| `meta/paste/precise` | simulateAnswer | 604 | 1.5 s | 3.4 s | 190484 / 255477 | $1.238 |
| `meta/paste/precise` | draftRecordProse | 78 | 6.5 s | 9.7 s | 46861 / 156948 | $0.715 |
| `meta/paste/precise` | generateRecheck | 35 | 12.4 s | 24.2 s | 26008 / 130872 | $0.583 |
| `meta/paste/vague` | extract | 78 | 22.3 s | 38.0 s | 87879 / 546244 | $2.386 |
| `meta/paste/vague` | findCandidates | 78 | 24.5 s | 46.7 s | 129403 / 489783 | $2.203 |
| `meta/paste/vague` | generateProbes | 142 | 5.0 s | 8.3 s | 84953 / 225448 | $1.024 |
| `meta/paste/vague` | critique | 135 | 2.1 s | 3.6 s | 59152 / 80447 | $0.386 |
| `meta/paste/vague` | simulateAnswer | 603 | 1.5 s | 3.7 s | 186907 / 255300 | $1.231 |
| `meta/paste/vague` | draftRecordProse | 78 | 5.9 s | 9.2 s | 45738 / 145680 | $0.664 |
| `meta/paste/vague` | generateRecheck | 30 | 12.2 s | 22.8 s | 21246 / 115665 | $0.512 |

## Limitations

- Participants are simulated: Muse Spark answers each probe from a private brief. The simulator and the question generator are the same model family, which may push reveal rates up. Simulated results do not establish how real teams would answer.
- The 26 meetings are synthetic, written for this evaluation with planted mismatches. The audio set is 6 synthetic renders and 4 volunteer recordings of scripts.
- Pasted and audio runs are reported separately; audio minus paste attributes the loss to transcription and speaker mapping. On audio, an extracted decision matches its expected one when a quote of five or more words shares at least 80% of its words, since the ASR wording drifts from the script; on paste the quotes must contain each other.
- Model outputs vary between runs; each number sums every logged scenario run of its condition.
- Human scores come from a single rater (see above).
