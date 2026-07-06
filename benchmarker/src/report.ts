/**
 * report.ts
 *
 * Generates a self-contained HTML report for a benchmark run.
 * Embeds Chart.js from CDN for the score-distribution bar chart and the
 * accuracy-over-time line chart.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BenchmarkMetadata, BenchmarkSummary, Comparison } from './types.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function pct(n: number): string {
  return `${fmt(n * 100)}%`;
}

function delta(n: number, unit = ''): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${fmt(n)}${unit}`;
}

function deltaBadge(n: number, positiveIsGood = true): string {
  if (Math.abs(n) < 0.001) return `<span class="badge neutral">±0</span>`;
  const good = positiveIsGood ? n > 0 : n < 0;
  const cls = good ? 'good' : 'bad';
  return `<span class="badge ${cls}">${delta(n)}</span>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Section builders ──────────────────────────────────────────────────────

function buildMetaSection(meta: BenchmarkMetadata): string {
  const elapsed =
    meta.finished_at
      ? `${(
          (new Date(meta.finished_at).getTime() -
            new Date(meta.started_at).getTime()) /
          1000
        ).toFixed(1)}s`
      : '—';

  return `
<section class="card meta-card">
  <h2>Run Metadata</h2>
  <table class="meta-table">
    <tr><th>Run ID</th><td><code>${escHtml(meta.run_id)}</code></td></tr>
    <tr><th>Commit</th><td><code>${escHtml(meta.commit)}</code></td></tr>
    <tr><th>Branch</th><td><code>${escHtml(meta.branch)}</code></td></tr>
    <tr><th>Host</th><td>${escHtml(meta.hostname)}</td></tr>
    <tr><th>Started</th><td>${escHtml(meta.started_at)}</td></tr>
    <tr><th>Finished</th><td>${escHtml(meta.finished_at ?? '—')}</td></tr>
    <tr><th>Elapsed</th><td>${elapsed}</td></tr>
    <tr><th>Revera version</th><td><code>${escHtml(meta.revera_version)}</code></td></tr>
    <tr><th>Workers</th><td>${meta.worker_count}</td></tr>
    <tr><th>Packages</th><td>${meta.dataset_lines.toLocaleString()}</td></tr>
    <tr><th>Score threshold</th><td>${meta.score_threshold}</td></tr>
  </table>
</section>`;
}

function buildStatsSection(s: BenchmarkSummary): string {
  const accuracyPct = pct(s.accuracy);
  const errorPct = pct(s.errors / Math.max(s.total, 1));

  return `
<section class="card stats-card">
  <h2>Overall Results</h2>
  <div class="stat-grid">
    <div class="stat">
      <div class="stat-value">${accuracyPct}</div>
      <div class="stat-label">Accuracy</div>
    </div>
    <div class="stat">
      <div class="stat-value">${s.correct.toLocaleString()}</div>
      <div class="stat-label">Correct</div>
    </div>
    <div class="stat">
      <div class="stat-value">${s.incorrect.toLocaleString()}</div>
      <div class="stat-label">Incorrect</div>
    </div>
    <div class="stat">
      <div class="stat-value">${s.false_positives.toLocaleString()}</div>
      <div class="stat-label">False Positives</div>
    </div>
    <div class="stat">
      <div class="stat-value">${s.false_negatives.toLocaleString()}</div>
      <div class="stat-label">False Negatives</div>
    </div>
    <div class="stat">
      <div class="stat-value">${s.errors.toLocaleString()}</div>
      <div class="stat-label">Errors (${errorPct})</div>
    </div>
    <div class="stat">
      <div class="stat-value">${fmt(s.throughput_per_second)}/s</div>
      <div class="stat-label">Throughput</div>
    </div>
    <div class="stat">
      <div class="stat-value">${fmt(s.p50_duration_ms)}ms</div>
      <div class="stat-label">p50 latency</div>
    </div>
    <div class="stat">
      <div class="stat-value">${fmt(s.p95_duration_ms)}ms</div>
      <div class="stat-label">p95 latency</div>
    </div>
    <div class="stat">
      <div class="stat-value">${fmt(s.p99_duration_ms)}ms</div>
      <div class="stat-label">p99 latency</div>
    </div>
  </div>
</section>`;
}

function buildDistributionChart(dist: BenchmarkSummary['score_distribution']): string {
  const labels = ['0–20', '21–40', '41–60', '61–80', '81–100'];
  const values = [dist['0-20'], dist['21-40'], dist['41-60'], dist['61-80'], dist['81-100']];
  return `
<section class="card chart-card">
  <h2>Score Distribution</h2>
  <canvas id="distChart" height="180"></canvas>
  <script>
    (function() {
      var ctx = document.getElementById('distChart').getContext('2d');
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ${JSON.stringify(labels)},
          datasets: [{
            label: 'Packages',
            data: ${JSON.stringify(values)},
            backgroundColor: ['#ef4444','#f97316','#eab308','#22c55e','#10b981'],
            borderRadius: 6,
            borderSkipped: false,
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
          }
        }
      });
    })();
  </script>
</section>`;
}

function buildByLabelSection(s: BenchmarkSummary): string {
  const rows = (Object.entries(s.by_label) as [string, { total: number; correct: number; incorrect: number; errors: number; accuracy: number }][])
    .filter(([, v]) => v.total > 0)
    .map(([label, v]) => `
      <tr>
        <td><span class="label-badge label-${label}">${label}</span></td>
        <td>${v.total.toLocaleString()}</td>
        <td>${v.correct.toLocaleString()}</td>
        <td>${v.incorrect.toLocaleString()}</td>
        <td>${v.errors.toLocaleString()}</td>
        <td>${pct(v.accuracy)}</td>
      </tr>`)
    .join('');

  return `
<section class="card">
  <h2>Results by Label</h2>
  <table class="data-table">
    <thead><tr>
      <th>Label</th><th>Total</th><th>Correct</th><th>Incorrect</th><th>Errors</th><th>Accuracy</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function buildComparisonSection(cmp: Comparison): string {
  const regressRows = cmp.top_regressions
    .map(
      (r) => `
      <tr>
        <td>${escHtml(r.registry)}</td>
        <td><code>${escHtml(r.name)}</code></td>
        <td><span class="label-badge label-${r.label}">${r.label}</span></td>
        <td>${r.prev_score ?? '—'}</td>
        <td>${r.curr_score ?? '—'}</td>
        <td class="bad">${r.score_delta !== null ? delta(r.score_delta) : '—'}</td>
      </tr>`,
    )
    .join('');

  const improveRows = cmp.top_improvements
    .map(
      (r) => `
      <tr>
        <td>${escHtml(r.registry)}</td>
        <td><code>${escHtml(r.name)}</code></td>
        <td><span class="label-badge label-${r.label}">${r.label}</span></td>
        <td>${r.prev_score ?? '—'}</td>
        <td>${r.curr_score ?? '—'}</td>
        <td class="good">${r.score_delta !== null ? delta(r.score_delta) : '—'}</td>
      </tr>`,
    )
    .join('');

  return `
<section class="card comparison-card">
  <h2>Comparison vs <code>${escHtml(cmp.previous_run_id)}</code></h2>
  <div class="stat-grid compact">
    <div class="stat">
      <div class="stat-value">${deltaBadge(cmp.accuracy_delta, true)}</div>
      <div class="stat-label">Accuracy Δ</div>
    </div>
    <div class="stat">
      <div class="stat-value">${deltaBadge(cmp.correct_delta, true)}</div>
      <div class="stat-label">Correct Δ</div>
    </div>
    <div class="stat">
      <div class="stat-value">${deltaBadge(cmp.false_positives_delta, false)}</div>
      <div class="stat-label">False Positives Δ</div>
    </div>
    <div class="stat">
      <div class="stat-value">${deltaBadge(cmp.false_negatives_delta, false)}</div>
      <div class="stat-label">False Negatives Δ</div>
    </div>
    <div class="stat">
      <div class="stat-value">${deltaBadge(cmp.errors_delta, false)}</div>
      <div class="stat-label">Errors Δ</div>
    </div>
  </div>

  ${regressRows ? `
  <h3>Top Regressions (was correct → now wrong)</h3>
  <table class="data-table">
    <thead><tr>
      <th>Registry</th><th>Package</th><th>Label</th>
      <th>Prev Score</th><th>Curr Score</th><th>Δ</th>
    </tr></thead>
    <tbody>${regressRows}</tbody>
  </table>` : '<p class="muted">No regressions 🎉</p>'}

  ${improveRows ? `
  <h3>Top Improvements (was wrong → now correct)</h3>
  <table class="data-table">
    <thead><tr>
      <th>Registry</th><th>Package</th><th>Label</th>
      <th>Prev Score</th><th>Curr Score</th><th>Δ</th>
    </tr></thead>
    <tbody>${improveRows}</tbody>
  </table>` : ''}
</section>`;
}

// ─── Full document ─────────────────────────────────────────────────────────

function buildHtml(
  meta: BenchmarkMetadata,
  summary: BenchmarkSummary,
  comparison: Comparison | null,
): string {
  const accuracyPct = pct(summary.accuracy);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Revera Benchmark — ${escHtml(meta.run_id)}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --surface2: #273549;
      --border: #334155;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #6366f1;
      --good: #22c55e;
      --bad: #ef4444;
      --warn: #f97316;
    }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; line-height: 1.6; }
    a { color: var(--accent); }
    header {
      background: linear-gradient(135deg, #312e81 0%, #1e1b4b 50%, #0f172a 100%);
      padding: 2.5rem 2rem 2rem;
      border-bottom: 1px solid var(--border);
    }
    header h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.5px; }
    header h1 span { color: var(--accent); }
    header .sub { color: var(--muted); font-size: 0.9rem; margin-top: 0.3rem; }
    header .accuracy-hero { font-size: 3.5rem; font-weight: 800; color: var(--good); margin-top: 0.75rem; }
    main { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; display: grid; gap: 1.5rem; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; }
    .card h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; color: var(--text); }
    .card h3 { font-size: 0.95rem; font-weight: 600; margin: 1.25rem 0 0.75rem; color: var(--muted); }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 1rem; }
    .stat-grid.compact { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
    .stat { background: var(--surface2); border-radius: 8px; padding: 0.9rem 1rem; text-align: center; }
    .stat-value { font-size: 1.6rem; font-weight: 700; }
    .stat-label { font-size: 0.75rem; color: var(--muted); margin-top: 0.2rem; }
    .meta-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .meta-table th { text-align: left; color: var(--muted); padding: 0.4rem 0.75rem 0.4rem 0; font-weight: 500; width: 160px; }
    .meta-table td { padding: 0.4rem 0; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .data-table th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid var(--border); color: var(--muted); font-weight: 500; }
    .data-table td { padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--border); }
    .data-table tr:hover td { background: var(--surface2); }
    code { font-family: 'Fira Code', 'JetBrains Mono', monospace; font-size: 0.85em; background: var(--surface2); padding: 0.1em 0.4em; border-radius: 4px; }
    .good { color: var(--good); }
    .bad { color: var(--bad); }
    .muted { color: var(--muted); font-size: 0.9rem; }
    .badge { display: inline-block; padding: 0.15em 0.5em; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    .badge.good { background: #14532d; color: var(--good); }
    .badge.bad { background: #450a0a; color: var(--bad); }
    .badge.neutral { background: var(--surface2); color: var(--muted); }
    .label-badge { display: inline-block; padding: 0.15em 0.6em; border-radius: 999px; font-size: 0.78rem; font-weight: 600; }
    .label-trusted    { background: #14532d; color: #4ade80; }
    .label-malicious  { background: #450a0a; color: #f87171; }
    .label-typosquat  { background: #431407; color: #fb923c; }
    .label-suspicious { background: #412006; color: #fbbf24; }
    .label-unknown    { background: #1e293b; color: #94a3b8; }
    footer { text-align: center; color: var(--muted); font-size: 0.8rem; padding: 2rem; }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
<header>
  <h1><span>Revera</span> Benchmark Report</h1>
  <div class="sub">${escHtml(meta.run_id)} &nbsp;·&nbsp; ${escHtml(meta.hostname)} &nbsp;·&nbsp; ${meta.worker_count} workers</div>
  <div class="accuracy-hero">${accuracyPct}</div>
  <div class="sub">accuracy across ${(summary.correct + summary.incorrect).toLocaleString()} labeled packages</div>
</header>
<main>
  ${buildMetaSection(meta)}
  ${buildStatsSection(summary)}
  ${buildDistributionChart(summary.score_distribution)}
  ${buildByLabelSection(summary)}
  ${comparison ? buildComparisonSection(comparison) : ''}
</main>
<footer>Generated by revera-benchmarker · ${new Date().toUTCString()}</footer>
</body>
</html>`;
}

// ─── Public API ────────────────────────────────────────────────────────────

export function generateHtmlReport(
  outputDir: string,
  meta: BenchmarkMetadata,
  summary: BenchmarkSummary,
  comparison: Comparison | null,
): void {
  const html = buildHtml(meta, summary, comparison);
  const reportPath = path.join(outputDir, 'report.html');
  fs.writeFileSync(reportPath, html, 'utf-8');
}
