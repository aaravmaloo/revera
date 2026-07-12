import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { analyzePackage, buildDAG, propagateRisk, DAGNode } from '../engine/index.js';
import { loadConfig } from '../utils/config.js';
import { theme } from '../ui/theme.js';
import * as logger from '../utils/logger.js';

interface ScanResult {
  name: string;
  installedVersion: string;
  score: number;
  recommendation: string;
  vulnerabilitiesCount: number;
  warnings: string[];
  isDirect: boolean;
  isProd: boolean;
  dependents: Set<string>;
  depth: number;
}

export interface VerifyOptions {
  prodOnly?: boolean;
  onlyModules?: boolean;
  threads?: number;
}

function getPackageImportance(res: ScanResult): { level: string; label: string; reason: string } {
  if (res.isDirect) {
    if (res.isProd) {
      return {
        level: 'Critical',
        label: chalk.red.bold('Critical'),
        reason: 'Direct production dependency',
      };
    } else {
      return {
        level: 'Medium',
        label: chalk.yellow('Medium'),
        reason: 'Direct development dependency',
      };
    }
  } else {
    const parentCount = res.dependents.size;
    const isMany = parentCount > 3;
    const scopeLabel = res.isProd ? 'production' : 'development';

    if (isMany) {
      return {
        level: res.isProd ? 'High' : 'Medium',
        label: res.isProd ? chalk.red('High') : chalk.yellow('Medium'),
        reason: `Transitive ${scopeLabel} dependency, required by ${parentCount} packages`,
      };
    } else {
      return {
        level: 'Low',
        label: chalk.blue('Low'),
        reason: `Transitive ${scopeLabel} dependency, required by ${parentCount} package${parentCount > 1 ? 's' : ''}`,
      };
    }
  }
}

function printPackageRow(res: ScanResult, config: ReturnType<typeof loadConfig>) {
  const isFail = res.score < config.minScoreThreshold;
  const isWarn = res.warnings.length > 0;
  const scoreColor = theme.getScoreColor(res.score);

  let icon = theme.colors.success(theme.icons.success);
  if (isFail) icon = theme.colors.danger(theme.icons.failure);
  else if (isWarn) icon = theme.colors.warning(theme.icons.warning);

  const nameVer = `${chalk.white(res.name)}${chalk.gray('@')}${chalk.gray(res.installedVersion)}`;
  const score = scoreColor(`${res.score}/100`);

  const importance = getPackageImportance(res);

  console.log(
    `  ${icon}  ${nameVer.padEnd(42)}  ${score}  [${importance.label.padEnd(18)}] ${chalk.dim(importance.reason)}`,
  );

  // Warnings on their own indented lines
  for (const w of res.warnings) {
    const styledfn = isFail ? theme.colors.danger : theme.colors.warning;
    console.log(`     ${chalk.gray('└')} ${styledfn(w)}`);
  }

  if (isFail && res.warnings.length === 0) {
    console.log(
      `     ${chalk.gray('└')} ${theme.colors.danger(`Score below threshold (${res.score}/${config.minScoreThreshold})`)}`,
    );
  }
}

