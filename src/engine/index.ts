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
  options: { offline?: boolean; silent?: boolean } = {}
): Promise<ReputationReport> {
  const offline = !!options.offline;
  const silent = !!options.silent;

  const spinner = silent ? null : ora(`Analyzing npm package "${packageName}"...`).start();

  try {
    logger.info(`Starting analysis for package "${packageName}"`, { offline });

    // Step 1: Fetch NPM Registry metadata
    if (spinner) spinner.text = `Fetching registry metadata for ${packageName}...`;
    const registryData = await fetchRegistryData(packageName, offline);

    const latestVersion = registryData['dist-tags']?.latest || Object.keys(registryData.versions).pop();
    if (!latestVersion) {
      throw new Error(`Package "${packageName}" contains no published versions.`);
    }

    // Check if package has external TypeScript declarations (DefinitelyTyped)
    const manifest = registryData.versions[latestVersion] || {};
    const hasNativeTypes =
      'types' in manifest ||
      'typings' in manifest ||
      packageName.startsWith('@types/') ||
      manifest.exports?.['.']?.types ||
      manifest.exports?.types;

    let externalTypes = false;
    if (!hasNativeTypes) {
      if (spinner) spinner.text = `Checking TypeScript typing support for ${packageName}...`;
      externalTypes = await hasDefinitelyTyped(packageName, offline);
    }

    // Step 2: Fetch weekly download counts
    if (spinner) spinner.text = `Fetching download stats for ${packageName}...`;
    const downloadStats = await fetchDownloadStats(packageName, offline);

    // Step 3: Fetch GitHub repository stats if available
    let githubData = null;
    const githubInfo = parseGitHubUrl(registryData.repository?.url);
    if (githubInfo) {
      if (spinner) spinner.text = `Querying GitHub repository ${githubInfo.owner}/${githubInfo.repo}...`;
      githubData = await fetchGitHubRepoData(githubInfo.owner, githubInfo.repo, packageName, offline);

      // Step 3.5: Fetch README from GitHub if missing in Registry
      if ((!registryData.readme || registryData.readme.trim() === '') && !offline) {
        if (spinner) spinner.text = `Fetching README from GitHub repo...`;
        const githubReadme = await fetchGitHubReadme(githubInfo.owner, githubInfo.repo, packageName, offline);
        if (githubReadme) {
          registryData.readme = githubReadme;
        }
      }
    } else {
      logger.info(`No GitHub repository found in manifest for ${packageName}`);
    }

    // Step 4: Check OSV vulnerabilities
    if (spinner) spinner.text = `Checking vulnerabilities for ${packageName}@${latestVersion}...`;
    const vulnerabilities = await checkVulnerabilities(packageName, latestVersion, offline);

    // Step 5: Publisher trust and typosquat checks (synchronous, no network)
    const trustResult = checkPublisherTrust(packageName);
    const typosquatResult = checkTyposquatting(packageName, downloadStats.downloads || 0);

    // Step 6: Score package and compile report
    if (spinner) spinner.text = 'Computing package confidence report...';
    const report = generateReport(registryData, downloadStats, githubData, vulnerabilities, trustResult, typosquatResult, externalTypes);

    if (spinner) {
      spinner.succeed(`Successfully analyzed "${packageName}"`);
    }

    logger.info(`Completed analysis for "${packageName}" with score ${report.overallScore}`);
    return report;
  } catch (err: any) {
    if (spinner) {
      spinner.fail(`Failed analyzing "${packageName}"`);
    }
    logger.error(`Error analyzing package "${packageName}": ${err.message}`, { stack: err.stack });
    throw err;
  }
}
