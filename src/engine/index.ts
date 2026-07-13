import ora from 'ora';
import { fetchRegistryData, fetchDownloadStats, parseGitHubUrl, hasDefinitelyTyped } from './npm.js';
import { fetchGitHubRepoData, fetchGitHubReadme } from './github.js';
import { checkVulnerabilities } from './vuln.js';
import { generateReport, ReputationReport } from './scoring.js';
import { checkPublisherTrust } from './trust.js';
import { checkTyposquatting } from './typosquat.js';
import * as logger from '../utils/logger.js';

export async function analyzePackage(
  packageName: string,
  options: { offline?: boolean; silent?: boolean } = {},
): Promise<ReputationReport> {
  const offline = !!options.offline;
  const silent = !!options.silent;

  const spinner = silent ? null : ora(`Analyzing npm package "${packageName}"...`).start();

  try {
    logger.info(`Starting analysis for package "${packageName}"`, { offline });

    // ── Wave 1: Registry metadata (must come first to get GitHub URL and version) ──
    if (spinner) spinner.text = `Fetching registry metadata for ${packageName}...`;
    const registryData = await fetchRegistryData(packageName, offline);

    const latestVersion = registryData['dist-tags']?.latest || Object.keys(registryData.versions).pop();
    if (!latestVersion) {
      throw new Error(`Package "${packageName}" contains no published versions.`);
    }

    const manifest = registryData.versions[latestVersion] || {};
    const hasNativeTypes =
      'types' in manifest ||
      'typings' in manifest ||
      packageName.startsWith('@types/') ||
      manifest.exports?.['.']?.types ||
      manifest.exports?.types;

    const githubInfo = parseGitHubUrl(registryData.repository?.url);

    // ── Wave 2: All independent fetches run in parallel ────────────────────────
    // downloads + GitHub repo + vuln check + types check all fire concurrently.
    // This collapses 5 sequential round trips (~5 × 300ms = 1.5s) into one wave.
    if (spinner) spinner.text = `Fetching stats, GitHub data, and vulnerabilities for ${packageName}...`;

    const [downloadStats, githubData, vulnerabilities, externalTypes] = await Promise.all([
      fetchDownloadStats(packageName, offline),

      githubInfo
        ? fetchGitHubRepoData(githubInfo.owner, githubInfo.repo, packageName, offline)
        : Promise.resolve(null),

      checkVulnerabilities(packageName, latestVersion, offline),

      hasNativeTypes ? Promise.resolve(false) : hasDefinitelyTyped(packageName, offline),
    ]);

    if (vulnerabilities.failedSources.length > 0) {
      logger.warn(`Vuln sources unavailable for ${packageName}: ${vulnerabilities.failedSources.join(', ')}`);
    }

    // README fetch: only needed in interactive mode (not benchmark silent mode)
    // and only when the npm registry didn't include one.
    if (!silent && githubInfo && githubData && (!registryData.readme || registryData.readme.trim() === '') && !offline) {
      const githubReadme = await fetchGitHubReadme(githubInfo.owner, githubInfo.repo, packageName, offline);
      if (githubReadme) {
        registryData.readme = githubReadme;
      }
    }

    // ── Wave 3: Synchronous checks (zero network cost) ─────────────────────────
    const trustResult = checkPublisherTrust(packageName);
    const typosquatResult = checkTyposquatting(packageName, downloadStats.downloads || 0);

    // ── Wave 4: Score and compile report ───────────────────────────────────────
    if (spinner) spinner.text = 'Computing package confidence report...';
    const report = generateReport(
      registryData,
      downloadStats,
      githubData,
      vulnerabilities,
      trustResult,
      typosquatResult,
      externalTypes,
    );

    if (spinner) spinner.succeed(`Successfully analyzed "${packageName}"`);

    logger.info(`Completed analysis for "${packageName}" with score ${report.overallScore}`);
    return report;
  } catch (err: any) {
    if (spinner) spinner.fail(`Failed analyzing "${packageName}"`);
    logger.error(`Error analyzing package "${packageName}": ${err.message}`, { stack: err.stack });
    throw err;
  }
}

export * from './dag.js';
export * from './propagation.js';
