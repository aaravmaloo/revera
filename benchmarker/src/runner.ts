/**
 * runner.ts  —  Benchmark orchestrator (main thread)
 *
 * Usage (called by benchmark.sh):
 *   node dist/runner.js \
 *     --revera-dist /tmp/revera-build-XXXX/dist \
 *     --dataset     ../datasets/npm.jsonl \
 *     --workers     8 \
 *     --output-dir  ~/revera_benchmarks \
 *     --threshold   60 \
 *     [--resume <run-id>]
 */

import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  PackageEntry,
  BenchmarkResult,
  BenchmarkSummary,
  BenchmarkMetadata,
  ScoreDistribution,
  Label,
  LabelStats,
} from './types.js';
import { loadCheckpoint, appendCheckpoint, packageKey } from './checkpoint.js';
import { findPreviousBenchmarkDir, generateComparison } from './compare.js';
import { generateHtmlReport } from './report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CLI arg parsing ────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  reveraDistPath: string;
  datasetPath: string;
  workers: number;
  outputRoot: string;
  threshold: number;
  resumeRunId: string | null;
} {
  const args = argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };

  const reveraDistPath = get('--revera-dist');
  if (!reveraDistPath) {
    console.error('Missing required flag: --revera-dist <path>');
    process.exit(1);
  }

  return {
    reveraDistPath,
    datasetPath: get('--dataset') ?? path.resolve(__dirname, '../../datasets/npm.jsonl'),
    workers: parseInt(get('--workers') ?? String(os.cpus().length), 10),
    outputRoot: get('--output-dir') ?? path.join(os.homedir(), 'revera_benchmarks'),
    threshold: parseInt(get('--threshold') ?? '60', 10),
    resumeRunId: get('--resume'),
  };
}

// ─── Dataset loader ─────────────────────────────────────────────────────────

async function loadDataset(datasetPath: string): Promise<PackageEntry[]> {
  if (!fs.existsSync(datasetPath)) {
    console.error(`Dataset not found: ${datasetPath}`);
    console.error('Run: npm run fetch-dataset  (from benchmarker/)');
    process.exit(1);
  }

  const packages: PackageEntry[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(datasetPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      packages.push(JSON.parse(trimmed) as PackageEntry);
    } catch {
      // skip malformed lines
    }
  }

  return packages;
}

// ─── Git helpers ────────────────────────────────────────────────────────────

function getGitInfo(cwd: string): { commit: string; branch: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd, stdio: 'pipe' })
      .toString()
      .trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: 'pipe' })
      .toString()
      .trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

