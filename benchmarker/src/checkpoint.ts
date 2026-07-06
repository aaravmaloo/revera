/**
 * checkpoint.ts
 *
 * Each benchmark run stores a checkpoint file at:
 *   ~/revera_benchmarks/<run_id>/checkpoint.txt
 *
 * Each completed line is a package key  "registry:name"
 * On resume the runner skips any key already in the checkpoint set.
 */

import fs from 'node:fs';
import readline from 'node:readline';

/** Load all completed package keys from an existing checkpoint file. */
export async function loadCheckpoint(checkpointPath: string): Promise<Set<string>> {
  const set = new Set<string>();
  if (!fs.existsSync(checkpointPath)) return set;

  const rl = readline.createInterface({
    input: fs.createReadStream(checkpointPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const key = line.trim();
    if (key) set.add(key);
  }

  return set;
}

/** Append a completed package key to the checkpoint file (atomic-safe for single writer). */
export function appendCheckpoint(checkpointPath: string, key: string): void {
  fs.appendFileSync(checkpointPath, key + '\n', 'utf-8');
}

/** Package key used in checkpoint and result maps. */
export function packageKey(registry: string, name: string): string {
  return `${registry}:${name}`;
}
