import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import chalk from 'chalk';
import { loadConfig, getAevixDir } from '../utils/config.js';
import { getCacheInfo } from '../utils/cache.js';
import { theme } from '../ui/theme.js';
import { retrieveToken } from '../utils/keyring.js';

async function testConnection(url: string, method: 'GET' | 'POST' = 'GET', data?: any, headers?: any): Promise<number | null> {
  const start = Date.now();
  try {
    if (method === 'POST') {
      await axios.post(url, data, { timeout: 5000, headers });
    } else {
      await axios.get(url, { timeout: 5000, headers });
    }
    return Date.now() - start;
  } catch (err) {
    return null;
  }
}

export async function handleDoctor(): Promise<void> {
  console.log(theme.colors.primary.bold('\nAEVIX DIAGNOSTICS & SYSTEM DOCTOR'));
  console.log(chalk.gray('Running health checks and diagnosing API connectivity...\n'));

  // 1. Check Node.js version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
  const nodeStatus =
    major >= 22
      ? chalk.green(`${theme.icons.success} Compatible (${nodeVer})`)
      : chalk.red(`${theme.icons.failure} Warning: Node ${nodeVer} is below recommended v22+`);
  console.log(`${chalk.white.bold('Node.js Environment:')}  ${nodeStatus}`);

  // 2. Configuration & Folders
  const aevixDir = getAevixDir();
  const configPath = path.join(aevixDir, 'config.json');
  const cachePath = path.join(aevixDir, 'cache');
  const logsPath = path.join(aevixDir, 'logs');

  let folderPerms = true;
  try {
    fs.accessSync(aevixDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    folderPerms = false;
  }

  const folderStatus = folderPerms
    ? chalk.green(`${theme.icons.success} Writable (~/.aevix)`)
    : chalk.red(`${theme.icons.failure} Permissions error: (~/.aevix) not writable`);
  console.log(`${chalk.white.bold('Storage Permissions:')} ${folderStatus}`);

  // 3. API Connectivity
  console.log(`\n${chalk.white.bold('API Network Connectivity:')}`);

  // NPM Registry
  process.stdout.write('  - NPM Registry... ');
  const npmLatency = await testConnection('https://registry.npmjs.org');
  if (npmLatency !== null) {
    console.log(chalk.green(`Connected (${npmLatency}ms)`));
  } else {
    console.log(chalk.red('Failed to connect'));
  }

  // OSV Vuln API
  process.stdout.write('  - OSV Vulnerability DB... ');
  const osvLatency = await testConnection(
    'https://api.osv.dev/v1/query',
    'POST',
    { package: { name: 'express', ecosystem: 'npm' } },
    { 'Content-Type': 'application/json' }
  );
  if (osvLatency !== null) {
    console.log(chalk.green(`Connected (${osvLatency}ms)`));
  } else {
    console.log(chalk.red('Failed to connect'));
  }

  // GitHub API & Rate limits
  process.stdout.write('  - GitHub Public API... ');
  const config = loadConfig();

  // Token priority: OS keyring > config file > environment variable
  const keyringToken = await retrieveToken();
  const token = keyringToken || config.githubToken || process.env.GITHUB_TOKEN;
  const tokenSource = keyringToken ? 'Login (keyring)' : config.githubToken ? 'Config file' : token ? 'Env variable' : null;

  const headers: any = { 'User-Agent': 'aevix-cli/1.0.0' };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  try {
    const start = Date.now();
    const ghRes = await axios.get('https://api.github.com/rate_limit', { headers, timeout: 5000 });
    const latency = Date.now() - start;
    const limit = ghRes.data.resources?.core?.limit ?? 0;
    const remaining = ghRes.data.resources?.core?.remaining ?? 0;
    const resetTime = new Date((ghRes.data.resources?.core?.reset ?? 0) * 1000).toLocaleTimeString();

    const authLabel = tokenSource
      ? chalk.green(`Authenticated via ${tokenSource}`)
      : chalk.yellow('Anonymous (run aevix login to get 5,000 req/hour)');
    console.log(
      chalk.green(`Connected (${latency}ms)`) + ` | ${authLabel} | ` +
      chalk.white(`Rate Limit: ${remaining}/${limit}`) +
      chalk.dim(` (Resets ${resetTime})`)
    );
  } catch (err: any) {
    console.log(chalk.red(`Failed to connect (${err.message})`));
  }

  // 4. Cache Info
  console.log(`\n${chalk.white.bold('Cache Status:')}`);
  const cacheInfo = getCacheInfo();
  const cacheSizeMB = (cacheInfo.sizeBytes / (1024 * 1024)).toFixed(2);
  console.log(`  - Location:   ${chalk.gray(cachePath)}`);
  console.log(`  - Files:      ${chalk.white(cacheInfo.fileCount)} files cached`);
  console.log(`  - Size:       ${chalk.white(cacheSizeMB)} MB`);

  // 5. Diagnostics Recommendation
  console.log(`\n${chalk.white.bold('Summary Verdict:')}`);
  const hasIssues = !folderPerms || npmLatency === null || osvLatency === null;
  if (hasIssues) {
    console.log(
      chalk.bold.red(
        `${theme.icons.failure}  Doctor found issue(s) that may degrade your performance. Check network, file permissions, or firewall settings.`
      )
    );
  } else {
    console.log(
      chalk.bold.green(
        `${theme.icons.success}  All systems nominal! Aevix has solid API connections and storage settings.`
      )
    );
  }
  console.log();
}
