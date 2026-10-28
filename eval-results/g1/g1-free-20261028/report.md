# Gate G1: NO-GO

Run ID `g1-free-20261028`, tier `free`, 3 runs of the dev set; GO needs 2 passing runs. Cost $3.7387.

Per run (R§6.5): planted mismatch revealed in at least 5 of 6, at least 6 of 8 overall, at most 1 false split in the controls.

| Run | Revealed | Overall | Control false splits | Result |
| --- | --- | --- | --- | --- |
| 0 | 4/6 | 6/8 | 0 | fail: revealed 4/6, needs 5 |
| 1 | 3/6 | 4/8 | 1 | fail: revealed 3/6, needs 5; overall 4/8, needs 6 |
| 2 | 3/6 | 4/8 | 1 | fail: revealed 3/6, needs 5; overall 4/8, needs 6 |

## Per scenario

| Scenario | Kind | Revealed or clean | Probes asked | Unplanted splits |
| --- | --- | --- | --- | --- |
| dev-aligned-key-rotation | control | 3/3 | 3, 3, 5 | 0, 0, 0 |
| dev-criteria-usual-qa | mismatch | 1/3 | 4, 5, 5 | 0, 0, 1 |
| dev-deadline-end-of-month | mismatch | 3/3 | 5, 5, 5 | 1, 0, 1 |
| dev-deadline-next-friday | mismatch | 3/3 | 5, 4, 5 | 0, 0, 0 |
| dev-ownership-outage-email | mismatch | 3/3 | 5, 5, 5 | 0, 0, 0 |
| dev-partial-pricing-page | mismatch | 0/3 | 5, 5, 5 | 0, 0, 0 |
| dev-same-reading-loop-in-legal | control | 1/3 | 5, 5, 5 | 0, 1, 1 |
| dev-scope-dashboard-demo | mismatch | 0/3 | 5, 5, 5 | 0, 1, 1 |

## Per planted dimension

| Dimension | Revealed |
| --- | --- |
| criteria | 1/3 (33%) |
| deadline | 6/6 (100%) |
| owner | 3/3 (100%) |
| scope | 0/6 (0%) |
