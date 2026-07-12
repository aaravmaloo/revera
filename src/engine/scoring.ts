import semver from 'semver';
import { NpmRegistryData, NpmDownloadsData } from './npm.js';
import { GitHubRepoData } from './github.js';
import { Vulnerability, VulnResult } from './vuln.js';
import { TrustResult } from './trust.js';
import { TyposquatResult } from './typosquat.js';

export type Archetype = 'framework' | 'cli' | 'types-only' | 'utility';

export interface CategoryScores {
  maintenance: number;
  stability: number;
  security: number;
  quality: number;
  ecosystem: number;
  documentation: number;
  developerExperience: number;
  publisherTrust: number;
}

export interface CategoryPosterior {
  mean: number;
  variance: number;
  confidence: number;
  a: number;
  b: number;
}

export interface ReputationReport {
  packageName: string;
  version: string;
  overallScore: number;
  recommendation: string;
  categoryScores: CategoryScores;
  categoryPosteriors?: Record<keyof CategoryScores, CategoryPosterior>;
  positiveSignals: string[];
  negativeSignals: string[];
  warnings: string[];
  summary: string;
  trustIncident: TrustResult['incident'];
  typosquatWarning: TyposquatResult | null;

  // v2 architecture fields
  intrinsicRisk: number;
  effectiveRisk: number;
  credibleInterval: [number, number];
  tainted: boolean;
  blastRadius: number;
  worstSubpath?: string[];
  inheritedRisk?: number;
  evidence?: string;
}

interface BetaPrior {
  a: number;
  b: number;
}

// 8 categories: maintenance, stability, security, quality, ecosystem, documentation, developerExperience, publisherTrust
type Category = keyof CategoryScores;

const PRIORS: Record<Archetype, Record<Category, BetaPrior>> = {
  framework: {
    maintenance: { a: 3, b: 1 },
    stability: { a: 3.2, b: 0.8 },
    security: { a: 3.6, b: 0.4 },
    quality: { a: 3.2, b: 0.8 },
    ecosystem: { a: 3.2, b: 0.8 },
    documentation: { a: 3.2, b: 0.8 },
    developerExperience: { a: 3.2, b: 0.8 },
    publisherTrust: { a: 3.6, b: 0.4 },
  },
  cli: {
    maintenance: { a: 2.5, b: 1.5 },
    stability: { a: 3, b: 1 },
    security: { a: 3.2, b: 0.8 },
    quality: { a: 2.8, b: 1.2 },
    ecosystem: { a: 2.5, b: 1.5 },
    documentation: { a: 2.8, b: 1.2 },
    developerExperience: { a: 2.5, b: 1.5 },
    publisherTrust: { a: 3.6, b: 0.4 },
  },
  'types-only': {
    maintenance: { a: 2, b: 2 },
    stability: { a: 3.6, b: 0.4 },
    security: { a: 3.8, b: 0.2 },
    quality: { a: 3.2, b: 0.8 },
    ecosystem: { a: 2.8, b: 1.2 },
    documentation: { a: 2.5, b: 1.5 },
    developerExperience: { a: 3.6, b: 0.4 },
    publisherTrust: { a: 3.8, b: 0.2 },
  },
  utility: {
    maintenance: { a: 2, b: 2 },
    stability: { a: 3.2, b: 0.8 },
    security: { a: 3.6, b: 0.4 },
    quality: { a: 2.8, b: 1.2 },
    ecosystem: { a: 2.2, b: 1.8 },
    documentation: { a: 2.68, b: 1.32 },
    developerExperience: { a: 2.68, b: 1.32 },
    publisherTrust: { a: 3.6, b: 0.4 },
  },
};

const BASE_WEIGHTS: Record<Category, number> = {
  maintenance: 0.13,
  stability: 0.12,
  security: 0.2,
  quality: 0.13,
  ecosystem: 0.13,
  documentation: 0.09,
  developerExperience: 0.05,
  publisherTrust: 0.15,
};

