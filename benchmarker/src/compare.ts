/**
 * compare.ts
 *
 * Compares the current benchmark run to the most-recent previous run found in
 * ~/revera_benchmarks/.  Never mutates or deletes past runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type {
  BenchmarkResult,
  BenchmarkSummary,
  Comparison,
  Label,
  PackageDiff,
} from './types.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

async function loadResultsMap(resultsPath: string): Promise<Map<string, BenchmarkResult>> {
  const map = new Map<string, BenchmarkResult>();
  if (!fs.existsSync(resultsPath)) return map;

  const rl = readline.createInterface({
    input: fs.createReadStream(resultsPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const r: BenchmarkResult = JSON.parse(line.trim());
      map.set(`${r.registry}:${r.name}`, r);
    } catch {
      // skip malformed lines
    }
  }

  return map;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Scan benchmarksRoot for the most-recent completed run that is NOT the
 * current run.  Returns the full path to that run directory, or null.
 */
export function findPreviousBenchmarkDir(
  benchmarksRoot: string,
  currentRunId: string,
): string | null {
  if (!fs.existsSync(benchmarksRoot)) return null;

  const dirs = fs
    .readdirSync(benchmarksRoot)
    .filter((entry) => {
      if (entry === currentRunId) return false;
      const full = path.join(benchmarksRoot, entry);
      if (!fs.statSync(full).isDirectory()) return false;
      // Must have a finished summary to be a valid past run
      return fs.existsSync(path.join(full, 'summary.json'));
    })
    .sort() // ISO timestamps → chronological order when sorted lexicographically
    .reverse(); // most-recent first

  return dirs.length > 0 ? path.join(benchmarksRoot, dirs[0]) : null;
}

/**
 * Build a Comparison object from the current summary + the previous run dir.
 */
export async function generateComparison(
  currentRunId: string,
  currentSummary: BenchmarkSummary,
  currentResultsPath: string,
  previousDir: string,
): Promise<Comparison> {
  const prevId = path.basename(previousDir);
  const prevSummary: BenchmarkSummary = JSON.parse(
    fs.readFileSync(path.join(previousDir, 'summary.json'), 'utf-8'),
  );

  const currResults = await loadResultsMap(currentResultsPath);
  const prevResults = await loadResultsMap(path.join(previousDir, 'results.jsonl'));

  const regressions: PackageDiff[] = [];
  const improvements: PackageDiff[] = [];

  for (const [key, curr] of currResults) {
    const prev = prevResults.get(key);
    if (!prev) continue;

    // Only compare labeled packages where both runs have a definite answer
    if (curr.correct === null || prev.correct === null) continue;

    const diff: PackageDiff = {
      name: curr.name,
      registry: curr.registry,
      label: curr.label as Label,
      prev_score: prev.score,
      curr_score: curr.score,
      score_delta:
        curr.score !== null && prev.score !== null ? curr.score - prev.score : null,
      prev_correct: prev.correct,
      curr_correct: curr.correct,
    };

    if (prev.correct && !curr.correct) {
      regressions.push(diff);
    } else if (!prev.correct && curr.correct) {
      improvements.push(diff);
    }
  }

  // Sort regressions by largest score drop; improvements by largest score gain
  regressions.sort((a, b) => {
    const aDrop = (a.prev_score ?? 0) - (a.curr_score ?? 0);
    const bDrop = (b.prev_score ?? 0) - (b.curr_score ?? 0);
    return bDrop - aDrop;
  });

  improvements.sort((a, b) => {
    const aGain = (a.curr_score ?? 0) - (a.prev_score ?? 0);
    const bGain = (b.curr_score ?? 0) - (b.prev_score ?? 0);
    return bGain - aGain;
  });

  return {
    current_run_id: currentRunId,
    previous_run_id: prevId,
    previous_run_dir: previousDir,
    accuracy_delta: currentSummary.accuracy - prevSummary.accuracy,
    false_positives_delta: currentSummary.false_positives - prevSummary.false_positives,
    false_negatives_delta: currentSummary.false_negatives - prevSummary.false_negatives,
    correct_delta: currentSummary.correct - prevSummary.correct,
    errors_delta: currentSummary.errors - prevSummary.errors,
    top_regressions: regressions.slice(0, 25),
    top_improvements: improvements.slice(0, 25),
  };
}
