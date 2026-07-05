import readline from 'node:readline';
import { execa } from 'execa';
import chalk from 'chalk';
import { analyzePackage } from '../engine/index.js';
import { printReport } from '../ui/reporter.js';
import { loadConfig } from '../utils/config.js';
import { detectPackageManager, getInstallCommand } from '../utils/pm.js';
import * as logger from '../utils/logger.js';
import { theme } from '../ui/theme.js';

export interface InstallOptions {
  offline?: boolean;
  saveDev?: boolean;
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    }),
  );
}

export async function handleInstall(packageName: string, options: InstallOptions, rawArgs: string[]): Promise<void> {
  const config = loadConfig();

  try {
    // 1. Analyze package first
    const report = await analyzePackage(packageName, { offline: options.offline });

    // 2. Display the reputation report
    printReport(report);

    // 3. Evaluate threshold check
    let proceed = true;
    if (report.overallScore < config.minScoreThreshold) {
      console.log(
        chalk.bold.yellow(
          `\n${theme.icons.warning}  WARNING: Package reputation score (${report.overallScore}/100) is below the threshold of ${config.minScoreThreshold}/100.`,
        ),
      );
      if (report.warnings.length > 0 && report.warnings[0] !== 'None') {
        console.log(chalk.yellow(`Reason(s):`));
        for (const w of report.warnings) {
          console.log(chalk.yellow(`  - ${w}`));
        }
      }
      console.log();

      const answer = await askQuestion(chalk.cyan('Proceed with installation? [Y/n] '));
      const normalized = answer.trim().toLowerCase();
      if (normalized === 'n' || normalized === 'no') {
        proceed = false;
      }
    }

    if (!proceed) {
      console.log(chalk.red('\nInstallation aborted by user.'));
      process.exit(0);
    }

    // 4. Run real package manager command
    const pm = detectPackageManager();
    const { cmd, args } = getInstallCommand(pm, packageName, options.saveDev);

    // Append any extra flags that the user specified (e.g. --legacy-peer-deps)
    // Commander passes rawArgs, filter out our custom command words
    // If the user ran: revera install express --some-flag
    // We want to pass --some-flag to the package manager
    const extraArgs = rawArgs.filter((arg) => {
      // Exclude main keywords
      return arg !== 'install' && arg !== 'revera' && arg !== packageName && arg !== '--save-dev' && arg !== '-D';
    });

    const finalArgs = [...args, ...extraArgs];

    console.log(
      theme.colors.primary.bold(`\nInstalling "${packageName}" via ${pm} (${cmd} ${finalArgs.join(' ')})` + '...'),
    );

    logger.info(`Running installer: ${cmd} ${finalArgs.join(' ')}`);

    // Run command in the current shell context so output is printed to the terminal
    const installProcess = execa(cmd, finalArgs, {
      stdio: 'inherit',
      reject: false, // Don't crash Revera if NPM fails; let NPM print its errors
    });

    const result = await installProcess;

    if (result.exitCode === 0) {
      console.log(chalk.bold.green(`\n${theme.icons.success}  Successfully installed "${packageName}"!`));
    } else {
      console.log(
        chalk.bold.red(
          `\n${theme.icons.failure}  Package manager installation failed with exit code ${result.exitCode}.`,
        ),
      );
      process.exit(result.exitCode);
    }
  } catch (err: any) {
    console.error(`\nError during install: ${err.message}`);
    logger.error(`Install command failed for ${packageName}: ${err.message}`);
    process.exit(1);
  }
}
