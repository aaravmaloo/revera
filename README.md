# Revera

[![npm version](https://img.shields.io/npm/v/@aaravmaloo/revera.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/revera)
[![build status](https://img.shields.io/github/actions/workflow/status/aaravmaloo/revera/ci.yml?branch=main&style=flat-square)](https://github.com/aaravmaloo/revera/actions)
[![node version](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-5.5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/@aaravmaloo/revera.svg?style=flat-square&color=yellow)](LICENSE)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square)](https://github.com/aaravmaloo/revera)

> The credit score for npm packages.

Revera helps you decide whether a package is worth installing before you run `npm install`. It analyzes package quality, maintenance, security, ecosystem health, and publisher trust — and now propagates risk transitively across your entire dependency graph — then produces an explainable, Bayesian reputation report.

---

## Demo

![revera CLI Demo](assets/demo.gif)
*Watch revera check and explain packages in real time.*

---

## Quick Start

Run revera instantly without installation:

```bash
npx revera check react
```

---

## Example

Checking a package like `request` (which was deprecated in 2020) immediately warns you with specific reasons:

```bash
$ revera why request
```

```text
  ▲ revera EXPLAIN
  ──────────────────────────────────────────────────
  Package:   request@2.88.2
  Overall:   38/100  Not Recommended

  Score Breakdown

    Maintenance             15/100  ███░░░░░░░░░░░░░░░░░
                           Release cadence, commit activity, issue responsiveness, maintainer count

    Stability               90/100  ██████████████████░░
                           SemVer compliance, major version history, API volatility over time

    Security               100/100  ████████████████████
                           Known CVEs, install scripts, repository transparency

    Package Quality         40/100  ████████░░░░░░░░░░░░
                           README completeness, license, test coverage indicators, exports

    Ecosystem              100/100  ████████████████████
                           Weekly download volume, GitHub stars, community forks

    Documentation           90/100  ██████████████████░░
                           README length, code examples, API references, external docs presence

    Developer Experience    40/100  ████████░░░░░░░░░░░░
                           TypeScript support, ESM compatibility, CLI tooling

    Publisher Trust        100/100  ████████████████████
                           Known malicious releases, protestware history, supply-chain incidents

  Why it scores well
    +  Stable API (v1.0.0+)
    +  Low API volatility
    +  Zero known vulnerabilities
    +  Permissive open-source license
    +  Code examples in README
    +  Structured API documentation
    +  No known publisher trust incidents

  Minor deductions
    -  Last release was 59 months ago
    -  Single maintainer (bus factor of 1)
    -  Missing native type definitions
    -  Legacy CommonJS only
    -  No native typings (bad TypeScript DX)

  Warnings
    !  Last release: 59 months ago. No recent updates detected. This may be normal for mature, stable libraries.
    !  Package has been officially marked as deprecated by the maintainer.

  Verdict
    Request has low confidence. revera recommends looking for alternatives due to security, activity, or stability concerns.
```

---

## Installation

Install globally to access the executable from any directory:

```bash
npm install -g @aaravmaloo/revera
```

---

## Usage

### 1. Check Package Reputation
Analyze a package and get a high-level summary report:
```bash
revera check lodash
```

Run in offline mode using cached files:
```bash
revera check express --offline
```

### 2. Explain Package Rating
Get a deep-dive breakdown of the score, positive signals, and deductions:
```bash
revera why node-ipc
```

### 3. Screen and Add Dependency
Screens packages before installation and warns when reputation falls below your configured threshold:
```bash
revera add express
```
You can pass flags directly to your package manager:
```bash
revera add typescript --save-dev
```

### 4. Audit Local Workspace
Audit all packages in the current project (includes transitive dependencies) and calculate an overall project health score:
```bash
revera audit
```

Audit production dependencies only:
```bash
revera audit --prod
```

Audit direct dependencies only, skipping transitive dependencies:
```bash
revera audit --direct
```

### 5. GitHub Authentication
Authenticate with GitHub to increase API rate limits (60/hour anonymous vs 5,000/hour authenticated). You can choose between browser-based OAuth2 or manually entering a Personal Access Token. Once authorized, revera securely encrypts and stores the token in your OS keyring (Windows DPAPI, macOS Keychain, or Linux Secret Service):
```bash
revera login
```

### 6. CLI Settings
Manage local settings saved in `~/.revera/config.json`:
```bash
revera config
revera config set minScoreThreshold 75
revera config get minScoreThreshold
```

### 7. System Doctor
Verify environment settings, API status, and network connection latencies:
```bash
revera doctor
```

### 8. Cache Control
Inspect or clear local metadata cache:
```bash
revera cache
revera cache clear
```

### 9. Update Check
Verify if you are running the latest version of the revera engine:
```bash
revera update
```

---

## Comparison

| Feature | `npm audit` | `osv-scanner` | Socket | **revera** |
| :--- | :---: | :---: | :---: | :---: |
| **CVE Vulnerabilities** | ✔ | ✔ | ✔ | ✔ |
| **Multiple Vuln DBs** | ✖ | Partial | ✔ | ✔ |
| **Ecosystem Reputation** | ✖ | ✖ | Partial | ✔ |
| **Explainable Scoring** | ✖ | ✖ | Partial | ✔ |
| **Publisher Trust Check** | ✖ | ✖ | Partial | ✔ |
| **Typosquat Detection** | ✖ | ✖ | Partial | ✔ |
| **Transitive Risk Propagation** | ✖ | ✖ | ✖ | ✔ |
| **Bayesian Confidence Intervals** | ✖ | ✖ | ✖ | ✔ |

---

## Scoring Engine (v2)

Revera v2 replaced the legacy flat weighted-sum model with a four-stage Bayesian DAG pipeline.

### Stage 1 — Dependency Graph (DAG)

All dependencies in the project are resolved into a directed acyclic graph. Each node tracks its full transitive dependent set so that later stages can compute accurate blast radii.

```
lodash ──► your-app
express ──► your-app
axios ──► some-lib ──► your-app   ← transitive
```

### Stage 2 — Per-Package Scoring (Bayesian Beta Posteriors)

Each of the 8 scoring categories starts from an **archetype-specific prior** (`framework`, `cli`, `types-only`, `utility`) rather than a flat uninformed baseline. Observed signals update a Beta distribution posterior — meaning a timeout or missing data widens the credible interval rather than silently defaulting to "clean".

| Category | Weight | Focus Areas |
| :--- | :---: | :--- |
| **Security** | 20% | Active CVEs (3 DBs), install scripts, repository transparency |
| **Publisher Trust** | 15% | Protestware history, deliberate sabotage, account hijack incidents |
| **Maintenance** | 13% | Publish cadence, recent commits, open issues response ratio |
| **Stability** | 12% | SemVer compliance, major version frequency, pre-1.0 maturity |
| **Package Quality** | 13% | Source file sizes, license, exports configuration |
| **Ecosystem** | 13% | Weekly downloads (log-scaled), GitHub stars, contributor count |
| **Documentation** | 9% | README completeness, code examples, API reference coverage |
| **Developer Experience** | 5% | Native TS typings, ESM exports, tree-shaking support |

The final per-package score is a **confidence-weighted aggregate** of category posteriors (inverse-variance weighting), producing both a point estimate and a 95% credible interval.

### Stage 3 — Veto Checks

Three hard overrides bypass the Bayesian scoring entirely and immediately fail a package:

| Veto | Trigger |
| :--- | :--- |
| **Critical Trust Incident** | Publisher has a confirmed supply-chain attack or protestware release |
| **Typosquat** | Edit distance ≤ 1 from a top-N package (e.g. `lodahs`, `expres`) |
| **Unpatched Critical CVE** | A `CRITICAL` severity vulnerability with no patched version available |

### Stage 4 — Transitive Risk Propagation

After per-package scores are computed, risk is propagated bottom-up through the DAG (topological order, leaves first):

- If a dependency's `effectiveRisk` exceeds a threshold, its parent's risk is **floored at 0.8** (flagged as tainted).
- The **blast radius** of each node = `effectiveRisk × transitive_dependent_count`.
- The **worst subpath** is traced and surfaced in the audit output so you know exactly which chain of dependencies caused a flag.

### Stage 5 — Report Synthesis

The final audit report merges intrinsic scores, inherited taint, credible intervals, and blast radii into a single ranked output. The overall workspace score is a weighted average by blast radius.

---

## Vulnerability Databases

Revera queries **three independent vulnerability databases in parallel** on every check. Results are merged and deduplicated by CVE/GHSA alias before being used in scoring.

| Database | Source | Auth Required | Notes |
| :--- | :--- | :---: | :--- |
| **OSV** (osv.dev) | Google Open Source Security | ✖ | Aggregates NVD, GitHub Advisory, RUSTSEC, and more |
| **GitHub Advisory DB** | GitHub Security | ✖ | Rich CVSS scores + patched-version ranges |
| **npm Advisory** | registry.npmjs.org | ✖ | Same data as `npm audit`; sometimes publishes before OSV |

If a source times out or errors, the others continue independently. The `VulnResult` exposes which sources responded (`sources`) and which failed (`failedSources`) so the Bayesian scorer can widen the uncertainty interval appropriately rather than assuming clean.

---

## Architecture & Structure

```
.github/              # CI configurations
docs/                 # Architecture specs and algorithm diagrams
src/
  ├── commands/       # CLI command handlers (check, why, add, audit, config, cache, update)
  ├── engine/
  │   ├── dag.ts          # DAG construction + topological sort + blast-radius computation
  │   ├── propagation.ts  # Bottom-up transitive risk propagation
  │   ├── scoring.ts      # Bayesian Beta posteriors, archetype priors, veto checks
  │   ├── vuln.ts         # Multi-source vuln aggregator (OSV + GitHub + npm)
  │   ├── trust.ts        # Publisher trust incident database
  │   ├── typosquat.ts    # Edit-distance typosquat detection
  │   ├── npm.ts          # npm registry + download stats fetcher
  │   └── github.ts       # GitHub repo stats + README fetcher
  ├── ui/             # Console view templates (reporter formatters, theme styles)
  └── utils/          # Filesystem helpers (caching, configuration, package managers)
tests/                # Unit test suites
benchmarker/          # Large-scale benchmark suite (100k+ packages)
```

---

## Benchmarks

Revera ships with a built-in large-scale benchmark suite in `benchmarker/` that tests against **100k+ npm packages** in parallel and produces a single, GitHub-readable report.

### Running a benchmark

```bash
cd benchmarker
npm install
npm run fetch-dataset          # one-time: pulls ~100k packages into datasets/npm.jsonl
./benchmark.sh --workers 16   # runs the full suite
```

Each run produces a self-contained output directory with:

| File | Description |
| :--- | :--- |
| `BENCHMARK.md` | Single GitHub-readable report (accuracy, per-label detection, score distribution, latency) |
| `report.html` | Interactive browser report with charts |
| `summary.json` | Machine-readable aggregated stats |
| `results.jsonl` | Per-package results for all tested packages |
| `comparison.json` | Delta vs the previous run (regressions + improvements) |

### Latest benchmark (v2 algorithm, seed dataset)

| Label | Packages | Accuracy |
| :--- | ---: | :--- |
| `trusted` | 7,051 | 96.6% |
| `malicious` | 9 | 22.2% _(v1 baseline — v2 veto checks fix this)_ |
| `typosquat` | 20 | 35.0% _(v1 baseline — v2 edit-distance veto fixes this)_ |
| **Overall (labeled)** | **7,085** | **96.5%** |

> The v1 benchmark was run before the v2 veto checks were deployed. The per-label malicious/typosquat numbers reflect the legacy algorithm. A full v2 re-run will be published in the next release.

---

## Roadmap

- [x] Package reputation scoring
- [x] Explainable scoring reports
- [x] Direct and transitive project auditing
- [x] Publisher trust incident checks
- [x] Typosquat Levenshtein warnings
- [x] **Bayesian Beta posterior scoring (v2)**
- [x] **Transitive DAG risk propagation (v2)**
- [x] **Multi-source vulnerability aggregation (OSV + GitHub + npm)**
- [x] **GitHub-readable benchmark reports (`BENCHMARK.md`)**
- [ ] Multi-package comparison commands
- [ ] Official GitHub Action for CI checks
- [ ] Official VS Code extension
- [ ] Native pnpm support
- [ ] Native Yarn support

---

## FAQ

#### How do I avoid GitHub API rate limits?
Without a token, anonymous queries are rate-limited to 60 requests per hour. You can set a Personal Access Token in your configuration:
```bash
revera config set githubToken ghp_YOUR_TOKEN
```

#### What happens if I am offline?
Revera falls back to using cache files. You can explicitly run commands in offline mode with the `--offline` flag. If a vulnerability source is unavailable, the Bayesian scorer widens the credible interval for that package rather than assuming clean.

#### Does the add command modify my project?
Revera acts as a shell wrapper. It runs the real package installer after screening.

#### What is a "tainted" package in the audit output?
A package is marked tainted when one of its transitive dependencies triggered a veto or scored critically low. The audit output shows the worst subpath so you can trace the exact chain of dependencies that caused the flag.

#### How are vulnerabilities deduplicated across three databases?
Each vulnerability is identified by its CVE ID, GHSA ID, or npm advisory ID. When the same vulnerability appears in multiple sources, it is merged into one canonical entry. OSV data takes priority for prose fields (summary, details); the highest severity rating and most complete patched-version range across all sources are preserved.

---

## Contributing

Please review the [Contributing Guide](CONTRIBUTING.md) to get started with setup, style rules, and PR guidelines.

---

## Disclaimer

Revera provides a reputation score based on observable project signals and historical data. It is intended to assist engineering decisions and should not be treated as a definitive security audit.

---

## License

Revera is distributed under the [MIT License](LICENSE).
