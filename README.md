# Aevix

[![npm version](https://img.shields.io/npm/v/aevix.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/aevix)
[![build status](https://img.shields.io/github/actions/workflow/status/aaravmaloo/aevix/ci.yml?branch=main&style=flat-square)](https://github.com/aaravmaloo/aevix/actions)
[![node version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/aevix.svg?style=flat-square&color=yellow)](LICENSE)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square)](https://github.com/aaravmaloo/aevix)

> The credit score for npm packages.

Aevix helps you decide whether a package is worth installing before you run `npm install`. It analyzes package quality, maintenance, security, ecosystem health, and publisher trust, then produces an explainable reputation report.

---

## Demo

![Aevix CLI Demo](assets/demo.gif)
*Watch Aevix check and explain packages in real time.*

---

## Quick Start

Run Aevix instantly without installation:

```bash
npx aevix check react
```

---

## Example

Checking a package like `request` (which was deprecated in 2020) immediately warns you with specific reasons:

```bash
$ aevix why request
```

```text
  ▲ AEVIX EXPLAIN
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
    Request has low confidence. Aevix recommends looking for alternatives due to security, activity, or stability concerns.
```

---

## Installation

Install globally to access the executable from any directory:

```bash
npm install -g aevix
```

---

## Usage

### 1. Check Package Reputation
Analyze a package and get a high-level summary report:
```bash
aevix check lodash
```

Run in offline mode using cached files:
```bash
aevix check express --offline
```

### 2. Explain Package Rating
Get a deep-dive breakdown of the score, positive signals, and deductions:
```bash
aevix why node-ipc
```

### 3. Screen and Add Dependency
Screens packages before installation and warns when reputation falls below your configured threshold:
```bash
aevix add express
```
You can pass flags directly to your package manager:
```bash
aevix add typescript --save-dev
```

### 4. Audit Local Workspace
Audit all packages in the current project (includes transitive dependencies) and calculate an overall project health score:
```bash
aevix audit
```

Audit production dependencies only:
```bash
aevix audit --prod
```

Audit direct dependencies only, skipping transitive dependencies:
```bash
aevix audit --direct
```

### 5. GitHub Authentication
Authenticate with GitHub to increase API rate limits (60/hour anonymous vs 5,000/hour authenticated). You can choose between browser-based OAuth2 or manually entering a Personal Access Token. Once authorized, Aevix securely encrypts and stores the token in your OS keyring (Windows DPAPI, macOS Keychain, or Linux Secret Service):
```bash
aevix login
```

### 6. CLI Settings
Manage local settings saved in `~/.aevix/config.json`:
```bash
aevix config
aevix config set minScoreThreshold 75
aevix config get minScoreThreshold
```

### 7. System Doctor
Verify environment settings, API status, and network connection latencies:
```bash
aevix doctor
```

### 8. Cache Control
Inspect or clear local metadata cache:
```bash
aevix cache
aevix cache clear
```

### 9. Update Check
Verify if you are running the latest version of the Aevix engine:
```bash
aevix update
```

---

## Comparison

| Feature | `npm audit` | `osv-scanner` | Socket | **Aevix** |
| :--- | :---: | :---: | :---: | :---: |
| **CVE Vulnerabilities** | ✔ | ✔ | ✔ | ✔ |
| **Ecosystem Reputation** | ✖ | ✖ | Partial | ✔ |
| **Explainable Scoring** | ✖ | ✖ | Partial | ✔ |
| **Publisher Trust Check** | ✖ | ✖ | Partial | ✔ |
| **Typosquat Detection** | ✖ | ✖ | Partial | ✔ |

---

## Scoring Model & Philosophy

A package's reputation is not determined by popularity alone. Aevix combines maintenance, stability, security, ecosystem maturity, documentation quality, developer experience, and publisher trust into a weighted, explainable score. Every deduction shown in the CLI corresponds to specific evidence.

### Category Weights

| Category | Weight | Focus Areas |
| :--- | :---: | :--- |
| **Security** | 20% | Active CVE advisories, execution of install scripts |
| **Publisher Trust** | 15% | Historic protestware, deliberate sabotage, account hijack registry history |
| **Maintenance** | 13% | Publish cadence, recent repository commits, open issues response ratio |
| **Stability** | 12% | SemVer compliance, major version release frequency, pre-1.0 stability |
| **Package Quality** | 13% | Source file sizes, license permissions, exports configuration |
| **Ecosystem** | 13% | Logarithmic weekly downloads scale, GitHub stars, total contributors |
| **Documentation** | 9% | Inline code blocks, API options guide, structural completeness |
| **Developer Experience** | 5% | Native TS typings, ESM exports, tree-shaking support |

---

## Roadmap

- [x] Package reputation scoring
- [x] Explainable scoring reports
- [x] Direct and transitive project auditing
- [x] Publisher trust incident checks
- [x] Typosquat Levenshtein warnings
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
aevix config set githubToken ghp_YOUR_TOKEN
```

#### What happens if I am offline?
Aevix will fall back to using cache files. You can explicitly run commands in offline mode with the `--offline` flag.

#### Does the add command modify my project?
Aevix acts as a shell wrapper. It runs the real package installer after screening.

---

## Architecture & Structure

```
.github/          # CI configurations
src/
  ├── commands/   # Cli command handlers (check, why, add, audit, config, cache, update)
  ├── engine/     # Reputation scoring modules (npm, github, OSV, trust, typosquatting)
  ├── ui/         # Console view templates (reporter formatters, theme styles)
  └── utils/      # Filesystem helpers (caching, configuration, package managers)
tests/            # Unit testing suites
docs/             # Architectural guidelines and extra documentation
```

---

## Contributing

Please review the [Contributing Guide](CONTRIBUTING.md) to get started with setup, style rules, and PR guidelines.

---

## Disclaimer

Aevix provides a reputation score based on observable project signals and historical data. It is intended to assist engineering decisions and should not be treated as a definitive security audit.

---

## License

Aevix is distributed under the [MIT License](LICENSE).
