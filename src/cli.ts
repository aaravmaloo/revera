#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAnalyze } from './commands/analyze.js';
import { handleInstall } from './commands/install.js';
import { handleConfigGet, handleConfigSet, handleConfigList } from './commands/config.js';
import { handleDoctor } from './commands/doctor.js';
import { handleCacheClear, handleCacheStatus } from './commands/cache.js';
import { handleUpdate } from './commands/update.js';
import { handleVerify } from './commands/verify.js';
import { handleExplain } from './commands/explain.js';
import { handleLogin } from './commands/login.js';
import { saveConfig } from './utils/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || '1.0.0';
  } catch (err) {
    return '1.0.0';
  }
}

const program = new Command();

program
  .name('revera')
  .description('Revera, A Open-source package reputation engine')
  .version(getVersion())
  .option('-o, --offline', 'Run using cached data only (no network requests)')
  .argument('[packageName]', 'Package name to check reputation for')
  .action(async (packageName, options) => {
    if (!packageName) {
      program.outputHelp();
      return;
    }
    await handleAnalyze(packageName, { offline: options.offline });
  });

// ── revera check <package> ─────────────────────────────────────────────────
// Check a package's reputation before installing it.
program
  .command('check <packageName>')
  .description('Check a package reputation before installing it')
  .option('-o, --offline', 'Use cached data if available')
  .action(async (packageName, options) => {
    await handleAnalyze(packageName, { offline: options.offline });
  });

// ── revera why <package> ───────────────────────────────────────────────────
// Explain exactly why a package scored what it did, category by category.
program
  .command('why <packageName>')
  .description('Explain why a package received its score, category by category')
  .option('-o, --offline', 'Use cached data if available')
  .action(async (packageName, options) => {
    await handleExplain(packageName, { offline: options.offline });
  });

// ── revera add <package> ───────────────────────────────────────────────────
// Screen a package's reputation and install it if it passes.
program
  .command('add <packageName>')
  .description('Screen a package reputation and install it if trusted')
  .option('-D, --save-dev', 'Install as a devDependency')
  .option('-o, --offline', 'Use cached data if available')
  .action(async (packageName, options) => {
    await handleInstall(packageName, options, process.argv);
  });

// ── revera audit ───────────────────────────────────────────────────────────
// Audit all dependencies in the current project, including transitive ones.
program
  .command('audit')
  .description('Audit all project dependencies including transitive packages')
  .option('--prod', 'Audit production dependencies only (skip devDependencies)')
  .option('--direct', 'Scan direct dependencies only, skip transitive')
  .option('-t, --threads <number>', 'Number of concurrent scan workers', '1')
  .action(async (options) => {
    const threadCount = parseInt(options.threads, 10) || 1;
    await handleVerify({
      prodOnly: options.prod,
      onlyModules: options.direct,
      threads: threadCount,
    });
  });

// ── revera login ───────────────────────────────────────────────────────────
program
  .command('login [provider]')
  .description('Authenticate with GitHub using OAuth2 or Personal Access Token')
  .action(async (provider) => {
    await handleLogin();
  });

// ── revera config ──────────────────────────────────────────────────────────
const configCmd = program.command('config').description('View and update Revera settings');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value  (e.g. minScoreThreshold 80)')
  .action((key, value) => {
    handleConfigSet(key, value);
  });

configCmd
  .command('get <key>')
  .description('Print the current value of a config key')
  .action((key) => {
    handleConfigGet(key);
  });

configCmd.action(() => {
  handleConfigList();
});

// ── revera doctor ──────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Run connectivity and environment health checks')
  .action(async () => {
    await handleDoctor();
  });

// ── revera cache ───────────────────────────────────────────────────────────
const cacheCmd = program.command('cache').description('Manage the offline response cache');

cacheCmd
  .command('clear')
  .description('Delete all cached API responses')
  .action(() => {
    handleCacheClear();
  });

cacheCmd.action(() => {
  handleCacheStatus();
});

// ── revera update ──────────────────────────────────────────────────────────
program
  .command('update')
  .description('Check if a newer version of Revera is available on npm')
  .action(async () => {
    await handleUpdate();
  });

program.parse(process.argv);
