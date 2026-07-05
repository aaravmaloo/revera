import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import chalk from 'chalk';
import semver from 'semver';
import ora from 'ora';
import { theme } from '../ui/theme.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getCurrentVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || '1.0.0';
  } catch (err) {
    return '1.0.0';
  }
}

export async function handleUpdate(): Promise<void> {
  const current = getCurrentVersion();
  console.log(theme.colors.primary.bold('\nREVERA VERSION UPDATE CHECK'));
  console.log(`Current installed version: ${chalk.white.bold(current)}`);

  const spinner = ora('Checking for updates on npm...').start();

  try {
    // Fetch latest package metadata from npm registry
    const res = await axios.get('https://registry.npmjs.org/revera/latest', {
      timeout: 5000,
      headers: { Accept: 'application/json', 'User-Agent': 'revera-cli/1.0.0' },
    });

    spinner.stop();

    const latest = res.data.version;
    if (!latest) {
      throw new Error('Registry response did not contain a valid version.');
    }

    if (semver.gt(latest, current)) {
      console.log(chalk.bold.green(`\n${theme.icons.success}  A new update is available! ${current} → ${latest}`));
      console.log(`To install the latest version of Revera, run:`);
      console.log(chalk.cyan(`  npm install -g revera`));
      console.log(`or use pnpm:`);
      console.log(chalk.cyan(`  pnpm add -g revera`));
    } else {
      console.log(chalk.green(`\n${theme.icons.success}  You are running the latest version of Revera.`));
    }
  } catch (err: any) {
    spinner.stop();
    console.log(
      chalk.yellow(
        `\n${theme.icons.warning}  Could not check for updates. (Details: ${err.message || 'connection timeout'})`,
      ),
    );
    console.log(`You can check manually on npm: https://www.npmjs.com/package/revera`);
  }
  console.log();
}
