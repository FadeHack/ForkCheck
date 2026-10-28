# Gate G1: GO

Run ID `g1-config-criteria-20261028`, tier `config`, 3 runs of the dev set; GO needs 2 passing runs. Cost $2.5032.

Per run (R§6.5): planted mismatch revealed in at least 5 of 6, at least 6 of 8 overall, at most 1 false split in the controls.

| Run | Revealed | Overall | Control false splits | Result |
| --- | --- | --- | --- | --- |
| 0 | 4/6 | 6/8 | 0 | fail: revealed 4/6, needs 5 |
| 1 | 5/6 | 7/8 | 0 | pass |
| 2 | 5/6 | 7/8 | 0 | pass |

## Per scenario

| Scenario | Kind | Revealed or clean | Probes asked | Unplanted splits |
| --- | --- | --- | --- | --- |
| dev-aligned-key-rotation | control | 3/3 | 0, 3, 3 | 0, 0, 0 |
| dev-criteria-usual-qa | mismatch | 3/3 | 2, 5, 2 | 0, 0, 0 |
| dev-deadline-end-of-month | mismatch | 2/3 | 5, 5, 5 | 0, 1, 0 |
| dev-deadline-next-friday | mismatch | 3/3 | 3, 1, 3 | 0, 0, 0 |
| dev-ownership-outage-email | mismatch | 3/3 | 5, 4, 5 | 0, 0, 0 |
| dev-partial-pricing-page | mismatch | 0/3 | 3, 5, 4 | 0, 0, 0 |
| dev-same-reading-loop-in-legal | control | 3/3 | 0, 0, 0 | 0, 0, 0 |
| dev-scope-dashboard-demo | mismatch | 3/3 | 4, 3, 4 | 0, 0, 0 |

## Per dimension

| Dimension | Revealed | Control false splits |
| --- | --- | --- |
| criteria | 3/3 (100%) | 0 |
| deadline | 5/6 (83%) | 0 |
| owner | 3/3 (100%) | 0 |
| scope | 3/6 (50%) | 0 |
