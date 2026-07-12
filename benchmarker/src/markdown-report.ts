/**
 * markdown-report.ts
 *
 * Generates a single, self-contained Markdown benchmark report that is
 * readable directly on GitHub (no browser, no CDN, no JavaScript).
 *
 * Structure:
 *   1. TL;DR header — one-line verdict + overall accuracy badge
 *   2. Run metadata table
 *   3. Dataset breakdown — labeled vs unlabeled, counts per label
 *   4. Overall result scorecard
 *   5. Per-label accuracy table (detection deep-dive)
 *   6. Score distribution (ASCII bar chart)
 *   7. Performance / latency
 *   8. Comparison vs previous run (regressions & improvements)
 *   9. Methodology note
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BenchmarkMetadata, BenchmarkSummary, Comparison } from './types.js';

// ─── Formatting helpers ────────────────────────────────────────────────────

function pct(n: number, decimals = 2): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

function ms(n: number): string {
  return `${n.toFixed(0)} ms`;
}

function sign(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function signPct(n: number): string {
  return n >= 0 ? `+${pct(n)}` : pct(n);
}

/** Render a horizontal ASCII bar scaled to `width` chars. */
function bar(value: number, max: number, width = 30): string {
  if (max === 0) return '░'.repeat(width);
  const filled = Math.round((value / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Emoji verdict based on accuracy */
function verdict(accuracy: number): string {
  if (accuracy >= 0.95) return '🟢 Excellent';
  if (accuracy >= 0.85) return '🟡 Good';
  if (accuracy >= 0.70) return '🟠 Fair';
  return '🔴 Poor';
}

/** Emoji for individual label accuracy */
function labelEmoji(accuracy: number, total: number): string {
  if (total === 0) return '—';
  if (accuracy >= 0.90) return '✅';
  if (accuracy >= 0.70) return '⚠️';
  return '❌';
}

/** Human-readable elapsed time */
function elapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = (s % 60).toFixed(0);
  return `${m}m ${rem}s`;
}

// ─── Section builders ──────────────────────────────────────────────────────

function buildHeader(meta: BenchmarkMetadata, s: BenchmarkSummary): string {
  const labeledTotal = s.correct + s.incorrect;
  const v = verdict(s.accuracy);
  const lines = [
    `# Revera Benchmark Report`,
    ``,
    `> **Run \`${meta.run_id}\`** · Revera v${meta.revera_version} · ${meta.hostname}`,
    ``,
    `## ${v} — Overall Accuracy: ${pct(s.accuracy)}`,
    ``,
    `Revera correctly classified **${s.correct.toLocaleString()} of ${labeledTotal.toLocaleString()}** ` +
      `labeled packages across ${s.total.toLocaleString()} total packages tested.`,
    ``,
    `---`,
  ];
  return lines.join('\n');
}

function buildMetadata(meta: BenchmarkMetadata): string {
  const finishedAt = meta.finished_at ?? '—';
  const elapsedStr =
    meta.finished_at
      ? elapsed(new Date(meta.finished_at).getTime() - new Date(meta.started_at).getTime())
      : '—';

  return [
    `## Run Metadata`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Run ID | \`${meta.run_id}\` |`,
    `| Revera version | \`v${meta.revera_version}\` |`,
    `| Commit | \`${meta.commit}\` |`,
    `| Branch | \`${meta.branch}\` |`,
    `| Host | ${meta.hostname} |`,
    `| Workers | ${meta.worker_count} |`,
    `| Score threshold | ${meta.score_threshold} (≥ trusted, < risky) |`,
    `| Started | ${meta.started_at} |`,
    `| Finished | ${finishedAt} |`,
    `| Elapsed | ${elapsedStr} |`,
    ``,
    `---`,
  ].join('\n');
}

function buildDatasetBreakdown(meta: BenchmarkMetadata, s: BenchmarkSummary): string {
  const labeledCount = Object.entries(s.by_label)
    .filter(([lbl]) => lbl !== 'unknown')
    .reduce((acc, [, v]) => acc + v.total, 0);

  const unknownCount = s.by_label.unknown?.total ?? 0;

  const rows = Object.entries(s.by_label)
    .map(([lbl, v]) => {
      const role =
        lbl === 'trusted'
          ? 'Ground-truth safe packages'
          : lbl === 'malicious'
            ? 'Confirmed malware / compromised releases'
            : lbl === 'typosquat'
              ? 'Name-mimicry / typosquatting packages'
              : lbl === 'suspicious'
                ? 'Historically problematic packages'
                : 'No ground-truth (throughput only)';
      return `| \`${lbl}\` | ${v.total.toLocaleString()} | ${role} |`;
    })
    .join('\n');

  return [
    `## Dataset`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total packages in dataset | ${meta.dataset_lines.toLocaleString()} |`,
    `| Packages tested (completed) | ${s.completed.toLocaleString()} |`,
    `| Packages skipped (resumed) | ${s.skipped.toLocaleString()} |`,
    `| **Labeled** (contribute to accuracy) | **${labeledCount.toLocaleString()}** |`,
    `| Unlabeled \`unknown\` (throughput only) | ${unknownCount.toLocaleString()} |`,
    `| Errors during analysis | ${s.errors.toLocaleString()} |`,
    ``,
    `### Label Composition`,
    ``,
    `| Label | Count | Description |`,
    `|-------|------:|-------------|`,
    rows,
    ``,
    `---`,
  ].join('\n');
}

function buildOverallResults(s: BenchmarkSummary): string {
  const labeledTotal = s.correct + s.incorrect;
  const precision =
    s.correct + s.false_positives > 0 ? s.correct / (s.correct + s.false_positives) : 0;
  const recall =
    s.correct + s.false_negatives > 0 ? s.correct / (s.correct + s.false_negatives) : 0;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return [
    `## Overall Results`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| **Accuracy** | **${pct(s.accuracy)}** |`,
    `| Correct predictions | ${s.correct.toLocaleString()} / ${labeledTotal.toLocaleString()} |`,
    `| Incorrect predictions | ${s.incorrect.toLocaleString()} |`,
    `| False Positives (trusted → flagged risky) | ${s.false_positives.toLocaleString()} |`,
    `| False Negatives (threat → missed as safe) | ${s.false_negatives.toLocaleString()} |`,
    `| Precision | ${pct(precision)} |`,
    `| Recall | ${pct(recall)} |`,
    `| F1 Score | ${f1.toFixed(4)} |`,
    `| Error rate | ${pct(s.errors / Math.max(s.total, 1))} (${s.errors} packages) |`,
    ``,
    `> **False Negatives** are the critical failure mode — a missed malicious package.`,
    `> **False Positives** flag safe packages as risky (noise, not a safety risk).`,
    ``,
    `---`,
  ].join('\n');
}

function buildPerLabelAccuracy(s: BenchmarkSummary): string {
  const rows = Object.entries(s.by_label)
    .filter(([, v]) => v.total > 0)
    .map(([lbl, v]) => {
      const acc = v.total > 0 && lbl !== 'unknown' ? pct(v.accuracy) : '—';
      const emoji = lbl !== 'unknown' ? labelEmoji(v.accuracy, v.total) : '—';
      const correctStr = lbl !== 'unknown' ? `${v.correct} / ${v.total - v.errors}` : `— / ${v.total}`;
      const errNote = v.errors > 0 ? ` _(${v.errors} errors)_` : '';
      return `| \`${lbl}\` | ${v.total.toLocaleString()} | ${correctStr}${errNote} | ${v.incorrect.toLocaleString()} | ${acc} | ${emoji} |`;
    })
    .join('\n');

  return [
    `## Detection Accuracy by Label`,
    ``,
    `This section shows how well Revera identifies each category of package.`,
    `Accuracy is computed only over packages where Revera did not error out.`,
    ``,
    `| Label | Total | Correct | Incorrect | Accuracy | Status |`,
    `|-------|------:|---------|----------:|----------|--------|`,
    rows,
    ``,
    `### What each label means`,
    ``,
    `- **\`trusted\`** — well-known, widely-used packages (e.g. \`express\`, \`react\`, \`lodash\`).`,
    `  Accuracy here measures how often Revera correctly calls them safe.`,
    `- **\`malicious\`** — confirmed supply-chain attacks or malware.`,
    `  Accuracy here is the *threat detection rate*.`,
    `- **\`typosquat\`** — packages that impersonate popular ones via name tricks.`,
    `  Accuracy here is the *typosquat catch rate*.`,
    `- **\`suspicious\`** — historically problematic packages (protestware, sabotage, etc).`,
    `  Accuracy here measures whether Revera down-scores them appropriately.`,
    `- **\`unknown\`** — no ground-truth label; included for throughput/stability runs only.`,
    `  Accuracy is not computed for this group.`,
    ``,
    `---`,
  ].join('\n');
}

function buildScoreDistribution(s: BenchmarkSummary): string {
  const dist = s.score_distribution;
  const buckets: [string, number][] = [
    ['0–20  (critical risk)', dist['0-20']],
    ['21–40 (high risk)', dist['21-40']],
    ['41–60 (moderate)', dist['41-60']],
    ['61–80 (good)', dist['61-80']],
    ['81–100 (excellent)', dist['81-100']],
  ];
  const maxVal = Math.max(...buckets.map(([, v]) => v));

  const rows = buckets
    .map(([label, count]) => {
      const b = bar(count, maxVal, 28);
      const pctStr = pct(count / Math.max(s.completed, 1), 1);
      return `| ${label.padEnd(22)} | \`${b}\` | ${count.toLocaleString().padStart(6)} | ${pctStr.padStart(6)} |`;
    })
    .join('\n');

  return [
    `## Score Distribution`,
    ``,
    `How Revera scored all **${s.completed.toLocaleString()}** packages (including \`unknown\` ones):`,
    ``,
    `| Score bucket | Distribution | Count | Share |`,
    `|--------------|--------------|------:|------:|`,
    rows,
    ``,
    `> Scores ≥ ${60} → predicted **trusted/safe**. Scores < ${60} → predicted **risky**.`,
    ``,
    `---`,
  ].join('\n');
}

function buildPerformance(s: BenchmarkSummary): string {
  return [
    `## Performance`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Throughput | ${s.throughput_per_second.toFixed(2)} packages/s |`,
    `| Average latency | ${ms(s.avg_duration_ms)} |`,
    `| p50 (median) latency | ${ms(s.p50_duration_ms)} |`,
    `| p95 latency | ${ms(s.p95_duration_ms)} |`,
    `| p99 latency | ${ms(s.p99_duration_ms)} |`,
    `| Total elapsed | ${elapsed(s.elapsed_ms)} |`,
    ``,
    `---`,
  ].join('\n');
}

function buildComparison(cmp: Comparison, threshold: number): string {
  const accDeltaStr = signPct(cmp.accuracy_delta);
  const correctDeltaStr = sign(cmp.correct_delta);
  const fpDeltaStr = sign(cmp.false_positives_delta);
  const fnDeltaStr = sign(cmp.false_negatives_delta);
  const errDeltaStr = sign(cmp.errors_delta);

  const regressSection =
    cmp.top_regressions.length === 0
      ? `_No regressions — every previously-correct package is still correct. 🎉_`
      : [
          `| Package | Label | Prev Score | Curr Score | Δ |`,
          `|---------|-------|:----------:|:----------:|---|`,
          ...cmp.top_regressions.slice(0, 20).map(
            (r) =>
              `| \`${r.registry}/${r.name}\` | \`${r.label}\` | ${r.prev_score ?? '—'} | ${r.curr_score ?? '—'} | ${r.score_delta !== null ? sign(Math.round(r.score_delta)) : '—'} |`,
          ),
        ].join('\n');

  const improveSection =
    cmp.top_improvements.length === 0
      ? `_No new improvements recorded._`
      : [
          `| Package | Label | Prev Score | Curr Score | Δ |`,
          `|---------|-------|:----------:|:----------:|---|`,
          ...cmp.top_improvements.slice(0, 20).map(
            (r) =>
              `| \`${r.registry}/${r.name}\` | \`${r.label}\` | ${r.prev_score ?? '—'} | ${r.curr_score ?? '—'} | ${r.score_delta !== null ? sign(Math.round(r.score_delta)) : '—'} |`,
          ),
        ].join('\n');

  return [
    `## Comparison vs Previous Run (\`${cmp.previous_run_id}\`)`,
    ``,
    `| Metric | Delta |`,
    `|--------|-------|`,
    `| Accuracy | ${accDeltaStr} |`,
    `| Correct predictions | ${correctDeltaStr} |`,
    `| False Positives | ${fpDeltaStr} |`,
    `| False Negatives | ${fnDeltaStr} |`,
    `| Errors | ${errDeltaStr} |`,
    `| Regressions (correct → wrong) | ${cmp.top_regressions.length} |`,
    `| Improvements (wrong → correct) | ${cmp.top_improvements.length} |`,
    ``,
    `### ⚠️ Regressions (was correct → now wrong)`,
    ``,
    regressSection,
    ``,
    `### ✅ Improvements (was wrong → now correct)`,
    ``,
    improveSection,
    ``,
    `---`,
  ].join('\n');
}