export function detectArchetype(packageName: string, npmData: NpmRegistryData, latestVersion: string): Archetype {
  if (packageName.startsWith('@types/')) {
    return 'types-only';
  }
  const manifest = npmData.versions[latestVersion] || {};
  if (manifest.bin && Object.keys(manifest.bin).length > 0) {
    return 'cli';
  }

  const name = packageName.toLowerCase();
  const desc = (npmData.description || '').toLowerCase();
  if (
    name.includes('framework') ||
    desc.includes('framework') ||
    [
      'express',
      'koa',
      'fastify',
      'hapi',
      'react',
      'vue',
      'angular',
      'svelte',
      'solid-js',
      'next',
      'nuxt',
      'gatsby',
      'remix',
      'astro',
    ].includes(name)
  ) {
    return 'framework';
  }
  return 'utility';
}

function isCriticalCVE(vuln: Vulnerability): boolean {
  const v = vuln as any;
  if (v.severity) {
    for (const sev of v.severity) {
      if (sev.score) {
        const score = parseFloat(sev.score);
        if (!isNaN(score) && score >= 9.0) return true;
      }
    }
  }
  const dbSpecific = v.database_specific;
  if (dbSpecific) {
    if (dbSpecific.severity === 'CRITICAL' || dbSpecific.cvss?.score >= 9.0) return true;
  }
  const text = `${v.summary || ''} ${v.details || ''}`.toLowerCase();
  if (
    text.includes('critical') &&
    (text.includes('remote code execution') || text.includes('rce') || text.includes('prototype pollution'))
  ) {
    return true;
  }
  return false;
}

