import chalk from 'chalk';
import { ReputationReport } from '../engine/scoring.js';
import { theme } from './theme.js';

function renderProgressBar(score: number): string {
  const totalBlocks = 15;
  const filledBlocks = Math.round((score / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  const colorFn = theme.getScoreColor(score);
  return colorFn(bar);
}

export function printReport(report: ReputationReport): void {
  const scoreColor = theme.getScoreColor(report.overallScore);
  const recStyle = theme.getRecommendationStyle(report.recommendation);

  // 1. Header
  console.log();
  console.log(theme.colors.primary.bold('  ▲ AEVIX PACKAGE REPORT'));
  console.log(theme.colors.muted('  ' + '─'.repeat(45)));
  console.log(`  Package:        ${chalk.white.bold(report.packageName)}@${report.version}`);
  console.log(`  Confidence:     ${scoreColor(`${report.overallScore} / 100`)} (${recStyle(report.recommendation)})`);
  console.log(theme.colors.muted('  ' + '─'.repeat(45)));

  // 2. Trust incident inline alert (high severity, not critical — critical shown in analyze.ts)
  if (report.trustIncident && report.trustIncident.severity === 'high') {
    console.log();
    console.log(`  ${chalk.bold.yellow('⚠  Publisher Trust Incident')}  ${chalk.dim(`(${report.trustIncident.year})`)}`);
    console.log(`  ${chalk.yellow(report.trustIncident.summary)}`);
    console.log(`  ${chalk.dim(report.trustIncident.detail)}`);
  }

  // 3. Category Scores
  console.log(`\n  ${chalk.white.bold('Category Scores')}`);

  const categories: { key: keyof typeof report.categoryScores; label: string }[] = [
    { key: 'maintenance',        label: 'Maintenance' },
    { key: 'stability',          label: 'Stability' },
    { key: 'security',           label: 'Security' },
    { key: 'quality',            label: 'Package Quality' },
    { key: 'ecosystem',          label: 'Ecosystem' },
    { key: 'documentation',      label: 'Documentation' },
    { key: 'developerExperience', label: 'Developer Experience' },
    { key: 'publisherTrust',     label: 'Publisher Trust' },
  ];

  for (const cat of categories) {
    const score = report.categoryScores[cat.key];
    const scoreColorFn = theme.getScoreColor(score);
    const scoreStr = `${score}/100`.padStart(7);
    const labelStr = cat.label.padEnd(22);
    console.log(`    ${chalk.gray(labelStr)} ${scoreColorFn(scoreStr)}   ${renderProgressBar(score)}`);
  }

  // 4. Positive Signals
  console.log(`\n  ${theme.colors.success.bold('Positive Signals')}`);
  if (report.positiveSignals.length === 0) {
    console.log(`    ${chalk.gray('None')}`);
  } else {
    for (const sig of report.positiveSignals) {
      console.log(`    ${theme.colors.success(theme.icons.success)}  ${chalk.white(sig)}`);
    }
  }

  // 5. Negative Signals
  console.log(`\n  ${theme.colors.danger.bold('Negative Signals')}`);
  if (report.negativeSignals.length === 0) {
    console.log(`    ${chalk.gray('None')}`);
  } else {
    for (const sig of report.negativeSignals) {
      console.log(`    ${theme.colors.danger(theme.icons.failure)}  ${chalk.white(sig)}`);
    }
  }

  // 6. Warnings
  console.log(`\n  ${theme.colors.warning.bold('Warnings')}`);
  const realWarnings = report.warnings.filter(w => w !== 'None');
  if (realWarnings.length === 0) {
    console.log(`    ${chalk.gray('None')}`);
  } else {
    for (const warn of realWarnings) {
      console.log(`    ${theme.colors.warning(theme.icons.warning)}  ${theme.colors.warning(warn)}`);
    }
  }

  // 7. Summary
  console.log(`\n  ${chalk.white.bold('Summary')}`);
  console.log(`    ${chalk.gray(report.summary)}`);
  console.log();
}