function buildMethodology(meta: BenchmarkMetadata): string {
  return [
    `## Methodology`,
    ``,
    `### How accuracy is calculated`,
    ``,
    `Only **labeled** packages (those with a ground-truth label of \`trusted\`,`,
    `\`malicious\`, \`typosquat\`, or \`suspicious\`) contribute to accuracy statistics.`,
    `Packages labeled \`unknown\` are excluded from accuracy but counted in totals.`,
    ``,
    `**Classification rule** (threshold = ${meta.score_threshold}):`,
    ``,
    `| Revera Score | Prediction |`,
    `|:------------:|:----------:|`,
    `| ≥ ${meta.score_threshold} | \`safe\` (trusted) |`,
    `| ≥ ${Math.round(meta.score_threshold * 0.55)} and < ${meta.score_threshold} | \`suspicious\` (risky) |`,
    `| < ${Math.round(meta.score_threshold * 0.55)} | \`malicious\` (risky) |`,
    ``,
    `- A **\`trusted\`** package predicted \`risky\` = **False Positive**.`,
    `- A **\`malicious\`/\`typosquat\`/\`suspicious\`** package predicted \`safe\` = **False Negative**.`,
    ``,
    `### Dataset sources`,
    ``,
    `- \`datasets/known-trusted.jsonl\` — ~300 hand-curated ground-truth safe packages`,
    `- \`datasets/known-malicious.jsonl\` — ~60 confirmed malicious/typosquat packages`,
    `- \`datasets/npm.jsonl\` — 100k+ packages pulled from the npm registry (label: \`unknown\`)`,
    ``,
    `---`,
    ``,
    `_Generated by revera-benchmarker · ${new Date().toUTCString()}_`,
  ].join('\n');
}

// ─── Public API ────────────────────────────────────────────────────────────

export function generateMarkdownReport(
  outputDir: string,
  meta: BenchmarkMetadata,
  summary: BenchmarkSummary,
  comparison: Comparison | null,
): void {
  const sections: string[] = [
    buildHeader(meta, summary),
    buildMetadata(meta),
    buildDatasetBreakdown(meta, summary),
    buildOverallResults(summary),
    buildPerLabelAccuracy(summary),
    buildScoreDistribution(summary),
    buildPerformance(summary),
  ];

  if (comparison) {
    sections.push(buildComparison(comparison, meta.score_threshold));
  }

  sections.push(buildMethodology(meta));

  const markdown = sections.join('\n\n') + '\n';
  const reportPath = path.join(outputDir, 'BENCHMARK.md');
  fs.writeFileSync(reportPath, markdown, 'utf-8');
}
