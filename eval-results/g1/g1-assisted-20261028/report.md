# Gate G1: NO-GO

Run ID `g1-assisted-20261028`, tier `assisted`, 3 runs of the dev set; GO needs 2 passing runs. Cost $3.3259.

Per run (R§6.5): planted mismatch revealed in at least 5 of 6, at least 6 of 8 overall, at most 1 false split in the controls.

| Run | Revealed | Overall | Control false splits | Result |
| --- | --- | --- | --- | --- |
| 0 | 2/6 | 4/8 | 0 | fail: revealed 2/6, needs 5; overall 4/8, needs 6 |
| 1 | 2/6 | 4/8 | 0 | fail: revealed 2/6, needs 5; overall 4/8, needs 6 |
| 2 | 3/6 | 5/8 | 0 | fail: revealed 3/6, needs 5; overall 5/8, needs 6 |

## Per scenario

| Scenario | Kind | Revealed or clean | Probes asked | Unplanted splits |
| --- | --- | --- | --- | --- |
| dev-aligned-key-rotation | control | 3/3 | 4, 1, 3 | 0, 0, 0 |
| dev-criteria-usual-qa | mismatch | 1/3 | 4, 5, 5 | 0, 2, 0 |
| dev-deadline-end-of-month | mismatch | 3/3 | 5, 5, 5 | 0, 0, 0 |
| dev-deadline-next-friday | mismatch | 3/3 | 5, 4, 5 | 0, 0, 0 |
| dev-ownership-outage-email | mismatch | 0/3 | 4, 4, 5 | 0, 0, 0 |
| dev-partial-pricing-page | mismatch | 0/3 | 5, 5, 5 | 0, 0, 0 |
| dev-same-reading-loop-in-legal | control | 3/3 | 0, 0, 0 | 0, 0, 0 |
| dev-scope-dashboard-demo | mismatch | 0/3 | 5, 5, 5 | 0, 1, 0 |

## Per dimension

| Dimension | Revealed | Control false splits |
| --- | --- | --- |
| criteria | 1/3 (33%) | 0 |
| deadline | 6/6 (100%) | 0 |
| owner | 0/3 (0%) | 0 |
| scope | 0/6 (0%) | 0 |
