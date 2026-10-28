# Gate G1: GO

Run ID `g1-config-scope-tiebreak-20261028`, tier `config`, 3 runs of the dev set; GO needs 2 passing runs. Cost $2.9271.

Per run (R§6.5): planted mismatch revealed in at least 5 of 6, at least 6 of 8 overall, at most 1 false split in the controls.

| Run | Revealed | Overall | Control false splits | Result |
| --- | --- | --- | --- | --- |
| 0 | 5/6 | 7/8 | 0 | pass |
| 1 | 5/6 | 7/8 | 0 | pass |
| 2 | 5/6 | 7/8 | 0 | pass |

## Per scenario

| Scenario | Kind | Revealed or clean | Probes asked | Unplanted splits |
| --- | --- | --- | --- | --- |
| dev-aligned-key-rotation | control | 3/3 | 0, 3, 3 | 0, 0, 0 |
| dev-criteria-usual-qa | mismatch | 3/3 | 4, 4, 3 | 0, 1, 0 |
| dev-deadline-end-of-month | mismatch | 3/3 | 5, 5, 4 | 0, 0, 0 |
| dev-deadline-next-friday | mismatch | 3/3 | 5, 3, 5 | 0, 0, 0 |
| dev-ownership-outage-email | mismatch | 3/3 | 4, 5, 5 | 0, 0, 0 |
| dev-partial-pricing-page | mismatch | 0/3 | 5, 5, 5 | 0, 0, 0 |
| dev-same-reading-loop-in-legal | control | 3/3 | 0, 0, 0 | 0, 0, 0 |
| dev-scope-dashboard-demo | mismatch | 3/3 | 5, 5, 5 | 0, 0, 0 |

## Per dimension

| Dimension | Revealed | Control false splits |
| --- | --- | --- |
| criteria | 3/3 (100%) | 0 |
| deadline | 6/6 (100%) | 0 |
| owner | 3/3 (100%) | 0 |
| scope | 3/6 (50%) | 0 |
