# Gate G1: NO-GO

Run ID `g1-template-20261028`, tier `template`, 1 runs of the dev set; GO needs 1 passing runs. Cost $0.6411.

Per run (R§6.5): planted mismatch revealed in at least 5 of 6, at least 6 of 8 overall, at most 1 false split in the controls.

| Run | Revealed | Overall | Control false splits | Result |
| --- | --- | --- | --- | --- |
| 0 | 2/6 | 4/8 | 0 | fail: revealed 2/6, needs 5; overall 4/8, needs 6 |

## Per scenario

| Scenario | Kind | Revealed or clean | Probes asked | Unplanted splits |
| --- | --- | --- | --- | --- |
| dev-aligned-key-rotation | control | 1/1 | 2 | 0 |
| dev-criteria-usual-qa | mismatch | 0/1 | 1 | 0 |
| dev-deadline-end-of-month | mismatch | 1/1 | 4 | 1 |
| dev-deadline-next-friday | mismatch | 0/1 | 1 | 0 |
| dev-ownership-outage-email | mismatch | 1/1 | 2 | 0 |
| dev-partial-pricing-page | mismatch | 0/1 | 2 | 0 |
| dev-same-reading-loop-in-legal | control | 1/1 | 1 | 0 |
| dev-scope-dashboard-demo | mismatch | 0/1 | 2 | 0 |

## Per dimension

| Dimension | Revealed | Control false splits |
| --- | --- | --- |
| criteria | 0/1 (0%) | 0 |
| deadline | 1/2 (50%) | 0 |
| owner | 1/1 (100%) | 0 |
| scope | 0/2 (0%) | 0 |
