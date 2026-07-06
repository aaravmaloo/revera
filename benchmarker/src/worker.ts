/**
 * worker.ts  —  Benchmark worker thread
 *
 * Spawned N times by runner.ts.  Each worker:
 *   1. Receives the path to the built Revera dist/ and the full package array
 *   2. Atomically claims the next unclaimed package via a SharedArrayBuffer counter
 *   3. Dynamically imports Revera's analyzePackage from the temp build path
 *   4. Calls analyzePackage(name, { silent: true }) — no spinners, no output
 *   5. Maps the score to a predicted category using the configurable threshold
 *   6. Posts the result back to the main thread via parentPort
 */

import { workerData, parentPort } from 'node:worker_threads';
import type { PackageEntry, BenchmarkResult, Category, Label } from './types.js';

// ─── Worker contract ───────────────────────────────────────────────────────

interface WorkerData {
  /** Absolute path to the built revera dist/ directory */
  reveraDistPath: string;
  /** Full package list (same for every worker; each claims a slice via counter) */
  packages: PackageEntry[];
  /** SharedArrayBuffer holding a single Int32 used as an atomic counter */
  sharedCounter: SharedArrayBuffer;
  /** Score >= threshold → 'safe'; below → 'risky' */
  scoreThreshold: number;
  /** Package keys already completed in a previous run (for --resume) */
  checkpointKeys: string[];
}

const data = workerData as WorkerData;
const counter = new Int32Array(data.sharedCounter);
const checkpoint = new Set<string>(data.checkpointKeys);

// ─── Classification helpers ────────────────────────────────────────────────

function classify(
  score: number,
  threshold: number,
): { category: Category; predicted_label: string } {
  if (score >= threshold) {
    return { category: 'safe', predicted_label: 'trusted' };
  }
  if (score >= threshold * 0.55) {
    return { category: 'risky', predicted_label: 'suspicious' };
  }
  return { category: 'risky', predicted_label: 'malicious' };
}

function isCorrect(label: Label, category: Category): boolean | null {
  if (label === 'unknown') return null;
  const safeLabels: Label[] = ['trusted'];
  const riskyLabels: Label[] = ['malicious', 'typosquat', 'suspicious'];
  if (safeLabels.includes(label)) return category === 'safe';
  if (riskyLabels.includes(label)) return category === 'risky';
  return null;
}

// ─── Engine loader (cached after first import) ─────────────────────────────

type AnalyzeFn = (
  name: string,
  opts: { silent: boolean; offline?: boolean },
) => Promise<{ overallScore: number }>;

let analyzePackage: AnalyzeFn | null = null;

async function loadEngine(): Promise<void> {
  if (analyzePackage) return;
  // Dynamic import from the runtime-determined temp build path
  const engineUrl = new URL(
    `file://${data.reveraDistPath}/engine/index.js`,
  );
  const mod = await import(engineUrl.href);
  analyzePackage = mod.analyzePackage as AnalyzeFn;
}

// ─── Main worker loop ──────────────────────────────────────────────────────

async function run(): Promise<void> {
  await loadEngine();

  while (true) {
    // Atomically claim the next index
    const idx = Atomics.add(counter, 0, 1);
    if (idx >= data.packages.length) break;

    const pkg = data.packages[idx];
    const key = `${pkg.registry}:${pkg.name}`;

    // Resume: skip already-completed packages
    if (checkpoint.has(key)) {
      parentPort!.postMessage({ type: 'skip', key });
      continue;
    }

    const start = Date.now();
    let result: BenchmarkResult;

    try {
      const report = await analyzePackage!(pkg.name, { silent: true });
      const score: number | null = report?.overallScore ?? null;
      const duration_ms = Date.now() - start;

      if (score === null) {
        throw new Error('analyzePackage returned no overallScore');
      }

      const { category, predicted_label } = classify(score, data.scoreThreshold);
      const correct = isCorrect(pkg.label as Label, category);

      result = {
        registry: pkg.registry,
        name: pkg.name,
        version: pkg.version,
        label: pkg.label as Label,
        score,
        category,
        predicted_label,
        correct,
        duration_ms,
        error: null,
        timestamp: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result = {
        registry: pkg.registry,
        name: pkg.name,
        version: pkg.version,
        label: pkg.label as Label,
        score: null,
        category: 'unknown',
        predicted_label: 'error',
        correct: null,
        duration_ms: Date.now() - start,
        error: message,
        timestamp: new Date().toISOString(),
      };
    }

    parentPort!.postMessage({ type: 'result', result, key });
  }

  parentPort!.postMessage({ type: 'done' });
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  parentPort!.postMessage({ type: 'fatal', message });
  process.exit(1);
});
