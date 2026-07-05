import { describe, it, expect } from 'vitest';
import { generateReport } from '../src/engine/scoring.js';
import { NpmRegistryData, NpmDownloadsData } from '../src/engine/npm.js';
import { GitHubRepoData } from '../src/engine/github.js';
import { Vulnerability } from '../src/engine/vuln.js';
import { checkPublisherTrust } from '../src/engine/trust.js';
import { checkTyposquatting } from '../src/engine/typosquat.js';

describe('Aevix Scoring Engine', () => {
  const mockNpmData: NpmRegistryData = {
    name: 'test-package',
    'dist-tags': { latest: '1.2.0' },
    time: {
      created: '2020-01-01T00:00:00.000Z',
      '1.2.0': '2026-06-30T00:00:00.000Z', // Recent publish
    },
    versions: {
      '1.2.0': {
        name: 'test-package',
        version: '1.2.0',
        license: 'MIT',
        type: 'module',
        scripts: { test: 'vitest' },
        types: 'index.d.ts',
        sideEffects: false,
      },
    },
    repository: { type: 'git', url: 'git+https://github.com/test-org/test-package.git' },
    maintainers: [{ name: 'dev1' }, { name: 'dev2' }, { name: 'dev3' }],
    readme: '# Test Package\nThis is a great package. Examples:\n```js\nconst x = require("test");\n```\n## API Reference\nOptions and methods description here.',
  };

  const mockDownloads: NpmDownloadsData = {
    downloads: 5000000,
    start: '2026-06-01',
    end: '2026-06-07',
    package: 'test-package',
  };

  const mockGitHub: GitHubRepoData = {
    stars: 15000,
    openIssues: 50,
    forks: 800,
    archived: false,
    contributorsCount: 150,
    lastCommitDate: '2026-07-01T00:00:00.000Z',
    commitsInLast90Days: 45,
  };

  it('calculates high reputation scores for well-maintained packages', () => {
    const trust = checkPublisherTrust(mockNpmData.name);
    const typosquat = checkTyposquatting(mockNpmData.name, mockDownloads.downloads);
    const report = generateReport(mockNpmData, mockDownloads, mockGitHub, [], trust, typosquat);

    expect(report.packageName).toBe('test-package');
    expect(report.version).toBe('1.2.0');
    expect(report.overallScore).toBeGreaterThanOrEqual(90);
    expect(report.recommendation).toBe('Highly Recommended');
    expect(report.positiveSignals).toContain('Frequent releases');
    expect(report.positiveSignals).toContain('Stable API (v1.0.0+)');
    expect(report.positiveSignals).toContain('Zero known vulnerabilities');
    expect(report.warnings).toEqual(['None']);
  });

  it('penalizes rating when vulnerabilities are present', () => {
    const mockVulns: Vulnerability[] = [
      {
        id: 'GHSA-xxxx-yyyy-zzzz',
        summary: 'Prototype Pollution',
        details: 'Allows proto pollution',
      },
    ];

    const trust = checkPublisherTrust(mockNpmData.name);
    const typosquat = checkTyposquatting(mockNpmData.name, mockDownloads.downloads);
    const report = generateReport(mockNpmData, mockDownloads, mockGitHub, mockVulns, trust, typosquat);

    expect(report.categoryScores.security).toBeLessThan(50);
    expect(report.overallScore).toBeLessThan(75);
    expect(report.recommendation).not.toBe('Highly Recommended');
    expect(report.negativeSignals).toContain('1 active vulnerability advisories');
    expect(report.warnings.length).toBeGreaterThan(0);
  });
});