export async function handleVerify(options: VerifyOptions): Promise<void> {
  const config = loadConfig();
  const projectPkgPath = path.join(process.cwd(), 'package.json');
  const nodeModulesDir = path.join(process.cwd(), 'node_modules');

  if (!fs.existsSync(projectPkgPath)) {
    console.error(chalk.red(`${theme.icons.failure}  No package.json found in the current directory.`));
    process.exit(1);
  }

  console.log();
  console.log(theme.colors.primary.bold('  ▲ REVERA DEPENDENCY VERIFICATION'));
  console.log(theme.colors.muted('  ' + '─'.repeat(50)));

  let prodDirect: string[] = [];
  let devDirect: string[] = [];

  try {
    const pkgJson = JSON.parse(fs.readFileSync(projectPkgPath, 'utf-8'));
    prodDirect = Object.keys(pkgJson.dependencies || {});
    devDirect = options.prodOnly ? [] : Object.keys(pkgJson.devDependencies || {});
  } catch (err: any) {
    console.error(chalk.red(`  Failed to parse package.json: ${err.message}`));
    process.exit(1);
  }

  const directDeps = [...prodDirect, ...devDirect];
  if (directDeps.length === 0) {
    console.log(chalk.green(`\n  ${theme.icons.success}  No dependencies declared in package.json.`));
    return;
  }

  let dag: Map<string, DAGNode>;

  if (options.onlyModules) {
    dag = buildDAG(prodDirect, devDirect, nodeModulesDir);
    // Remove all transitive nodes and dependencies from direct nodes to make it direct-only
    const directNames = new Set([...prodDirect, ...devDirect]);
    for (const [name, node] of dag.entries()) {
      if (!directNames.has(name)) {
        dag.delete(name);
      } else {
        node.dependencies.clear();
        node.dependents.clear();
      }
    }
    console.log(chalk.gray(`  Scanning direct dependencies only (${directDeps.length} packages)\n`));
  } else {
    const spinner2 = ora({ text: '  Resolving dependency tree...', indent: 0 }).start();
    dag = buildDAG(prodDirect, devDirect, nodeModulesDir);
    const transCount = dag.size - directDeps.length;
    spinner2.succeed(
      chalk.gray(`  ${dag.size} packages resolved`) +
        chalk.dim(`  ·  ${directDeps.length} direct  ·  ${transCount} transitive`),
    );
    console.log();
  }

  const pkgEntries = [...dag.entries()];
  const total = pkgEntries.length;
  const results: ScanResult[] = [];
  const threads = options.threads || 1;

  const spinner = ora({ text: `  Scanning [0/${total}]`, indent: 0 }).start();

  let completed = 0;
  const queue = [...pkgEntries];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const [pkgName, node] = item;

      let installedVersion = node.version;

      try {
        const report = await analyzePackage(pkgName, { silent: true });
        node.intrinsicRisk = report.intrinsicRisk;
        node.tainted = report.tainted;
        node.credibleInterval = report.credibleInterval;
        node.report = report;
      } catch (err: any) {
        logger.warn(`Verification failed for "${pkgName}": ${err.message}`);
        node.intrinsicRisk = 1.0;
        node.tainted = true;
        node.credibleInterval = [1.0, 1.0];
        node.report = {
          packageName: pkgName,
          version: installedVersion,
          overallScore: 0,
          recommendation: 'Error',
          categoryScores: {
            maintenance: 0,
            stability: 0,
            security: 0,
            quality: 0,
            ecosystem: 0,
            documentation: 0,
            developerExperience: 0,
            publisherTrust: 0,
          },
          positiveSignals: [],
          negativeSignals: [`Check failed: ${err.message}`],
          warnings: [`Check failed: ${err.message}`],
          summary: `Check failed: ${err.message}`,
          trustIncident: null,
          typosquatWarning: null,
          intrinsicRisk: 1.0,
          effectiveRisk: 1.0,
          credibleInterval: [1.0, 1.0],
          tainted: true,
          blastRadius: 0,
        };
      }

      completed++;
      spinner.text = `  Scanning [${completed}/${total}]  ${chalk.gray(pkgName)}`;
    }
  }

  const workers = Array.from({ length: Math.min(threads, total) }, () => worker());
  await Promise.all(workers);

  spinner.succeed(chalk.gray(`  Scanned ${total} packages`));
  console.log();

  // Run Stage 3: Risk propagation
  propagateRisk(dag);

  // Map DAG nodes back to ScanResult format for printing
  for (const [pkgName, node] of dag.entries()) {
    const report = node.report;
    results.push({
      name: pkgName,
      installedVersion: node.version,
      score: report.overallScore,
      recommendation: report.recommendation,
      vulnerabilitiesCount: report.negativeSignals
        ? report.negativeSignals.filter((s: string) => s.includes('vulnerability')).length
        : 0,
      warnings: report.warnings ? report.warnings.filter((w: string) => w !== 'None') : [],
      isDirect: node.isDirect,
      isProd: node.isProd,
      dependents: node.dependents,
      depth: node.depth,
    });
  }

  const healthy = results.filter((r) => r.score >= config.minScoreThreshold && r.warnings.length === 0);
  const reviewed = results.filter((r) => r.score >= config.minScoreThreshold && r.warnings.length > 0);
  const failed = results.filter((r) => r.score < config.minScoreThreshold);
  const hasIssues = (r: ScanResult) => r.score < config.minScoreThreshold || r.warnings.length > 0;

  // Split calculations
  const prodPkgs = results.filter((r) => r.isProd);
  const devPkgs = results.filter((r) => !r.isProd);

  const calcWeightedScore = (pkgs: ScanResult[]) => {
    let sum = 0;
    let weight = 0;
    for (const r of pkgs) {
      const w = r.isDirect ? 2 : 1;
      sum += r.score * w;
      weight += w;
    }
    return weight > 0 ? Math.round(sum / weight) : 100;
  };

  const projectScore = calcWeightedScore(results);
  const prodScore = calcWeightedScore(prodPkgs);
  const devScore = calcWeightedScore(devPkgs);

  const projectScoreColor = theme.getScoreColor(projectScore);
  const prodScoreColor = theme.getScoreColor(prodScore);
  const devScoreColor = theme.getScoreColor(devScore);

  // ── Direct Dependencies ────────────────────────────────────────────────────
  const directResults = results.filter((r) => r.isDirect);
  if (directResults.length > 0) {
    console.log(`  ${chalk.white.bold('Direct Dependencies')}  ${chalk.dim(`${directResults.length} packages`)}`);
    console.log();
    for (const res of directResults) {
      printPackageRow(res, config);
    }
    console.log();
  }

  // ── Transitive Dependencies ────────────────────────────────────────────────
  const transitiveResults = results.filter((r) => !r.isDirect);
  if (transitiveResults.length > 0) {
    const transitiveHealthy = transitiveResults.filter((r) => !hasIssues(r));
    const transitiveIssues = transitiveResults.filter((r) => hasIssues(r));

    console.log(
      `  ${chalk.white.bold('Transitive Dependencies')}  ${chalk.dim(`${transitiveResults.length} packages`)}`,
    );
    console.log();

    if (transitiveHealthy.length > 0) {
      console.log(
        `  ${theme.colors.success(theme.icons.success)}  ${chalk.gray(`${transitiveHealthy.length} packages healthy`)}`,
      );
    }

    for (const res of transitiveIssues) {
      printPackageRow(res, config);
    }
    console.log();
  }

  // ── Largest Deductions Analysis ────────────────────────────────────────────
  const deductions: { reason: string; penalty: number }[] = [];

  const trustCount = results.filter((r) =>
    r.warnings.some(
      (w) =>
        w.toLowerCase().includes('trust') ||
        w.toLowerCase().includes('compromise') ||
        w.toLowerCase().includes('protestware'),
    ),
  ).length;
  if (trustCount > 0) {
    deductions.push({
      reason: `${trustCount} package${trustCount > 1 ? 's' : ''} with historical trust/security incidents`,
      penalty: trustCount * 3,
    });
  }

  const staleCount = results.filter((r) =>
    r.warnings.some((w) => w.toLowerCase().includes('last release') || w.toLowerCase().includes('updated in over')),
  ).length;
  if (staleCount > 0) {
    deductions.push({
      reason: `${staleCount} package${staleCount > 1 ? 's' : ''} lacking recent releases`,
      penalty: Math.min(10, Math.ceil(staleCount * 0.8)),
    });
  }

  const pre1Count = results.filter((r) =>
    r.warnings.some((w) => w.toLowerCase().includes('semver major') || w.toLowerCase().includes('pre-1.0')),
  ).length;
  if (pre1Count > 0) {
    deductions.push({
      reason: `${pre1Count} package${pre1Count > 1 ? 's' : ''} below major version 1.0`,
      penalty: Math.min(5, Math.ceil(pre1Count * 0.4)),
    });
  }

  const activeVulnCount = results.filter((r) => r.vulnerabilitiesCount > 0).length;
  if (activeVulnCount > 0) {
    deductions.push({
      reason: `${activeVulnCount} package${activeVulnCount > 1 ? 's' : ''} with active vulnerabilities`,
      penalty: activeVulnCount * 15,
    });
  }

  // Sort deductions largest first
  deductions.sort((a, b) => b.penalty - a.penalty);

  // ── Risk Distribution visual bar ───────────────────────────────────────────
  const healthyCount = healthy.length;
  const reviewCount = reviewed.length;
  const riskCount = failed.length;

  const barWidth = 35;
  const healthyBlocks = Math.round((healthyCount / total) * barWidth);
  const reviewBlocks = Math.round((reviewCount / total) * barWidth);
  const riskBlocks = Math.max(0, barWidth - healthyBlocks - reviewBlocks);

  const riskBar =
    theme.colors.success('█'.repeat(healthyBlocks)) +
    theme.colors.warning('█'.repeat(reviewBlocks)) +
    theme.colors.danger('█'.repeat(riskBlocks));

  // ── Project Health Summary ─────────────────────────────────────────────────
  console.log('  ' + chalk.white.bold('Project Health'));
  console.log('  ' + chalk.dim('─'.repeat(45)));
  console.log(`  Overall Health     ${projectScoreColor(`${projectScore}/100`)}`);
  console.log(
    `  Production Deps    ${chalk.white(prodPkgs.length.toString().padEnd(4))}  Score: ${prodScoreColor(`${prodScore}/100`)}`,
  );
  if (!options.prodOnly) {
    console.log(
      `  Development Deps   ${chalk.white(devPkgs.length.toString().padEnd(4))}  Score: ${devScoreColor(`${devScore}/100`)}`,
    );
  }
  console.log();

  // Deductions Block
  if (deductions.length > 0) {
    console.log(`  ${chalk.white.bold('Largest Deductions')}`);
    for (const d of deductions.slice(0, 3)) {
      console.log(`    ${chalk.red('-')} ${chalk.gray(d.reason)} ${chalk.red(`(-${d.penalty})`)}`);
    }
    console.log();
  }

  // Risk Distribution Block
  console.log(`  ${chalk.white.bold('Risk Distribution')}`);
  console.log(`    [${riskBar}]`);
  console.log(
    `    ${chalk.white(total)} packages  ·  ${theme.colors.success(healthyCount)} healthy  ·  ${theme.colors.warning(reviewCount)} review  ·  ${theme.colors.danger(riskCount)} risk`,
  );
  console.log();

  // Verdict
  if (failed.length > 0) {
    console.log(
      theme.colors.danger(
        `  ${theme.icons.failure}  ${failed.length} package${failed.length > 1 ? 's' : ''} failed reputation checks. Review before deploying.`,
      ),
    );
  } else if (reviewed.length > 0) {
    console.log(
      theme.colors.warning(`  ${theme.icons.warning}  All packages passed. ${reviewed.length} raised minor warnings.`),
    );
  } else {
    console.log(theme.colors.success(`  ${theme.icons.success}  All ${total} dependencies look healthy.`));
  }
  console.log();
}
