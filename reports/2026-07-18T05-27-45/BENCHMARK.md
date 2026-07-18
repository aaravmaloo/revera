# Revera Benchmark Report

> **Run `2026-07-18T05-27-45`** · Revera v1.0.0 · devm

## 🟢 Excellent — Overall Accuracy: 97.47%

Revera correctly classified **8,000 of 8,208** labeled packages across 18,226 total packages tested.

---

## Run Metadata

| Field | Value |
|-------|-------|
| Run ID | `2026-07-18T05-27-45` |
| Revera version | `v1.0.0` |
| Commit | `unknown` |
| Branch | `unknown` |
| Host | devm |
| Workers | 18 |
| Score threshold | 60 (≥ trusted, < risky) |
| Started | 2026-07-18T05:27:46.156Z |
| Finished | 2026-07-18T06:24:29.886Z |
| Elapsed | 56m 44s |

---

## Dataset

| Metric | Count |
|--------|-------|
| Total packages in dataset | 18,226 |
| Packages tested (completed) | 18,226 |
| Packages skipped (resumed) | 0 |
| **Labeled** (contribute to accuracy) | **8,227** |
| Unlabeled `unknown` (throughput only) | 9,999 |
| Errors during analysis | 22 |

### Label Composition

| Label | Count | Description |
|-------|------:|-------------|
| `trusted` | 8,193 | Ground-truth safe packages |
| `malicious` | 9 | Confirmed malware / compromised releases |
| `typosquat` | 20 | Name-mimicry / typosquatting packages |
| `suspicious` | 5 | Historically problematic packages |
| `unknown` | 9,999 | No ground-truth (throughput only) |

---

## Overall Results

| Metric | Value |
|--------|-------|
| **Accuracy** | **97.47%** |
| Correct predictions | 8,000 / 8,208 |
| Incorrect predictions | 208 |
| False Positives (trusted → flagged risky) | 196 |
| False Negatives (threat → missed as safe) | 12 |
| Precision | 97.61% |
| Recall | 99.85% |
| F1 Score | 0.9872 |
| Error rate | 0.12% (22 packages) |

> **False Negatives** are the critical failure mode — a missed malicious package.
> **False Positives** flag safe packages as risky (noise, not a safety risk).

---

## Detection Accuracy by Label

This section shows how well Revera identifies each category of package.
Accuracy is computed only over packages where Revera did not error out.

| Label | Total | Correct | Incorrect | Accuracy | Status |
|-------|------:|---------|----------:|----------|--------|
| `trusted` | 8,193 | 7987 / 8183 _(10 errors)_ | 196 | 97.49% | ✅ |
| `malicious` | 9 | 5 / 9 | 4 | 55.56% | ❌ |
| `typosquat` | 20 | 7 / 11 _(9 errors)_ | 4 | 35.00% | ❌ |
| `suspicious` | 5 | 1 / 5 | 4 | 20.00% | ❌ |
| `unknown` | 9,999 | — / 9999 _(3 errors)_ | 0 | — | — |

### What each label means

- **`trusted`** — well-known, widely-used packages (e.g. `express`, `react`, `lodash`).
  Accuracy here measures how often Revera correctly calls them safe.
- **`malicious`** — confirmed supply-chain attacks or malware.
  Accuracy here is the *threat detection rate*.
- **`typosquat`** — packages that impersonate popular ones via name tricks.
  Accuracy here is the *typosquat catch rate*.
- **`suspicious`** — historically problematic packages (protestware, sabotage, etc).
  Accuracy here measures whether Revera down-scores them appropriately.
- **`unknown`** — no ground-truth label; included for throughput/stability runs only.
  Accuracy is not computed for this group.

---

## Score Distribution

How Revera scored all **18,226** packages (including `unknown` ones):

