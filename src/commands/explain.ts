import chalk from 'chalk';
import { analyzePackage } from '../engine/index.js';
import { theme } from '../ui/theme.js';

function bar(score: number): string {
  const total = 20;
  const filled = Math.round((score / 100) * total);
  const empty = total - filled;
  const colorFn = theme.getScoreColor(score);
  return colorFn('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

export async function handleExplain(packageName: string, options: { offline?: boolean }): Promise<void> {
  const report = await analyzePackage(packageName, { offline: options.offline });
  const scoreColor = theme.getScoreColor(report.overallScore);
  const recStyle = theme.getRecommendationStyle(report.recommendation);

  console.log();
  console.log(theme.colors.primary.bold('  ▲ AEVIX EXPLAIN'));
  console.log(theme.colors.muted('  ' + '─'.repeat(50)));
  console.log(`  Package:   ${chalk.white.bold(report.packageName)}@${report.version}`);
  console.log(`  Overall:   ${scoreColor(`${report.overallScore}/100`)}  ${recStyle(report.recommendation)}`);
  console.log();

  // Detailed category breakdown
  console.log(`  ${chalk.white.bold('Score Breakdown')}`);
  console.log();

  const categories: { key: keyof typeof report.categoryScores; label: string; why: string }[] = [
    {
      key: 'maintenance',
      label: 'Maintenance',
      why: 'Release cadence, commit activity, issue responsiveness, maintainer count',
    },
    {
      key: 'stability',
      label: 'Stability',
      why: 'SemVer compliance, major version history, API volatility over time',
    },
    {
      key: 'security',
      label: 'Security',
      why: 'Known CVEs, install scripts, repository transparency',
    },
    {
      key: 'quality',
      label: 'Package Quality',
      why: 'README completeness, license, test coverage indicators, exports',
    },
    {
      key: 'ecosystem',
      label: 'Ecosystem',
      why: 'Weekly download volume, GitHub stars, community forks',
    },
    {
      key: 'documentation',
      label: 'Documentation',
      why: 'README length, code examples, API references, external docs presence',
    },
    {
      key: 'developerExperience',
      label: 'Developer Experience',
      why: 'TypeScript support, ESM compatibility, CLI tooling',
    },
    {
      key: 'publisherTrust',
      label: 'Publisher Trust',
      why: 'Known malicious releases, protestware history, supply-chain incidents, account hijacks',
    },
  ];

  for (const cat of categories) {
    const score = report.categoryScores[cat.key];
    const scoreColorFn = theme.getScoreColor(score);
    const scoreStr = `${score}/100`.padStart(7);
    const labelStr = cat.label.padEnd(22);
    console.log(`    ${chalk.gray(labelStr)} ${scoreColorFn(scoreStr)}  ${bar(score)}`);
    console.log(`    ${chalk.gray(' '.repeat(22))} ${chalk.dim(cat.why)}`);
    console.log();
  }

  // Reasons (positive)
  if (report.positiveSignals.length > 0) {
    console.log(`  ${theme.colors.success.bold('Why it scores well')}`);
    for (const sig of report.positiveSignals) {
      console.log(`    ${theme.colors.success('+')}  ${chalk.white(sig)}`);
    }
    console.log();
  }

  // Minor deductions (negative)
  if (report.negativeSignals.length > 0) {
    console.log(`  ${theme.colors.warning.bold('Minor deductions')}`);
    for (const sig of report.negativeSignals) {
      console.log(`    ${theme.colors.warning('-')}  ${chalk.white(sig)}`);
    }
    console.log();
  }

  // Warnings
  if (report.warnings.length > 0 && report.warnings[0] !== 'None') {
    console.log(`  ${theme.colors.danger.bold('Warnings')}`);
    for (const w of report.warnings) {
      console.log(`    ${theme.colors.danger('!')}  ${chalk.white(w)}`);
    }
    console.log();
  }

  // Summary
  console.log(`  ${chalk.white.bold('Verdict')}`);
  console.log(`    ${chalk.gray(report.summary)}`);
  console.log();
}
