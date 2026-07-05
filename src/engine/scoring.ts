import semver from 'semver';
import { NpmRegistryData, NpmDownloadsData } from './npm.js';
import { GitHubRepoData } from './github.js';
import { Vulnerability } from './vuln.js';
import { TrustResult } from './trust.js';
import { TyposquatResult } from './typosquat.js';

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

export interface ReputationReport {
  packageName: string;
  version: string;
  overallScore: number;
  recommendation: string;
  categoryScores: CategoryScores;
  positiveSignals: string[];
  negativeSignals: string[];
  warnings: string[];
  summary: string;
  trustIncident: TrustResult['incident'];
  typosquatWarning: TyposquatResult | null;
}

export function generateReport(
  npmData: NpmRegistryData,
  downloadsData: NpmDownloadsData,
  githubData: GitHubRepoData | null,
  vulns: Vulnerability[],
  trustResult: TrustResult,
  typosquatResult: TyposquatResult,
  hasExternalTypes = false
): ReputationReport {
  const latestVersion = npmData['dist-tags']?.latest || Object.keys(npmData.versions).pop() || '1.0.0';
  const manifest = npmData.versions[latestVersion] || {};
  const weeklyDownloads = downloadsData.downloads || 0;

  // ── @types/* fast-path ─────────────────────────────────────────────────────
  // DefinitelyTyped packages follow a completely different lifecycle. They are
  // community-maintained type stubs, not runtime libraries, so standard
  // maintenance/stability/ecosystem signals don't apply.
  if (npmData.name.startsWith('@types/')) {
    const hasVulns = vulns.length > 0;
    const score = hasVulns ? 50 : 88;
    const rec = score >= 75 ? 'Recommended' : 'Caution';
    return {
      packageName: npmData.name,
      version: latestVersion,
      overallScore: score,
      recommendation: rec,
      categoryScores: {
        maintenance: 80,
        stability: 90,
        security: hasVulns ? 50 : 100,
        quality: 85,
        ecosystem: 90,
        documentation: 85,
        developerExperience: 100,
        publisherTrust: 100,
      },
      positiveSignals: [
        'Community-maintained TypeScript declaration package',
        'Part of the DefinitelyTyped ecosystem',
        'First-class TypeScript support',
      ],
      negativeSignals: hasVulns ? [`${vulns.length} active vulnerability advisories`] : [],
      warnings: hasVulns
        ? [`Vulnerabilities detected: ${vulns.map(v => v.id).join(', ')}`]
        : ['None'],
      summary: `${npmData.name} is a DefinitelyTyped declaration package. It provides TypeScript types and is generally safe to install alongside the corresponding runtime library.`,
      trustIncident: null,
      typosquatWarning: null,
    };
  }

  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  const warnings: string[] = [];

  // 1. Maintenance Score (0-100)
  let maintenance = 0;
  const timeEntries = npmData.time || {};
  const latestPublishTime = timeEntries[latestVersion] ? new Date(timeEntries[latestVersion]) : null;
  const now = new Date();

  let isMatureAndStable = false;

  // Last release timing (Max 30)
  if (latestPublishTime) {
    const msSinceRelease = now.getTime() - latestPublishTime.getTime();
    const daysSinceRelease = msSinceRelease / (1000 * 60 * 60 * 24);

    // Check if the package is a mature, high-adoption "done" utility
    if (daysSinceRelease >= 365 && weeklyDownloads > 100_000 && vulns.length === 0) {
      isMatureAndStable = true;
    }

    if (daysSinceRelease < 30) {
      maintenance += 30;
      positiveSignals.push('Frequent releases');
    } else if (daysSinceRelease < 90) {
      maintenance += 25;
      positiveSignals.push('Recent release');
    } else if (daysSinceRelease < 180) {
      maintenance += 20;
    } else if (daysSinceRelease < 365) {
      maintenance += 10;
      negativeSignals.push('Slow release cycle');
    } else if (isMatureAndStable) {
      const bonus = weeklyDownloads > 1_000_000 ? 25 : 20;
      maintenance += bonus;
      positiveSignals.push('Stable and mature package footprint');
    } else {
      maintenance += 0;
      const monthsAgo = Math.round(daysSinceRelease / 30);
      negativeSignals.push(`Last release was ${monthsAgo} months ago`);
      warnings.push(`Last release: ${monthsAgo} months ago. No recent updates detected. This may be normal for mature, stable libraries.`);
    }
  } else {
    maintenance += 15;
  }

  // Commit activity or publish frequency (Max 30)
  if (githubData) {
    if (githubData.commitsInLast90Days >= 30) {
      maintenance += 30;
      positiveSignals.push('Very active development');
    } else if (githubData.commitsInLast90Days >= 10) {
      maintenance += 20;
      positiveSignals.push('Active development');
    } else if (githubData.commitsInLast90Days >= 1) {
      maintenance += 10;
    } else if (isMatureAndStable) {
      maintenance += 20;
    } else {
      negativeSignals.push('No recent commit activity (last 90 days)');
    }
  } else {
    // Fallback: NPM release frequency (count versions in last 180 days)
    const releaseCount180Days = Object.values(timeEntries).filter(timeStr => {
      const pTime = new Date(timeStr);
      return now.getTime() - pTime.getTime() < 180 * 24 * 60 * 60 * 1000;
    }).length;

    if (releaseCount180Days >= 5) {
      maintenance += 30;
      positiveSignals.push('Frequent version publications');
    } else if (releaseCount180Days >= 2) {
      maintenance += 20;
    } else if (releaseCount180Days >= 1) {
      maintenance += 10;
    } else if (isMatureAndStable) {
      maintenance += 20;
    }
  }

  // Issue responsiveness (Max 20)
  if (githubData) {
    if (githubData.stars > 0) {
      const issueRatio = githubData.openIssues / githubData.stars;
      if (issueRatio < 0.05) {
        maintenance += 20;
        positiveSignals.push('Responsive issue management');
      } else if (issueRatio < 0.15) {
        maintenance += 15;
      } else if (issueRatio < 0.3) {
        maintenance += 10;
      } else {
        maintenance += 5;
        negativeSignals.push('High open-issues ratio');
      }
    } else {
      maintenance += 15;
    }
  } else {
    // If downloads are high, assume active issue handling
    maintenance += weeklyDownloads > 1000000 ? 20 : 15;
  }

  // Maintainer count (Max 20)
  const maintainersCount = npmData.maintainers?.length || 1;
  if (maintainersCount >= 3 || weeklyDownloads > 1000000) {
    maintenance += 20;
    positiveSignals.push('Multiple active maintainers or corporate backed');
  } else if (maintainersCount === 2 || weeklyDownloads > 100000) {
    maintenance += 15;
  } else {
    maintenance += 5;
    negativeSignals.push('Single maintainer (bus factor of 1)');
  }

  // Archive status check (GitHub)
  if (githubData?.archived) {
    maintenance = 0;
    negativeSignals.push('Archived repository');
    warnings.push('The GitHub repository for this package is archived.');
  }

  // Ensure bounded
  maintenance = Math.min(100, Math.max(0, maintenance));

  // 2. Stability Score (0-100)
  let stability = 0;

  // SemVer adherence (Max 30)
  const isSemVer = semver.valid(latestVersion) !== null;
  if (isSemVer) {
    stability += 30;
  } else {
    negativeSignals.push('Non-standard version format');
  }

  // Zero-version check (Max 20, reduced from 30 — 0.x packages can be mature)
  const isZeroVer = latestVersion.startsWith('0.');
  if (!isZeroVer) {
    stability += 20;
    positiveSignals.push('Stable API (v1.0.0+)');
  } else {
    // Soft deduction only — many respected packages stay on 0.x intentionally
    stability += 10;
    if (weeklyDownloads < 100_000) {
      warnings.push('SemVer major version is below 1.0. API stability may vary depending on the project\'s release practices.');
    } else {
      negativeSignals.push('SemVer major version is below 1.0 (pre-release)');
    }
  }

  // Breaking release frequency (Max 40)
  const allVersions = Object.keys(npmData.versions).filter(v => semver.valid(v));
  const majorVersions = new Set(allVersions.map(v => semver.major(v)));
  const creationTimeStr = timeEntries.created;
  const yearsActive = creationTimeStr
    ? (now.getTime() - new Date(creationTimeStr).getTime()) / (1000 * 60 * 60 * 24 * 365)
    : 1;

  const majorRate = yearsActive > 0 ? majorVersions.size / yearsActive : 1;
  if (majorRate < 1.5) {
    stability += 40;
    positiveSignals.push('Low API volatility');
  } else if (majorRate < 3.0) {
    stability += 30;
  } else if (majorRate < 5.0) {
    stability += 20;
    negativeSignals.push('Frequent major breaking releases');
  } else {
    stability += 5;
    negativeSignals.push('Extremely volatile release history');
  }

  stability = Math.min(100, Math.max(0, stability));

  // 3. Security Score (0-100)
  let security = 0;

  // Vulnerability count (Max 50)
  if (vulns.length === 0) {
    security += 50;
    positiveSignals.push('Zero known vulnerabilities');
  } else {
    const vulnDed = Math.min(50, vulns.length * 20);
    security += 50 - vulnDed;
    negativeSignals.push(`${vulns.length} active vulnerability advisories`);
    warnings.push(`Vulnerabilities detected: ${vulns.map(v => v.id).join(', ')}`);
  }

  // Install scripts (Max 30)
  const scripts = manifest.scripts || {};
  const hasInstallScripts = 'preinstall' in scripts || 'install' in scripts || 'postinstall' in scripts;
  if (!hasInstallScripts) {
    security += 30;
  } else {
    negativeSignals.push('Contains install scripts');
    warnings.push('Package runs scripts during installation (potential security risk).');
  }

  // Ownership changes & security best practices (Max 20)
  // Check if repository exists
  if (npmData.repository) {
    security += 20;
  } else {
    security += 10;
    negativeSignals.push('Missing repository field in package manifest');
  }

  security = Math.min(100, Math.max(0, security));
  if (vulns.length > 0) {
    security = Math.max(0, security - 50);
  }

  // 4. Package Quality Score (0-100)
  let quality = 0;

  // README checks (Max 20)
  const readmeLength = npmData.readme?.length || 0;
  const readmeFilename = npmData.readmeFilename || '';
  if (readmeLength > 5000) {
    quality += 20;
    positiveSignals.push('Highly detailed documentation');
  } else if (readmeLength > 1000) {
    quality += 15;
  } else if (readmeLength > 100) {
    quality += 5;
  } else if (readmeFilename) {
    quality += 15;
  } else {
    negativeSignals.push('Short or missing README');
  }

  // License (Max 20)
  const licenseName = (npmData.license || manifest.license || '').toUpperCase();
  const permissiveLicenses = ['MIT', 'APACHE-2.0', 'BSD-3-CLAUSE', 'BSD-2-CLAUSE', 'ISC', 'UNLICENSE'];
  const restrictiveLicenses = ['GPL', 'AGPL', 'LGPL', 'MPL'];

  let licenseValid = false;
  for (const perm of permissiveLicenses) {
    if (licenseName.includes(perm)) {
      quality += 20;
      positiveSignals.push('Permissive open-source license');
      licenseValid = true;
      break;
    }
  }

  if (!licenseValid) {
    let restrictive = false;
    for (const rest of restrictiveLicenses) {
      if (licenseName.includes(rest)) {
        quality += 10;
        negativeSignals.push(`Copyleft/Restrictive license (${licenseName})`);
        restrictive = true;
        break;
      }
    }
    if (!restrictive) {
      if (licenseName) {
        quality += 15; // custom but present
      } else {
        negativeSignals.push('Unlicensed or missing license specifications');
        warnings.push('No open-source license detected.');
      }
    }
  }

  // Tests & CI (Max 20)
  const hasTestScript = 'test' in scripts;
  const readmeContent = npmData.readme || '';
  const hasCIBadge =
    /github\/workflow/i.test(readmeContent) ||
    /actions\/workflows/i.test(readmeContent) ||
    /travis-ci/i.test(readmeContent) ||
    /circleci/i.test(readmeContent);

  if (hasTestScript || hasCIBadge) {
    quality += 20;
    positiveSignals.push('Tests or CI configured');
  } else {
    negativeSignals.push('No tests or CI scripts specified');
  }

  // Typings (Max 20)
  const hasTypes =
    'types' in manifest ||
    'typings' in manifest ||
    npmData.name.startsWith('@types/') ||
    manifest.exports?.['.']?.types ||
    manifest.exports?.types ||
    hasExternalTypes;

  if (hasTypes) {
    quality += 20;
    if (hasExternalTypes && !('types' in manifest || 'typings' in manifest)) {
      positiveSignals.push('TypeScript support (via DefinitelyTyped)');
    } else {
      positiveSignals.push('First-class TypeScript support');
    }
  } else {
    // Check if definitely typed has it
    quality += 5;
    negativeSignals.push('Missing native type definitions');
  }

  // ESM & modern builds (Max 20)
  const isCli = 'bin' in manifest;
  const isEsm = manifest.type === 'module' || 'exports' in manifest || manifest.module;
  if (isEsm || isCli) {
    quality += 20;
    positiveSignals.push(isEsm ? 'Modern ES module (ESM) support' : 'CLI executable tool');
  } else {
    quality += 10;
    negativeSignals.push('Legacy CommonJS only');
  }

  quality = Math.min(100, Math.max(0, quality));

  // 5. Ecosystem Score (0-100)
  let ecosystem = 0;

  // Downloads log scale (Max 40)
  if (weeklyDownloads > 10000000) {
    ecosystem += 40;
    positiveSignals.push('Huge ecosystem footprint (>10M weekly downloads)');
  } else if (weeklyDownloads > 1000000) {
    ecosystem += 35;
    positiveSignals.push('Very popular (>1M weekly downloads)');
  } else if (weeklyDownloads > 100000) {
    ecosystem += 30;
    positiveSignals.push('Mainstream adoption (>100k weekly downloads)');
  } else if (weeklyDownloads > 10000) {
    ecosystem += 20;
  } else if (weeklyDownloads > 1000) {
    ecosystem += 10;
  } else {
    ecosystem += 5;
    negativeSignals.push('Low package adoption (<1k weekly downloads)');
  }

  // Stars (Max 30)
  if (githubData) {
    // Stars (Max 30)
    if (githubData.stars > 25000) {
      ecosystem += 30;
      positiveSignals.push('Extremely high star count (>25k stars)');
    } else if (githubData.stars > 5000) {
      ecosystem += 25;
      positiveSignals.push('Highly starred (>5k stars)');
    } else if (githubData.stars > 1000) {
      ecosystem += 20;
      positiveSignals.push('Healthy community interest (>1k stars)');
    } else if (githubData.stars > 100) {
      ecosystem += 10;
    } else {
      ecosystem += 5;
    }

    // Contributors (Max 30)
    if (githubData.contributorsCount > 100) {
      ecosystem += 30;
      positiveSignals.push('Large contributor base (>100 contributors)');
    } else if (githubData.contributorsCount > 20) {
      ecosystem += 20;
      positiveSignals.push('Collaborative development');
    } else if (githubData.contributorsCount > 5) {
      ecosystem += 10;
    } else {
      ecosystem += 5;
      negativeSignals.push('Very few unique contributors');
    }
  } else {
    // If no GitHub repo details (due to rate-limit/offline/missing repo), base ecosystem solely on npm downloads!
    // NPM downloads is a very strong proxy for ecosystem health.
    if (weeklyDownloads > 1000000) {
      ecosystem = 100; // >1M weekly downloads is mainstream, solid ecosystem
      positiveSignals.push('Huge ecosystem footprint (>1M weekly downloads)');
    } else if (weeklyDownloads > 100000) {
      ecosystem = 90;
      positiveSignals.push('Mainstream adoption (>100k weekly downloads)');
    } else if (weeklyDownloads > 10000) {
      ecosystem = 75;
    } else if (weeklyDownloads > 1000) {
      ecosystem = 50;
    } else {
      ecosystem = 25;
      negativeSignals.push('Low package adoption (<1k weekly downloads)');
    }
  }

  ecosystem = Math.min(100, Math.max(0, ecosystem));

  // 6. Documentation Score (0-100)
  let documentation = 0;

  const readmeAvailable = readmeContent && readmeContent.trim().length > 0;

  if (!readmeAvailable) {
    // README content unavailable (registry strips large READMEs, or GitHub rate-limited)
    // Apply popularity-based floor: popular packages clearly have docs that exist externally
    if (weeklyDownloads > 10_000_000) {
      documentation = 90;
      positiveSignals.push('Established package with extensive external documentation');
    } else if (weeklyDownloads > 1_000_000) {
      documentation = 75;
      positiveSignals.push('Popular package with known documentation');
    } else if (weeklyDownloads > 100_000) {
      documentation = 55;
    } else if (readmeFilename) {
      documentation = 40;
      positiveSignals.push(`Documentation file declared (${readmeFilename})`);
    } else {
      negativeSignals.push('No README found');
    }
  } else {
    // Examples presence (Max 40)
    const hasExamples =
      /```(javascript|typescript|js|ts|bash|sh)/.test(readmeContent) ||
      /example|tutorial|getting started/i.test(readmeContent);

    if (hasExamples) {
      documentation += 40;
      positiveSignals.push('Code examples in README');
    } else {
      negativeSignals.push('No code examples in README');
    }

    // API completeness (Max 40)
    const hasApiDocs =
      /api reference|api doc|options|configuration|props|methods|exported/i.test(readmeContent) ||
      /documentation/i.test(readmeContent);

    if (hasApiDocs) {
      documentation += 40;
      positiveSignals.push('Structured API documentation');
    } else {
      negativeSignals.push('No explicit API reference in README');
    }

    // README length check (Max 20)
    if (readmeLength > 3000) {
      documentation += 20;
    } else if (readmeLength > 1000) {
      documentation += 10;
    } else {
      negativeSignals.push('Short documentation details');
    }
  }

  documentation = Math.min(100, Math.max(0, documentation));

  // 7. Developer Experience Score (0-100)
  let developerExperience = 0;

  // TS native (Max 40)
  if (hasTypes) {
    developerExperience += 40;
  } else {
    negativeSignals.push('No native typings (bad TypeScript DX)');
  }

  // Tree shaking (Max 30)
  const sideEffects = manifest.sideEffects;
  if (sideEffects === false || isCli) {
    developerExperience += 30;
    if (!isCli) positiveSignals.push('Side-effect free (excellent tree shaking)');
  } else if (Array.isArray(sideEffects) && sideEffects.length === 0) {
    developerExperience += 30;
  } else {
    developerExperience += 15;
    if (!isCli) negativeSignals.push('Potential side-effects (compromises tree shaking)');
  }

  // ESM exports quality (Max 30)
  if (isEsm || isCli) {
    developerExperience += 30;
  } else {
    developerExperience += 10;
  }

  developerExperience = Math.min(100, Math.max(0, developerExperience));

  // ── Publisher Trust Score ────────────────────────────────────────────────
  const publisherTrust = trustResult.score;
  if (trustResult.incident) {
    const inc = trustResult.incident;
    negativeSignals.push(`${inc.summary}`);
    warnings.push(`Publisher trust incident (${inc.year}): ${inc.detail}`);
    if (inc.severity === 'critical') {
      negativeSignals.push('Critical trust incident — evaluate alternatives carefully');
    }
  } else {
    positiveSignals.push('No known publisher trust incidents');
  }

  // Category weights for overall confidence score
  // Maintenance: 13%, Stability: 12%, Security: 20%, Quality: 13%,
  // Ecosystem: 13%, Docs: 9%, DX: 5%, PublisherTrust: 15%
  const weightMaint = 0.13;
  const weightStab = 0.12;
  const weightSec = 0.20;
  const weightQual = 0.13;
  const weightEco = 0.13;
  const weightDocs = 0.09;
  const weightDx = 0.05;
  const weightTrust = 0.15;

  let overallScore = Math.round(
    maintenance * weightMaint +
      stability * weightStab +
      security * weightSec +
      quality * weightQual +
      ecosystem * weightEco +
      documentation * weightDocs +
      developerExperience * weightDx +
      publisherTrust * weightTrust
  );

  // Penalize overall score dramatically if critical security vulnerabilities or archived
  if (vulns.length > 0) {
    overallScore = Math.max(0, overallScore - 30);
  }
  if (githubData?.archived) {
    overallScore = Math.max(0, overallScore - 40);
  }

  // Recommendation phrasing — trust incidents override the score-derived label
  let recommendation = 'Not Recommended';
  if (trustResult.incident) {
    if (trustResult.incident.severity === 'critical') {
      // Critical trust incident always overrides, regardless of score
      recommendation = overallScore >= 70 ? 'Use With Caution' : 'Not Recommended';
    } else {
      // High/moderate incident softens the label one notch
      if (overallScore >= 90)      recommendation = 'Recommended with Reservations';
      else if (overallScore >= 75) recommendation = 'Use With Caution';
      else if (overallScore >= 50) recommendation = 'Caution';
      else                          recommendation = 'Not Recommended';
    }
  } else {
    if (overallScore >= 90)      recommendation = 'Highly Recommended';
    else if (overallScore >= 75) recommendation = 'Recommended';
    else if (overallScore >= 50) recommendation = 'Caution';
  }

  // Summary — trust incidents must be the primary narrative when present
  let summary = '';
  const nameCapitalized = npmData.name.charAt(0).toUpperCase() + npmData.name.slice(1);

  if (trustResult.incident) {
    const inc = trustResult.incident;
    // Describe the technical standing first, then lead with the trust concern
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
  } else if (overallScore >= 90) {
    summary = `${nameCapitalized} is one of the highest-confidence packages available on npm. It is active, stable, and secure. Aevix recommends installing it.`;
  } else if (overallScore >= 75) {
    summary = `${nameCapitalized} is a reliable and well-maintained package. Aevix recommends installing it for general use.`;
  } else if (overallScore >= 50) {
    summary = `${nameCapitalized} has a moderate confidence rating. Review warning signs before using it in critical production projects.`;
  } else {
    summary = `${nameCapitalized} has low confidence. Aevix recommends looking for alternatives due to security, activity, or stability concerns.`;
  }

  // De-duplicate signals
  const uniquePositives = [...new Set(positiveSignals)].slice(0, 10);
  const uniqueNegatives = [...new Set(negativeSignals)].slice(0, 10);
  const uniqueWarnings = [...new Set(warnings)].slice(0, 10);

  return {
    packageName: npmData.name,
    version: latestVersion,
    overallScore,
    recommendation,
    categoryScores: {
      maintenance,
      stability,
      security,
      quality,
      ecosystem,
      documentation,
      developerExperience,
      publisherTrust,
    },
    positiveSignals: uniquePositives,
    negativeSignals: uniqueNegatives,
    warnings: uniqueWarnings.length > 0 ? uniqueWarnings : ['None'],
    summary,
    trustIncident: trustResult.incident,
    typosquatWarning: typosquatResult.isSuspicious ? typosquatResult : null,
  };
}