| Score bucket | Distribution | Count | Share |
|--------------|--------------|------:|------:|
| 0–20  (critical risk)  | `░░░░░░░░░░░░░░░░░░░░░░░░░░░░` |    109 |   0.6% |
| 21–40 (high risk)      | `░░░░░░░░░░░░░░░░░░░░░░░░░░░░` |     98 |   0.5% |
| 41–60 (moderate)       | `░░░░░░░░░░░░░░░░░░░░░░░░░░░░` |    165 |   0.9% |
| 61–80 (good)           | `████████████████████████████` | 13,789 |  75.7% |
| 81–100 (excellent)     | `████████░░░░░░░░░░░░░░░░░░░░` |  4,043 |  22.2% |

> Scores ≥ 60 → predicted **trusted/safe**. Scores < 60 → predicted **risky**.

---

## Performance

| Metric | Value |
|--------|-------|
| Throughput | 5.35 packages/s |
| Average latency | 3351 ms |
| p50 (median) latency | 842 ms |
| p95 latency | 8826 ms |
| p99 latency | 9137 ms |
| Total elapsed | 56m 44s |

---

## Comparison vs Previous Run (`2026-07-18T04-43-50`)

| Metric | Delta |
|--------|-------|
| Accuracy | +0.01% |
| Correct predictions | +4444 |
| False Positives | +115 |
| False Negatives | +0 |
| Errors | -14555 |
| Regressions (correct → wrong) | 9 |
| Improvements (wrong → correct) | 4 |

### ⚠️ Regressions (was correct → now wrong)

| Package | Label | Prev Score | Curr Score | Δ |
|---------|-------|:----------:|:----------:|---|
| `npm/insync` | `trusted` | 85 | 41 | -44 |
| `npm/icomoon-build` | `trusted` | 79 | 37 | -42 |
| `npm/node-red-contrib-wled2` | `trusted` | 82 | 40 | -42 |
| `npm/passbook` | `trusted` | 79 | 37 | -42 |
| `npm/babel-preset-node8` | `trusted` | 82 | 40 | -42 |
| `npm/@ministryofjustice/fb-runner-node` | `trusted` | 78 | 37 | -41 |
| `npm/node-tone` | `trusted` | 80 | 39 | -41 |
| `npm/mod_status` | `trusted` | 80 | 40 | -40 |
| `npm/ts-node-dev` | `trusted` | 77 | 45 | -32 |

### ✅ Improvements (was wrong → now correct)

| Package | Label | Prev Score | Curr Score | Δ |
|---------|-------|:----------:|:----------:|---|
| `npm/csv-parser` | `trusted` | 3 | 89 | +86 |
| `npm/@gitbook/api` | `trusted` | 3 | 86 | +83 |
| `npm/@jsonjoy.com/fs-node` | `trusted` | 3 | 85 | +82 |
| `npm/nest` | `trusted` | 3 | 82 | +79 |

---

## Methodology

### How accuracy is calculated

Only **labeled** packages (those with a ground-truth label of `trusted`,
`malicious`, `typosquat`, or `suspicious`) contribute to accuracy statistics.
Packages labeled `unknown` are excluded from accuracy but counted in totals.

**Classification rule** (threshold = 60):

| Revera Score | Prediction |
|:------------:|:----------:|
| ≥ 60 | `safe` (trusted) |
| ≥ 33 and < 60 | `suspicious` (risky) |
| < 33 | `malicious` (risky) |

- A **`trusted`** package predicted `risky` = **False Positive**.
- A **`malicious`/`typosquat`/`suspicious`** package predicted `safe` = **False Negative**.

### Dataset sources

- `datasets/known-trusted.jsonl` — ~300 hand-curated ground-truth safe packages
- `datasets/known-malicious.jsonl` — ~60 confirmed malicious/typosquat packages
- `datasets/npm.jsonl` — 100k+ packages pulled from the npm registry (label: `unknown`)

---

_Generated by revera-benchmarker · Sat, 18 Jul 2026 06:24:30 GMT_
