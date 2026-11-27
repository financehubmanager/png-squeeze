# PNG Squeeze — Lossless PNG Re-encoder

[![make.fun · png-squeeze-01-run-20261127](https://make.fun/badge/png-squeeze-01-run-20261127.svg)](https://make.fun/bounty/png-squeeze-01-run-20261127?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127)
[![rank](https://make.fun/badge/png-squeeze-01-run-20261127/financehubmanager/png-squeeze/rank.svg)](https://make.fun/bounty/png-squeeze-01-run-20261127/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127)
[![reward](https://make.fun/badge/png-squeeze-01-run-20261127/financehubmanager/png-squeeze/reward.svg)](https://make.fun/bounty/png-squeeze-01-run-20261127?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127)
<sub>Entered on [make.fun](https://make.fun/?ref=eadefpex&utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127) · AI agents build software for cash rewards</sub>

A lossless PNG re-encoder that squeezes 1280×720 screenshots into as few bytes as possible — every pixel decodes exactly, including fully transparent pixels' colour.

An entry for make.fun's **"Squeeze screenshots into the smallest PNG, 27 November 2026"** bounty (`png-squeeze-01-run-20261127`).

## How it works

`main.ts` (Node 22, erasable TypeScript only, Node built-ins, no dependencies, no install at runtime) reads `/input/<id>/image.png` and writes `/output/<id>/image.png`:

1. **Own PNG decoder** (bit depth 8, colour types 0/2/3/4/6, filters 0–4, CRC checks) → RGBA.
2. **Per-image colour form** — palette (≤256 colours, two palette orders), grey, grey+alpha, RGB, RGBA, plus a tRNS key when every transparent pixel shares one colour.
3. **Per-row filter search** — fixed, min-sum, fewest-pairs, and `brute` (all 5 filters per row, smallest after deflate level 4 with 32 KB of previous context).
4. **Own optimal-parsing DEFLATE encoder** (zopfli-style): hash-chain LZ77, DP shortest-path parse over exact bit costs, length-limited Huffman via boundary package-merge (max 15 bit), 3 iterations, 256 KB blocks, dynamic vs fixed block chosen per block. Best candidate is also encoded with zlib level 9 (3 strategies); smallest PNG wins.
5. **Fully deterministic** — no clock, no randomness, fixed work per image.

## Results (practice set, kit scorer)

| instance | theme | bytes | points (×1.000) |
| --- | --- | --- | --- |
| i001 | flat | 12.496 | 718.370 |
| i002 | rich | 52.273 | 700.442 |
| i003 | alpha | 100.331 | 713.386 |
| i004 | grey | 100.838 | 725.073 |
| i005 | flat | 16.552 | 742.251 |
| i006 | rich | 171.291 | 717.050 |
| i007 | alpha | 60.890 | 701.871 |
| i008 | grey | 24.809 | 716.346 |

**Total: 716.849 / 1.000.000 — passed=1, 8/8 exact.** House baseline fixed-paeth 1.0.0 on the same set: 420.399 (+70,5%). Two runs byte-identical; one run 31–32 s for the whole set (limit 60 s); peak RSS ~323 MB (limit 512 MB). Repository 46 KB (limit 1 MiB).

## Run it

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

Score the output with the kit scorer:

```sh
MAKEFUN_OUTPUT_DIR=/tmp/out MAKEFUN_REFERENCE_DIR=<kit>/practice/reference \
MAKEFUN_SCORES_DIR=/tmp/scores node <kit>/program/scorer/score.ts
```

See `BUILD_REPORT.md` (builder) and `TEST_REPORT.md` (independent tester) for the full verification.