export function generateReport(
  npmData: NpmRegistryData,
  downloadsData: NpmDownloadsData,
  githubData: GitHubRepoData | null,
  vulnsOrResult: VulnResult | Vulnerability[],
  trustResult: TrustResult,
  typosquatResult: TyposquatResult,
  hasExternalTypes = false,
): ReputationReport {
  // Normalize vulnerabilities to VulnResult
  let vulnResult: VulnResult;
  if (Array.isArray(vulnsOrResult)) {
    vulnResult = {
      status: vulnsOrResult.length > 0 ? 'vulnerable' : 'clean',
      vulnerabilities: vulnsOrResult,
      sources: [],
      failedSources: [],
    };
  } else {
    vulnResult = vulnsOrResult;
  }

  const latestVersion = npmData['dist-tags']?.latest || Object.keys(npmData.versions).pop() || '1.0.0';
  const manifest = npmData.versions[latestVersion] || {};
  const weeklyDownloads = downloadsData.downloads || 0;
  const timeEntries = npmData.time || {};
  const latestPublishTime = timeEntries[latestVersion] ? new Date(timeEntries[latestVersion]) : null;
  const now = new Date();

  // Archetype selection
  const archetype = detectArchetype(npmData.name, npmData, latestVersion);

  // Check for critical Veto conditions
  let vetoed = false;
  let vetoEvidence = '';
  let criticalVuln: Vulnerability | undefined;

  if (trustResult.incident && trustResult.incident.severity === 'critical') {
    vetoed = true;
    vetoEvidence = `Critical trust incident: ${trustResult.incident.summary}`;
  } else if (typosquatResult.isSuspicious && typosquatResult.distance <= 1) {
    vetoed = true;
    vetoEvidence = `Suspicious typosquatting: closely resembles "${typosquatResult.similarTo}" with edit distance ${typosquatResult.distance}`;
  } else if (vulnResult.status === 'vulnerable') {
    criticalVuln = vulnResult.vulnerabilities.find(isCriticalCVE);
    if (criticalVuln) {
      vetoed = true;
      vetoEvidence = `Unpatched critical CVE: ${criticalVuln.id} (${criticalVuln.summary || 'Critical vulnerability'})`;
    }
  }

  // Define positive/negative signal lists for backward compatibility UI
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  const warnings: string[] = [];

  // Populate signals for user display and validation tests
  let isMatureAndStable = false;
  const createdTimeStr = timeEntries.created;
  const ageYears = createdTimeStr
    ? (now.getTime() - new Date(createdTimeStr).getTime()) / (1000 * 60 * 60 * 24 * 365)
    : 1.0;

  if (latestPublishTime) {
    const daysSinceRelease = (now.getTime() - latestPublishTime.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceRelease >= 365 && weeklyDownloads > 100_000 && vulnResult.vulnerabilities.length === 0) {
      isMatureAndStable = true;
    }

    if (daysSinceRelease < 30) {
      positiveSignals.push('Frequent releases');
    } else if (daysSinceRelease < 90) {
      positiveSignals.push('Recent release');
    } else if (daysSinceRelease < 365) {
      if (daysSinceRelease >= 180) {
        negativeSignals.push('Slow release cycle');
      }
    } else if (isMatureAndStable) {
      positiveSignals.push('Stable and mature package footprint');
    } else {
      const monthsAgo = Math.round(daysSinceRelease / 30);
      negativeSignals.push(`Last release was ${monthsAgo} months ago`);
      warnings.push(
        `Last release: ${monthsAgo} months ago. No recent updates detected. This may be normal for mature, stable libraries.`,
      );
    }
  }

  if (githubData) {
    if (githubData.commitsInLast90Days >= 30) {
      positiveSignals.push('Very active development');
    } else if (githubData.commitsInLast90Days >= 10) {
      positiveSignals.push('Active development');
    } else if (githubData.commitsInLast90Days < 1 && !isMatureAndStable) {
      negativeSignals.push('No recent commit activity (last 90 days)');
    }

    if (githubData.stars > 0) {
      const issueRatio = githubData.openIssues / githubData.stars;
      if (issueRatio < 0.05) {
        positiveSignals.push('Responsive issue management');
      } else if (issueRatio >= 0.3) {
        negativeSignals.push('High open-issues ratio');
      }
    }
    if (githubData.archived) {
      negativeSignals.push('Archived repository');
      warnings.push('The GitHub repository for this package is archived.');
    }
  } else {
    const releaseCount180Days = Object.values(timeEntries).filter((timeStr) => {
      const pTime = new Date(timeStr);
      return now.getTime() - pTime.getTime() < 180 * 24 * 60 * 60 * 1000;
    }).length;
    if (releaseCount180Days >= 5) {
      positiveSignals.push('Frequent version publications');
    }
  }

  const maintainersCount = npmData.maintainers?.length || 1;
  if (maintainersCount >= 3 || weeklyDownloads > 1000000) {
    positiveSignals.push('Multiple active maintainers or corporate backed');
  } else if (maintainersCount === 1) {
    negativeSignals.push('Single maintainer (bus factor of 1)');
  }

  if (semver.valid(latestVersion) === null) {
    negativeSignals.push('Non-standard version format');
  }

  const isZeroVer = latestVersion.startsWith('0.');
  if (!isZeroVer) {
    positiveSignals.push('Stable API (v1.0.0+)');
  } else {
    if (weeklyDownloads < 100_000) {
      warnings.push(
        "SemVer major version is below 1.0. API stability may vary depending on the project's release practices.",
      );
    } else {
      negativeSignals.push('SemVer major version is below 1.0 (pre-release)');
    }
  }

  const allVersions = Object.keys(npmData.versions).filter((v) => semver.valid(v));
  const majorVersions = new Set(allVersions.map((v) => semver.major(v)));
  const majorRate = ageYears > 0 ? majorVersions.size / ageYears : 1;
  if (majorRate < 1.5) {
    positiveSignals.push('Low API volatility');
  } else if (majorRate >= 5.0) {
    negativeSignals.push('Extremely volatile release history');
  } else if (majorRate >= 3.0) {
    negativeSignals.push('Frequent major breaking releases');
  }

  if (vulnResult.status === 'clean') {
    positiveSignals.push('Zero known vulnerabilities');
  } else if (vulnResult.status === 'vulnerable') {
    const vc = vulnResult.vulnerabilities.length;
    negativeSignals.push(`${vc} active vulnerability advisories`);
    warnings.push(`Vulnerabilities detected: ${vulnResult.vulnerabilities.map((v) => v.id).join(', ')}`);
  }

  const scripts = manifest.scripts || {};
  const hasInstallScripts = 'preinstall' in scripts || 'install' in scripts || 'postinstall' in scripts;
  if (hasInstallScripts) {
    negativeSignals.push('Contains install scripts');
    warnings.push('Package runs scripts during installation (potential security risk).');
  }

  if (!npmData.repository) {
    negativeSignals.push('Missing repository field in package manifest');
  }

  const readmeLength = npmData.readme?.length || 0;
  const readmeFilename = npmData.readmeFilename || '';
  if (readmeLength > 5000) {
    positiveSignals.push('Highly detailed documentation');
  } else if (readmeLength <= 100 && !readmeFilename) {
    negativeSignals.push('Short or missing README');
  }

  const licenseName = (npmData.license || manifest.license || '').toUpperCase();
  const permissiveLicenses = ['MIT', 'APACHE-2.0', 'BSD-3-CLAUSE', 'BSD-2-CLAUSE', 'ISC', 'UNLICENSE'];
  const restrictiveLicenses = ['GPL', 'AGPL', 'LGPL', 'MPL'];
  let licenseValid = false;
  for (const perm of permissiveLicenses) {
    if (licenseName.includes(perm)) {
      positiveSignals.push('Permissive open-source license');
      licenseValid = true;
      break;
    }
  }
  if (!licenseValid) {
    let restrictive = false;
    for (const rest of restrictiveLicenses) {
      if (licenseName.includes(rest)) {
        negativeSignals.push(`Copyleft/Restrictive license (${licenseName})`);
        restrictive = true;
        break;
      }
    }
    if (!restrictive && !licenseName) {
      negativeSignals.push('Unlicensed or missing license specifications');
      warnings.push('No open-source license detected.');
    }
  }

  const hasTestScript = 'test' in scripts;
  const readmeContent = npmData.readme || '';
  const hasCIBadge =
    /github\/workflow/i.test(readmeContent) ||
    /actions\/workflows/i.test(readmeContent) ||
    /travis-ci/i.test(readmeContent) ||
    /circleci/i.test(readmeContent);
  if (hasTestScript || hasCIBadge) {
    positiveSignals.push('Tests or CI configured');
  } else {
    negativeSignals.push('No tests or CI scripts specified');
  }

  const hasTypes =
    'types' in manifest ||
    'typings' in manifest ||
    npmData.name.startsWith('@types/') ||
    manifest.exports?.['.']?.types ||
    manifest.exports?.types ||
    hasExternalTypes;

  if (hasTypes) {
    if (hasExternalTypes && !('types' in manifest || 'typings' in manifest)) {
      positiveSignals.push('TypeScript support (via DefinitelyTyped)');
    } else {
      positiveSignals.push('First-class TypeScript support');
    }
  } else {
    negativeSignals.push('Missing native type definitions');
  }

  const isCli = 'bin' in manifest;
  const isEsm = manifest.type === 'module' || 'exports' in manifest || manifest.module;
  if (isEsm) {
    positiveSignals.push('Modern ES module (ESM) support');
  } else if (isCli) {
    positiveSignals.push('CLI executable tool');
  } else {
    negativeSignals.push('Legacy CommonJS only');
  }

  if (weeklyDownloads > 10000000) {
    positiveSignals.push('Huge ecosystem footprint (>10M weekly downloads)');
  } else if (weeklyDownloads > 1000000) {
    positiveSignals.push('Very popular (>1M weekly downloads)');
  } else if (weeklyDownloads > 100000) {
    positiveSignals.push('Mainstream adoption (>100k weekly downloads)');
  } else if (weeklyDownloads < 1000) {
    negativeSignals.push('Low package adoption (<1k weekly downloads)');
  }

  if (githubData) {
    if (githubData.stars > 25000) {
      positiveSignals.push('Extremely high star count (>25k stars)');
    } else if (githubData.stars > 5000) {
      positiveSignals.push('Highly starred (>5k stars)');
    } else if (githubData.stars > 1000) {
      positiveSignals.push('Healthy community interest (>1k stars)');
    }

    if (githubData.contributorsCount > 100) {
      positiveSignals.push('Large contributor base (>100 contributors)');
    } else if (githubData.contributorsCount > 20) {
      positiveSignals.push('Collaborative development');
    } else if (githubData.contributorsCount <= 5) {
      negativeSignals.push('Very few unique contributors');
    }
  }

  const hasExamples =
    /```(javascript|typescript|js|ts|bash|sh)/.test(readmeContent) ||
    /example|tutorial|getting started/i.test(readmeContent);
  if (hasExamples) {
    positiveSignals.push('Code examples in README');
  } else if (readmeContent.trim().length > 0) {
    negativeSignals.push('No code examples in README');
  }

  const hasApiDocs =
    /api reference|api doc|options|configuration|props|methods|exported/i.test(readmeContent) ||
    /documentation/i.test(readmeContent);
  if (hasApiDocs) {
    positiveSignals.push('Structured API documentation');
  } else if (readmeContent.trim().length > 0) {
    negativeSignals.push('No explicit API reference in README');
  }

  if (readmeContent.trim().length > 0 && readmeLength <= 1000) {
    negativeSignals.push('Short documentation details');
  }

  const sideEffects = manifest.sideEffects;
  if (sideEffects === false || isCli) {
    if (!isCli) positiveSignals.push('Side-effect free (excellent tree shaking)');
  } else if (!(Array.isArray(sideEffects) && sideEffects.length === 0)) {
    if (!isCli) negativeSignals.push('Potential side-effects (compromises tree shaking)');
  }

  if (trustResult.incident) {
    negativeSignals.push(`${trustResult.incident.summary}`);
    warnings.push(`Publisher trust incident (${trustResult.incident.year}): ${trustResult.incident.detail}`);
    if (trustResult.incident.severity === 'critical') {
      negativeSignals.push('Critical trust incident — evaluate alternatives carefully');
    }
  } else {
    positiveSignals.push('No known publisher trust incidents');
  }

  // ── Bayesian updates ───────────────────────────────────────────────────────
  // Calculate context weight w
  const logDownloads = Math.log10(Math.max(1, weeklyDownloads));
  const logDownloadsFactor = Math.max(0.1, Math.min(2.0, logDownloads / 5));
  const ageFactor = Math.max(0.5, Math.min(1.5, ageYears / 2));
  let ecosystemFactor = 1.0;
  if (githubData) {
    const stars = githubData.stars || 0;
    const logStars = Math.log10(Math.max(1, stars));
    ecosystemFactor = Math.max(0.8, Math.min(1.3, logStars / 3));
  }
  const w = logDownloadsFactor * ageFactor * ecosystemFactor;

  // Archetype-specific priors
  const priors = PRIORS[archetype];

  // Collect category signals
  const categorySignals: Record<Category, Array<{ strength: number; weight?: number; unverifiable?: boolean }>> = {
    maintenance: [
      {
        strength: !latestPublishTime
          ? 0.1
          : (now.getTime() - latestPublishTime.getTime()) / (1000 * 60 * 60 * 24) < 30
            ? 1.0
            : (now.getTime() - latestPublishTime.getTime()) / (1000 * 60 * 60 * 24) < 90
              ? 0.9
              : (now.getTime() - latestPublishTime.getTime()) / (1000 * 60 * 60 * 24) < 180
                ? 0.7
                : (now.getTime() - latestPublishTime.getTime()) / (1000 * 60 * 60 * 24) < 365
                  ? 0.4
                  : isMatureAndStable
                    ? 0.8
                    : 0.1,
        unverifiable: !latestPublishTime,
      },
      {
        strength: githubData
          ? githubData.commitsInLast90Days >= 30
            ? 1.0
            : githubData.commitsInLast90Days >= 10
              ? 0.8
              : githubData.commitsInLast90Days >= 1
                ? 0.5
                : 0.1
          : Object.values(timeEntries).filter(
                (timeStr) => now.getTime() - new Date(timeStr).getTime() < 180 * 24 * 60 * 60 * 1000,
              ).length >= 5
            ? 1.0
            : Object.values(timeEntries).filter(
                  (timeStr) => now.getTime() - new Date(timeStr).getTime() < 180 * 24 * 60 * 60 * 1000,
                ).length >= 2
              ? 0.7
              : Object.values(timeEntries).filter(
                    (timeStr) => now.getTime() - new Date(timeStr).getTime() < 180 * 24 * 60 * 60 * 1000,
                  ).length >= 1
                ? 0.4
                : 0.1,
      },
      {
        strength: githubData
          ? githubData.stars > 0
            ? githubData.openIssues / githubData.stars < 0.05
              ? 1.0
              : githubData.openIssues / githubData.stars < 0.15
                ? 0.8
                : githubData.openIssues / githubData.stars < 0.3
                  ? 0.5
                  : 0.2
            : 0.7
          : 0.7,
        unverifiable: !githubData,
      },
      {
        strength:
          maintainersCount >= 3 || weeklyDownloads > 1000000
            ? 1.0
            : maintainersCount === 2 || weeklyDownloads > 100000
              ? 0.8
              : 0.3,
      },
      {
        strength: githubData ? (githubData.archived ? 0.0 : 1.0) : 1.0,
        weight: 2.0,
        unverifiable: !githubData,
      },
    ],
    stability: [
      { strength: semver.valid(latestVersion) !== null ? 1.0 : 0.0 },
      { strength: isZeroVer ? (weeklyDownloads > 100000 ? 0.8 : 0.5) : 1.0 },
      {
        strength: majorRate < 1.5 ? 1.0 : majorRate < 3.0 ? 0.8 : majorRate < 5.0 ? 0.5 : 0.1,
      },
    ],
    security: [
      {
        strength: vulnResult.status === 'clean' ? 1.0 : 0.0,
        weight: vulnResult.status === 'vulnerable' ? 6.0 * vulnResult.vulnerabilities.length : 1.0,
        unverifiable: vulnResult.status === 'unknown',
      },
      { strength: hasInstallScripts ? 0.2 : 1.0 },
      { strength: npmData.repository ? 1.0 : 0.5 },
    ],
    quality: [
      {
        strength: readmeLength > 5000 ? 1.0 : readmeLength > 1000 ? 0.8 : readmeLength > 100 ? 0.4 : 0.1,
        unverifiable: !npmData.readme,
      },
      {
        strength: licenseValid ? 1.0 : npmData.license || manifest.license ? 0.5 : 0.1,
      },
      { strength: hasTestScript || hasCIBadge ? 1.0 : 0.3 },
      { strength: hasTypes ? 1.0 : 0.4 },
      { strength: isEsm || isCli ? 1.0 : 0.5 },
    ],
    ecosystem: [
      {
        strength:
          weeklyDownloads > 10000000
            ? 1.0
            : weeklyDownloads > 1000000
              ? 0.9
              : weeklyDownloads > 100000
                ? 0.8
                : weeklyDownloads > 10000
                  ? 0.6
                  : weeklyDownloads > 1000
                    ? 0.4
                    : 0.1,
      },
      {
        strength: githubData
          ? githubData.stars > 25000
            ? 1.0
            : githubData.stars > 5000
              ? 0.9
              : githubData.stars > 1000
                ? 0.7
                : githubData.stars > 100
                  ? 0.4
                  : 0.2
          : 0.5,
        unverifiable: !githubData,
      },
      {
        strength: githubData
          ? githubData.contributorsCount > 100
            ? 1.0
            : githubData.contributorsCount > 20
              ? 0.8
              : githubData.contributorsCount > 5
                ? 0.5
                : 0.2
          : 0.5,
        unverifiable: !githubData,
      },
    ],
    documentation: [
      {
        strength: hasExamples ? 1.0 : 0.2,
        unverifiable: !npmData.readme || npmData.readme.trim().length === 0,
      },
      {
        strength: hasApiDocs ? 1.0 : 0.2,
        unverifiable: !npmData.readme || npmData.readme.trim().length === 0,
      },
      {
        strength: readmeLength > 3000 ? 1.0 : readmeLength > 1000 ? 0.7 : 0.3,
        unverifiable: !npmData.readme || npmData.readme.trim().length === 0,
      },
      {
        strength:
          weeklyDownloads > 10000000
            ? 0.9
            : weeklyDownloads > 1000000
              ? 0.75
              : weeklyDownloads > 100000
                ? 0.55
                : readmeFilename
                  ? 0.4
                  : 0.1,
        unverifiable: !!npmData.readme && npmData.readme.trim().length > 0,
      },
    ],
    developerExperience: [
      { strength: hasTypes ? 1.0 : 0.2 },
      {
        strength:
          sideEffects === false || isCli || (Array.isArray(sideEffects) && sideEffects.length === 0) ? 1.0 : 0.5,
      },
      { strength: isEsm || isCli ? 1.0 : 0.3 },
    ],
    publisherTrust: [
      { strength: trustResult.incident ? Math.max(0.0, 1.0 - trustResult.incident.penalty / 100) : 1.0 },
    ],
  };

  const categoryPosteriors: Record<Category, CategoryPosterior> = {} as any;
  const categoryScores: CategoryScores = {} as any;

  // Perform Beta updates for all categories
  for (const cat of Object.keys(BASE_WEIGHTS) as Category[]) {
    const prior = priors[cat];
    let a = prior.a;
    let b = prior.b;

    for (const sig of categorySignals[cat]) {
      if (sig.unverifiable) {
        continue;
      }
      const sigW = sig.weight ?? 1.0;
      a += w * sigW * sig.strength;
      b += w * sigW * (1 - sig.strength);
    }

    const mean = a / (a + b);
    const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
    const confidence = 1 / Math.max(1e-6, variance);

    categoryPosteriors[cat] = { mean, variance, confidence, a, b };
    categoryScores[cat] = Math.round(mean * 100);
  }

  // ── Confidence-weighted aggregation ────────────────────────────────────────
  let totalWeight = 0;
  let weightedMeanSum = 0;
  let weightedVarSum = 0;

  for (const cat of Object.keys(BASE_WEIGHTS) as Category[]) {
    const post = categoryPosteriors[cat];
    const baseW = BASE_WEIGHTS[cat];
    const weight = baseW * post.confidence;

    totalWeight += weight;
    weightedMeanSum += post.mean * weight;
    weightedVarSum += post.variance * weight;
  }

  const mu_intrinsic = totalWeight > 0 ? weightedMeanSum / totalWeight : 0.5;
  const weighted_variance = totalWeight > 0 ? weightedVarSum / totalWeight : 0.083;

  let intrinsicRisk = 1 - mu_intrinsic;
  let tainted = false;

  const lowBound = Math.max(0, mu_intrinsic - 1.96 * Math.sqrt(weighted_variance));
  const highBound = Math.min(1, mu_intrinsic + 1.96 * Math.sqrt(weighted_variance));
  const credibleInterval: [number, number] = [lowBound, highBound];

  if (vetoed) {
    intrinsicRisk = 0.97;
    tainted = true;
  }

  const effectiveRisk = intrinsicRisk;
  let overallScore = Math.round(100 * (1 - effectiveRisk));

  // Floor rating penalties
  if (!vetoed) {
    if (vulnResult.vulnerabilities.length > 0) {
      overallScore = Math.max(0, overallScore - 30);
    }
    if (githubData?.archived) {
      overallScore = Math.max(0, overallScore - 40);
    }
  }

  // Recommendation thresholds
  let recommendation = 'Not Recommended';
  if (tainted) {
    recommendation = overallScore >= 70 ? 'Use With Caution' : 'Not Recommended';
  } else {
    if (overallScore >= 90) recommendation = 'Highly Recommended';
    else if (overallScore >= 75) recommendation = 'Recommended';
    else if (overallScore >= 50) recommendation = 'Caution';
  }

  // Summary
  let summary = '';
  const nameCapitalized = npmData.name.charAt(0).toUpperCase() + npmData.name.slice(1);

  if (trustResult.incident) {
    const inc = trustResult.incident;
    const technical =
      overallScore >= 80
        ? `${nameCapitalized} is technically mature and has no known active vulnerabilities.`
        : overallScore >= 60
          ? `${nameCapitalized} is a functional package with some maintenance concerns.`
          : `${nameCapitalized} has notable technical shortcomings in addition to its trust history.`;

    const trustConcern =
      inc.severity === 'critical'
        ? `However, the publisher's ${inc.year} incident significantly reduced trust. Consider alternatives unless you specifically require this package.`
        : `However, a ${inc.year} publisher trust incident reduced confidence in this maintainer. Evaluate whether alternatives exist for your use case.`;

    summary = `${technical} ${trustConcern}`;
  } else if (vetoed && criticalVuln) {
    summary = `${nameCapitalized} contains a critical vulnerability ${criticalVuln.id}: ${criticalVuln.summary || 'Critical vulnerability'}. Revera strongly recommends against installing this version.`;
  } else if (vetoed && typosquatResult.isSuspicious) {
    summary = `${nameCapitalized} is a suspected typosquat of "${typosquatResult.similarTo}". Revera recommends against installing it.`;
  } else if (overallScore >= 90) {
    summary = `${nameCapitalized} is one of the highest-confidence packages available on npm. It is active, stable, and secure. Revera recommends installing it.`;
  } else if (overallScore >= 75) {
    summary = `${nameCapitalized} is a reliable and well-maintained package. Revera recommends installing it for general use.`;
  } else if (overallScore >= 50) {
    summary = `${nameCapitalized} has a moderate confidence rating. Review warning signs before using it in critical production projects.`;
  } else {
    summary = `${nameCapitalized} has low confidence. Revera recommends looking for alternatives due to security, activity, or stability concerns.`;
  }

  const uniquePositives = [...new Set(positiveSignals)].slice(0, 10);
  const uniqueNegatives = [...new Set(negativeSignals)].slice(0, 10);
  const uniqueWarnings = [...new Set(warnings)].slice(0, 10);

  return {
    packageName: npmData.name,
    version: latestVersion,
    overallScore,
    recommendation,
    categoryScores,
    categoryPosteriors,
    positiveSignals: uniquePositives,
    negativeSignals: uniqueNegatives,
    warnings: uniqueWarnings.length > 0 ? uniqueWarnings : ['None'],
    summary,
    trustIncident: trustResult.incident,
    typosquatWarning: typosquatResult.isSuspicious ? typosquatResult : null,

    // v2 fields
    intrinsicRisk,
    effectiveRisk,
    credibleInterval,
    tainted,
    blastRadius: 0,
    evidence: vetoEvidence || undefined,
  };
}