function getReveraVersion(distPath: string): string {
  try {
    const pkgPath = path.resolve(distPath, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ─── Summary computation ────────────────────────────────────────────────────

function computeSummary(
  results: BenchmarkResult[],
  skipped: number,
  elapsed_ms: number,
): BenchmarkSummary {
  const labeled = results.filter((r) => r.label !== 'unknown' && r.error === null);

  const correct = labeled.filter((r) => r.correct === true).length;
  const incorrect = labeled.filter((r) => r.correct === false).length;
  const errors = results.filter((r) => r.error !== null).length;
  const accuracy = labeled.length > 0 ? correct / labeled.length : 0;

  const falsePosResults = labeled.filter(
    (r) => r.label === 'trusted' && r.category === 'risky',
  );
  const falseNegResults = labeled.filter(
    (r) =>
      (r.label === 'malicious' || r.label === 'typosquat' || r.label === 'suspicious') &&
      r.category === 'safe',
  );

  // Per-label breakdown
  const allLabels: Label[] = ['trusted', 'malicious', 'typosquat', 'suspicious', 'unknown'];
  const by_label = {} as Record<Label, LabelStats>;
  for (const lbl of allLabels) {
    const group = results.filter((r) => r.label === lbl);
    const c = group.filter((r) => r.correct === true).length;
    const inc = group.filter((r) => r.correct === false).length;
    const errs = group.filter((r) => r.error !== null).length;
    const tot = group.length;
    by_label[lbl] = {
      total: tot,
      correct: c,
      incorrect: inc,
      errors: errs,
      accuracy: tot > 0 ? c / tot : 0,
    };
  }

  // Score distribution
  const dist: ScoreDistribution = {
    '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0,
  };
  for (const r of results) {
    if (r.score === null) continue;
    if (r.score <= 20) dist['0-20']++;
    else if (r.score <= 40) dist['21-40']++;
    else if (r.score <= 60) dist['41-60']++;
    else if (r.score <= 80) dist['61-80']++;
    else dist['81-100']++;
  }

  // Latency percentiles
  const durations = results.map((r) => r.duration_ms).sort((a, b) => a - b);
  const p = (pct: number) =>
    durations.length > 0
      ? (durations[Math.floor((durations.length - 1) * pct)] ?? 0)
      : 0;

  const avg =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

  const elapsed_s = elapsed_ms / 1000;
  const throughput = elapsed_s > 0 ? results.length / elapsed_s : 0;

  return {
    total: results.length + skipped,
    completed: results.length,
    skipped,
    errors,
    correct,
    incorrect,
    accuracy,
    false_positives: falsePosResults.length,
    false_negatives: falseNegResults.length,
    by_label,
    score_distribution: dist,
    avg_duration_ms: avg,
    p50_duration_ms: p(0.5),
    p95_duration_ms: p(0.95),
    p99_duration_ms: p(0.99),
    throughput_per_second: throughput,
    elapsed_ms,
  };
}

// ─── Progress display ───────────────────────────────────────────────────────

function renderProgress(done: number, total: number, errors: number, start: number): void {
  const pct = total > 0 ? ((done / total) * 100).toFixed(1) : '0.0';
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  const rate = done > 0 ? (done / ((Date.now() - start) / 1000)).toFixed(1) : '0';
  const eta =
    done > 0 && done < total
      ? Math.round(((total - done) / done) * ((Date.now() - start) / 1000))
      : 0;

  process.stdout.write(
    `\r  ${pct.padStart(5)}%  ${String(done).padStart(7)}/${total}  ` +
      `err:${errors}  ${rate}/s  ` +
      (eta > 0 ? `ETA ${eta}s   ` : '         '),
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  // ── Resolve & validate paths ──────────────────────────────────────────────
  const reveraDistPath = path.resolve(opts.reveraDistPath);
  if (!fs.existsSync(reveraDistPath)) {
    console.error(`Revera dist not found: ${reveraDistPath}`);
    process.exit(1);
  }

  const datasetPath = path.resolve(opts.datasetPath);
  fs.mkdirSync(opts.outputRoot, { recursive: true });

  // ── Run ID ────────────────────────────────────────────────────────────────
  const runId =
    opts.resumeRunId ??
    new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');

  const runDir = path.join(opts.outputRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const resultsPath = path.join(runDir, 'results.jsonl');
  const checkpointPath = path.join(runDir, 'checkpoint.txt');
  const metaPath = path.join(runDir, 'metadata.json');
  const summaryPath = path.join(runDir, 'summary.json');
  const comparisonPath = path.join(runDir, 'comparison.json');

  // ── Load dataset ──────────────────────────────────────────────────────────
  console.log(`\n▶  Loading dataset: ${datasetPath}`);
  const packages = await loadDataset(datasetPath);
  console.log(`   ${packages.length.toLocaleString()} packages loaded`);

  // ── Load checkpoint (for resume) ──────────────────────────────────────────
  const completedKeys = await loadCheckpoint(checkpointPath);
  const skippedCount = completedKeys.size;
  if (skippedCount > 0) {
    console.log(`   Resuming — skipping ${skippedCount.toLocaleString()} already-completed packages`);
  }

  // ── Git / version info ────────────────────────────────────────────────────
  const repoRoot = path.resolve(reveraDistPath, '../..');
  const { commit, branch } = getGitInfo(repoRoot);
  const reveraVersion = getReveraVersion(reveraDistPath);

  // ── Write initial metadata ────────────────────────────────────────────────
  const meta: BenchmarkMetadata = {
    run_id: runId,
    commit,
    branch,
    hostname: os.hostname(),
    started_at: new Date().toISOString(),
    revera_version: reveraVersion,
    dataset_path: datasetPath,
    dataset_lines: packages.length,
    worker_count: opts.workers,
    score_threshold: opts.threshold,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  console.log(`▶  Run ID : ${runId}`);
  console.log(`   Workers : ${opts.workers}`);
  console.log(`   Revera  : v${reveraVersion} @ ${commit} (${branch})`);
  console.log(`   Output  : ${runDir}`);
  console.log('');

  // ── Shared atomic counter (work queue) ───────────────────────────────────
  const sab = new SharedArrayBuffer(4);
  const counter = new Int32Array(sab);
  // Initialise counter to skip already-done packages quickly
  // (workers will encounter them and check the checkpoint set)
  Atomics.store(counter, 0, 0);

  // ── Result writer (appends to results.jsonl + checkpoint) ────────────────
  const resultsStream = fs.createWriteStream(resultsPath, { flags: 'a' });
  const allResults: BenchmarkResult[] = [];
  let doneCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  // ── Spawn workers ─────────────────────────────────────────────────────────
  const workerPath = new URL('./worker.js', import.meta.url);
  const workers: Worker[] = [];
  let finishedWorkers = 0;

  console.log('▶  Running...\n');

  await new Promise<void>((resolve, reject) => {
    const checkDone = (): void => {
      if (finishedWorkers === opts.workers) resolve();
    };

    for (let i = 0; i < opts.workers; i++) {
      const w = new Worker(workerPath, {
        workerData: {
          reveraDistPath,
          packages,
          sharedCounter: sab,
          scoreThreshold: opts.threshold,
          checkpointKeys: [...completedKeys],
        },
      });

      w.on('message', (msg: { type: string; result?: BenchmarkResult; key?: string; message?: string }) => {
        if (msg.type === 'result' && msg.result) {
          const r = msg.result;
          allResults.push(r);
          resultsStream.write(JSON.stringify(r) + '\n');
          appendCheckpoint(checkpointPath, msg.key!);
          doneCount++;
          if (r.error) errorCount++;
          if (doneCount % 50 === 0 || doneCount === packages.length - skippedCount) {
            renderProgress(doneCount + skippedCount, packages.length, errorCount, startTime);
          }
        } else if (msg.type === 'skip') {
          // already counted in skippedCount
        } else if (msg.type === 'done') {
          finishedWorkers++;
          checkDone();
        } else if (msg.type === 'fatal') {
          console.error(`\n  Worker fatal: ${msg.message}`);
          reject(new Error(msg.message));
        }
      });

      w.on('error', reject);
      workers.push(w);
    }
  });

  resultsStream.end();
  const elapsed_ms = Date.now() - startTime;
  process.stdout.write('\n');

  // ── Compute summary ───────────────────────────────────────────────────────
  console.log('\n▶  Computing summary...');
  const summary = computeSummary(allResults, skippedCount, elapsed_ms);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  // ── Finalise metadata ─────────────────────────────────────────────────────
  meta.finished_at = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  // ── Compare to previous run ───────────────────────────────────────────────
  let comparison = null;
  const prevDir = findPreviousBenchmarkDir(opts.outputRoot, runId);
  if (prevDir) {
    console.log(`▶  Comparing to: ${path.basename(prevDir)}`);
    try {
      comparison = await generateComparison(runId, summary, resultsPath, prevDir);
      fs.writeFileSync(comparisonPath, JSON.stringify(comparison, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`  Warning: comparison failed — ${(err as Error).message}`);
    }
  }

  // ── Generate HTML report ──────────────────────────────────────────────────
  console.log('▶  Generating HTML report...');
  generateHtmlReport(runDir, meta, summary, comparison);

  // ── Print final summary ───────────────────────────────────────────────────
  const acc = (summary.accuracy * 100).toFixed(2);
  console.log('\n────────────────────────────────────────────────────');
  console.log(`  Accuracy       : ${acc}%`);
  console.log(`  Correct        : ${summary.correct.toLocaleString()} / ${(summary.correct + summary.incorrect).toLocaleString()} labeled`);
  console.log(`  False Positives: ${summary.false_positives}`);
  console.log(`  False Negatives: ${summary.false_negatives}`);
  console.log(`  Errors         : ${summary.errors.toLocaleString()}`);
  console.log(`  Throughput     : ${summary.throughput_per_second.toFixed(1)} pkg/s`);
  console.log(`  p50 / p95 / p99: ${summary.p50_duration_ms.toFixed(0)}ms / ${summary.p95_duration_ms.toFixed(0)}ms / ${summary.p99_duration_ms.toFixed(0)}ms`);

  if (comparison) {
    const sign = (n: number) => (n >= 0 ? '+' : '');
    console.log('\n  vs previous run:');
    console.log(`    Accuracy Δ       : ${sign(comparison.accuracy_delta)}${(comparison.accuracy_delta * 100).toFixed(2)}%`);
    console.log(`    Correct Δ        : ${sign(comparison.correct_delta)}${comparison.correct_delta}`);
    console.log(`    False Positives Δ: ${sign(comparison.false_positives_delta)}${comparison.false_positives_delta}`);
    console.log(`    False Negatives Δ: ${sign(comparison.false_negatives_delta)}${comparison.false_negatives_delta}`);
    console.log(`    Regressions      : ${comparison.top_regressions.length}`);
    console.log(`    Improvements     : ${comparison.top_improvements.length}`);
  }

  console.log('────────────────────────────────────────────────────');
  console.log(`\n✓  Results saved to: ${runDir}`);
  console.log(`   report.html   → open in browser`);
  console.log(`   results.jsonl → all ${allResults.length.toLocaleString()} results`);
  console.log(`   summary.json  → aggregated stats\n`);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
