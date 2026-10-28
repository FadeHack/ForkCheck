# Gate G1: NO-GO

Run ID `g1-config-form-20261028`, tier `config`, 1 runs of the dev set; GO needs 1 passing runs. Cost $0.9556.

Per run (R§6.5): planted mismatch revealed in at least 5 of 6, at least 6 of 8 overall, at most 1 false split in the controls.

| Run | Revealed | Overall | Control false splits | Result |
| --- | --- | --- | --- | --- |
| 0 | 4/6 | 6/8 | 0 | fail: revealed 4/6, needs 5 |

## Per scenario

| Scenario | Kind | Revealed or clean | Probes asked | Unplanted splits |
| --- | --- | --- | --- | --- |
| dev-aligned-key-rotation | control | 1/1 | 2 | 0 |
| dev-criteria-usual-qa | mismatch | 0/1 | 5 | 0 |
| dev-deadline-end-of-month | mismatch | 1/1 | 5 | 0 |
| dev-deadline-next-friday | mismatch | 1/1 | 3 | 0 |
| dev-ownership-outage-email | mismatch | 1/1 | 5 | 0 |
| dev-partial-pricing-page | mismatch | 0/1 | 4 | 0 |
| dev-same-reading-loop-in-legal | control | 1/1 | 0 | 0 |
| dev-scope-dashboard-demo | mismatch | 1/1 | 4 | 1 |

## Per dimension

| Dimension | Revealed | Control false splits |
| --- | --- | --- |
| criteria | 0/1 (0%) | 0 |
| deadline | 2/2 (100%) | 0 |
| owner | 1/1 (100%) | 0 |
| scope | 1/2 (50%) | 0 |
