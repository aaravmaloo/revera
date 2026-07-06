// ─── Core Dataset Types ────────────────────────────────────────────────────

export type Registry = 'npm' | 'pypi' | 'crates' | 'go';

/**
 * Ground-truth label for a package.
 *   trusted    – well-known, safe package
 *   malicious  – confirmed malware / compromised release
 *   typosquat  – mimics a popular package name
 *   suspicious – ambiguous / historically problematic
 *   unknown    – no ground truth; used for throughput-only runs
 */
export type Label = 'trusted' | 'malicious' | 'typosquat' | 'suspicious' | 'unknown';

/** Predicted safety bucket derived from Revera score */
export type Category = 'safe' | 'risky' | 'unknown';

/** One row in a dataset JSONL file */
export interface PackageEntry {
  registry: Registry;
  name: string;
  version?: string;
  label: Label;
}

// ─── Per-Package Result ────────────────────────────────────────────────────

export interface BenchmarkResult {
  registry: string;
  name: string;
  version?: string;
  /** Ground-truth label from the dataset */
  label: Label;
  /** Score returned by Revera (0-100), null on error */
  score: number | null;
  /** Category predicted from score using score_threshold */
  category: Category;
  /** Human-readable prediction: 'trusted' | 'suspicious' | 'malicious' | 'error' */
  predicted_label: string;
  /** true/false for labeled packages; null for 'unknown' label or errors */
  correct: boolean | null;
  duration_ms: number;
  error: string | null;
  timestamp: string;
}

// ─── Run-Level Aggregates ──────────────────────────────────────────────────

export interface LabelStats {
  total: number;
  correct: number;
  incorrect: number;
  errors: number;
  accuracy: number;
}

export interface ScoreDistribution {
  '0-20': number;
  '21-40': number;
  '41-60': number;
  '61-80': number;
  '81-100': number;
}

export interface BenchmarkSummary {
  total: number;
  completed: number;
  skipped: number;
  errors: number;
  correct: number;
  incorrect: number;
  /** accuracy over labeled (non-unknown) packages only */
  accuracy: number;
  /** trusted → predicted risky */
  false_positives: number;
  /** malicious/typosquat/suspicious → predicted safe */
  false_negatives: number;
  by_label: Record<Label, LabelStats>;
  score_distribution: ScoreDistribution;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
  throughput_per_second: number;
  elapsed_ms: number;
}

// ─── Run Metadata ──────────────────────────────────────────────────────────

export interface BenchmarkMetadata {
  run_id: string;
  commit: string;
  branch: string;
  hostname: string;
  started_at: string;
  finished_at?: string;
  revera_version: string;
  dataset_path: string;
  dataset_lines: number;
  worker_count: number;
  score_threshold: number;
}

// ─── Cross-Run Comparison ──────────────────────────────────────────────────

export interface PackageDiff {
  name: string;
  registry: string;
  label: Label;
  prev_score: number | null;
  curr_score: number | null;
  score_delta: number | null;
  prev_correct: boolean | null;
  curr_correct: boolean | null;
}

export interface Comparison {
  current_run_id: string;
  previous_run_id: string;
  previous_run_dir: string;
  accuracy_delta: number;
  false_positives_delta: number;
  false_negatives_delta: number;
  correct_delta: number;
  errors_delta: number;
  /** Packages that were correct before but wrong now */
  top_regressions: PackageDiff[];
  /** Packages that were wrong before but correct now */
  top_improvements: PackageDiff[];
}
