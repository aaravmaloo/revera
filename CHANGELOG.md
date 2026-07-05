# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-05

### Added
- Initial release of **Aevix CLI** package reputation engine.
- Complete reputation scoring engine evaluating 7 categories: Maintenance, Stability, Security, Package Quality, Ecosystem, Documentation, and Developer Experience.
- Core commands: positional package analysis, `install`, `config`, `doctor`, `cache`, and `update`.
- Native type definitions and ES modules (ESM) support.
- Fully interactive `install` wrapper checking scores against customizable thresholds and falling back to detected package managers.
- Offline caching and database lookup.
- Comprehensive diagnostic `doctor` tool testing API connectivity.
