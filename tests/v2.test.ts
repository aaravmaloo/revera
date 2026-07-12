import { describe, it, expect } from 'vitest';
import { generateReport } from '../src/engine/scoring.js';
import { buildDAG, getTopologicalOrder, propagateRisk, DAGNode } from '../src/engine/index.js';
import { NpmRegistryData, NpmDownloadsData } from '../src/engine/npm.js';
import { GitHubRepoData } from '../src/engine/github.js';
import { TrustResult } from '../src/engine/trust.js';
import { TyposquatResult } from '../src/engine/typosquat.js';

describe('Revera v2 Architecture - Bayesian & DAG Pipeline', () => {
  const mockNpmData: NpmRegistryData = {
    name: 'test-utils',
    'dist-tags': { latest: '1.0.0' },
    time: {
      created: '2022-01-01T00:00:00.000Z',
      '1.0.0': '2026-06-30T00:00:00.000Z',
    },
    versions: {
      '1.0.0': {
        name: 'test-utils',
        version: '1.0.0',
        license: 'MIT',
        type: 'module',
      },
    },
  };

  const mockDownloads: NpmDownloadsData = {
    downloads: 5000,
    start: '2026-06-01',
    end: '2026-06-07',
    package: 'test-utils',
  };

  const mockGitHub: GitHubRepoData = {
    stars: 10,
    openIssues: 2,
    forks: 1,
    archived: false,
    contributorsCount: 2,
    lastCommitDate: '2026-07-01T00:00:00.000Z',
    commitsInLast90Days: 5,
  };

  it('correctly maps to archetype and computes Bayesian credible intervals', () => {
    const trust: TrustResult = { score: 100, incident: null };
    const typosquat: TyposquatResult = { isSuspicious: false, similarTo: null, distance: Infinity, reason: '' };
    const report = generateReport(mockNpmData, mockDownloads, mockGitHub, [], trust, typosquat);

    expect(report.intrinsicRisk).toBeGreaterThan(0);
    expect(report.intrinsicRisk).toBeLessThan(1);
    expect(report.credibleInterval).toBeDefined();
    expect(report.credibleInterval[0]).toBeLessThanOrEqual(report.credibleInterval[1]);
    expect(report.tainted).toBe(false);
  });

  it('triggers veto on critical trust incidents', () => {
    const criticalTrust: TrustResult = {
      score: 50,
      incident: {
        severity: 'critical',
        year: 2022,
        summary: 'Sabotage',
        detail: 'Sabotaged codebase',
        penalty: 50,
      },
    };
    const typosquat: TyposquatResult = { isSuspicious: false, similarTo: null, distance: Infinity, reason: '' };
    const report = generateReport(mockNpmData, mockDownloads, mockGitHub, [], criticalTrust, typosquat);

    expect(report.tainted).toBe(true);
    expect(report.intrinsicRisk).toBe(0.97);
    expect(report.overallScore).toBe(3); // 100 * (1 - 0.97) = 3
  });

  it('propagates risk and taint bottom-up in a dependency graph', () => {
    // Setup a mini mock DAG: parent -> child
    const parent: DAGNode = {
      name: 'parent-pkg',
      version: '1.0.0',
      isDirect: true,
      isProd: true,
      depth: 0,
      dependents: new Set(),
      dependencies: new Set(['child-pkg']),
      intrinsicRisk: 0.1,
      effectiveRisk: 0.1,
      credibleInterval: [0.05, 0.15],
      tainted: false,
      blastRadius: 0,
    };

    const child: DAGNode = {
      name: 'child-pkg',
      version: '1.0.0',
      isDirect: false,
      isProd: true,
      depth: 1,
      dependents: new Set(['parent-pkg']),
      dependencies: new Set(),
      intrinsicRisk: 0.97, // Tainted child
      effectiveRisk: 0.97,
      credibleInterval: [0.95, 0.99],
      tainted: true,
      blastRadius: 0,
    };

    const dag = new Map<string, DAGNode>([
      ['parent-pkg', parent],
      ['child-pkg', child],
    ]);

    // Create mock reports
    parent.report = {
      packageName: 'parent-pkg',
      overallScore: 90,
      recommendation: 'Recommended',
      positiveSignals: [],
      negativeSignals: [],
      warnings: [],
      summary: '',
    };
    child.report = {
      packageName: 'child-pkg',
      overallScore: 3,
      recommendation: 'Not Recommended',
      positiveSignals: [],
      negativeSignals: [],
      warnings: [],
      summary: '',
    };

    // Propagate risk
    propagateRisk(dag, 0.8);

    // Verify child results
    expect(child.effectiveRisk).toBe(0.97);
    expect(child.blastRadius).toBe(0.97 * 1); // 1 dependent

    // Verify parent has inherited risk and taint
    expect(parent.tainted).toBe(true);
    expect(parent.effectiveRisk).toBeGreaterThanOrEqual(0.8); // Floored at 0.8 because of child taint
    expect(parent.report.overallScore).toBeLessThanOrEqual(20); // 100 * (1 - 0.8) = 20
    expect(parent.report.recommendation).toBe('Not Recommended');
    expect(parent.worstSubpath).toEqual(['parent-pkg', 'child-pkg']);
  });
});
