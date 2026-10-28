# Tier selection

Gate runs: `g1-free-20261028` (free, 3 runs, $3.74), `g1-assisted-20261028` (assisted, 3 runs, $3.33), `g1-template-20261028` (template, 1 runs, $0.64).

Pick: highest reveal rate, then fewest control false splits; a tier that never revealed the dimension is not picked.

| Dimension | free | assisted | template | Pick |
| --- | --- | --- | --- | --- |
| owner | 3/3 revealed, 0 false | 0/3 revealed, 0 false | 1/1 revealed, 0 false | template |
| deadline | 6/6 revealed, 0 false | 6/6 revealed, 0 false | 1/2 revealed, 0 false | assisted |
| scope | 0/6 revealed, 0 false | 0/6 revealed, 0 false | 0/2 revealed, 0 false | no pick |
| criteria | 1/3 revealed, 2 false | 1/3 revealed, 0 false | 0/1 revealed, 0 false | assisted |
| dependency | no data | no data | no data | no pick |
| outcome | no data | no data | no data | no pick |
