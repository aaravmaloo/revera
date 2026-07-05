import readline from 'node:readline';
import chalk from 'chalk';
import { analyzePackage } from '../engine/index.js';
import { printReport } from '../ui/reporter.js';
import { theme } from '../ui/theme.js';
import * as logger from '../utils/logger.js';

export interface AnalyzeOptions {
  offline?: boolean;
  skipPrompt?: boolean; // used internally by verify to skip interactive prompts
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

export async function handleAnalyze(packageName: string, options: AnalyzeOptions): Promise<void> {
  try {
    const report = await analyzePackage(packageName, { offline: options.offline });

    // ── Typosquat warning (shown before report) ──────────────────────────────
    if (report.typosquatWarning && !options.skipPrompt) {
      const tw = report.typosquatWarning;
      console.log();
      console.log(chalk.bold.yellow('  ⚠  TYPOSQUAT WARNING'));
      console.log(chalk.dim('  ' + '─'.repeat(50)));
      console.log(`  ${chalk.yellow(`"${packageName}"`)}`);
      console.log(`  has very low adoption and closely resembles the popular package`);
      console.log(`  ${chalk.white.bold(tw.similarTo ?? '')}  ${chalk.dim(`(edit distance: ${tw.distance})`)}`);
      console.log();
      console.log(chalk.dim('  This could be a typo or a typosquatting attempt.'));
      console.log(chalk.dim(`  Did you mean ${chalk.white.bold(`npm install ${tw.similarTo}`)}?`));
      console.log();

      const proceed = await confirm(chalk.white('  Continue with analysis anyway? [y/N] '));
      if (!proceed) {
        console.log(chalk.gray('\n  Aborted. Run with the correct package name to continue.\n'));
        process.exit(0);
      }
      console.log();
    }

    // ── Trust incident banner (shown before score, critical only) ────────────
    if (report.trustIncident && report.trustIncident.severity === 'critical') {
      console.log(chalk.bold.red('  ✖  CRITICAL TRUST INCIDENT'));
      console.log(chalk.dim('  ' + '─'.repeat(50)));
      console.log(`  ${chalk.red(report.trustIncident.summary)}`);
      console.log();
      console.log(`  ${chalk.gray(report.trustIncident.detail)}`);
      console.log();
    }

    printReport(report);
  } catch (err: any) {
    console.error(`\n${chalk.red('Error:')} ${err.message}`);
    logger.error(`Analyze command failed for ${packageName}: ${err.message}`);
    process.exit(1);
  }
}
