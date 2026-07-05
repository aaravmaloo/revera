import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface AevixConfig {
  githubToken?: string;
  cacheTtlMs: number;
  installSuggest: boolean;
  minScoreThreshold: number;
  theme: 'dark' | 'light' | 'glass';
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'auto';
}

const DEFAULT_CONFIG: AevixConfig = {
  cacheTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  installSuggest: false,
  minScoreThreshold: 70,
  theme: 'dark',
  packageManager: 'auto',
};

const CONFIG_DIR = path.join(os.homedir(), '.aevix');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getAevixDir(): string {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  return CONFIG_DIR;
}

export function loadConfig(): AevixConfig {
  const dir = getAevixDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    // Return defaults if file is corrupted
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Partial<AevixConfig>): AevixConfig {
  const dir = getAevixDir();
  const current = fs.existsSync(CONFIG_FILE) ? loadConfig() : DEFAULT_CONFIG;
  const updated = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}
