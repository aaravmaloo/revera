/**
 * vuln.ts — Multi-source vulnerability aggregator
 *
 * Queries three independent databases in parallel and merges results,
 * deduplicating by CVE/GHSA alias so the same vuln is never double-counted.
 *
 * Sources (all zero-auth, stable public APIs):
 *   1. OSV  (osv.dev)              — aggregates NVD, GitHub Advisory, RUSTSEC, etc.
 *   2. GitHub Advisory Database    — REST v3, richer CVSS + patched-versions metadata
 *   3. npm Advisory Bulk endpoint  — registry.npmjs.org, same data as `npm audit`
 *
 * The merged VulnResult also exposes a `sources` field so callers can see
 * which DBs confirmed a vulnerability.
 */

import axios from 'axios';
import semver from 'semver';
import * as cache from '../utils/cache.js';
import * as logger from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { retrieveToken } from '../utils/keyring.js';
import { requestWithRetry } from '../utils/http.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface Vulnerability {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  cvssScore?: number;
  patchedVersions?: string;
  source: 'osv' | 'github' | 'npm';
}

export interface VulnResult {
  status: 'clean' | 'vulnerable' | 'unknown';
  vulnerabilities: Vulnerability[];
  /** Which sources responded successfully */
  sources: ('osv' | 'github' | 'npm')[];
  /** Which sources timed out or errored */
  failedSources: ('osv' | 'github' | 'npm')[];
}

// ─── Request timeout (shared) ──────────────────────────────────────────────

const TIMEOUT_MS = 8000;
const UA = 'revera-cli/2.0.0';

// ─── Source 1: OSV ────────────────────────────────────────────────────────

async function queryOSV(packageName: string, version: string): Promise<Vulnerability[]> {
  const response = await requestWithRetry({
    url: 'https://api.osv.dev/v1/query',
    method: 'POST',
    data: {
      version,
      package: { name: packageName, ecosystem: 'npm' },
    },
    timeout: TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
  });

  const raw: any[] = response.data?.vulns ?? [];
  return raw.map((v) => ({
    id: v.id,
    summary: v.summary,
    details: v.details,
    aliases: v.aliases ?? [],
    modified: v.modified,
    published: v.published,
    severity: mapOSVSeverity(v.database_specific?.severity ?? v.severity?.[0]?.type),
    cvssScore: extractOSVCvss(v),
    patchedVersions: extractOSVPatched(v, packageName),
    source: 'osv' as const,
  }));
}

function mapOSVSeverity(raw: string | undefined): Vulnerability['severity'] {
  if (!raw) return 'UNKNOWN';
  const s = raw.toUpperCase();
  if (s === 'CRITICAL') return 'CRITICAL';
  if (s === 'HIGH') return 'HIGH';
  if (s === 'MEDIUM' || s === 'MODERATE') return 'MEDIUM';
  if (s === 'LOW') return 'LOW';
  return 'UNKNOWN';
}

function extractOSVCvss(v: any): number | undefined {
  const severities: any[] = v.severity ?? [];
  for (const s of severities) {
    if (s.type === 'CVSS_V3' || s.type === 'CVSS_V2') {
      // CVSS vector strings → just parse the score from database_specific if available
      const score = v.database_specific?.cvss?.score;
      if (typeof score === 'number') return score;
    }
  }
  return undefined;
}

function extractOSVPatched(v: any, packageName: string): string | undefined {
  const affected: any[] = v.affected ?? [];
  for (const a of affected) {
    if (a.package?.name === packageName) {
      const ranges: any[] = a.ranges ?? [];
      for (const r of ranges) {
        const events: any[] = r.events ?? [];
        const fixed = events.find((e) => e.fixed)?.fixed;
        if (fixed) return `>=${fixed}`;
      }
    }
  }
  return undefined;
}

// ─── Source 2: GitHub Advisory Database ──────────────────────────────────

async function queryGitHubAdvisory(packageName: string, version: string): Promise<Vulnerability[]> {
  const config = loadConfig();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': UA,
  };

  const keyringToken = await retrieveToken();
  if (keyringToken) {
    headers['Authorization'] = `token ${keyringToken}`;
  } else if (config.githubToken) {
    headers['Authorization'] = `token ${config.githubToken}`;
  } else if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  // Public REST endpoint
  // GET /advisories?ecosystem=npm&affects={package}&per_page=100
  const response = await requestWithRetry({
    url: 'https://api.github.com/advisories',
    method: 'GET',
    params: {
      ecosystem: 'npm',
      affects: packageName,
      per_page: 100,
    },
    timeout: TIMEOUT_MS,
    headers,
  });

  const advisories: any[] = response.data ?? [];

  // Filter to advisories that affect this specific version
  return advisories
    .filter((a) => advisoryAffectsVersion(a, packageName, version))
    .map((a) => ({
      id: a.ghsa_id,
      summary: a.summary,
      details: a.description,
      aliases: (a.cve_id ? [a.cve_id] : []).concat(a.identifiers?.map((i: any) => i.value) ?? []),
      modified: a.updated_at,
      published: a.published_at,
      severity: mapGHSeverity(a.severity),
      cvssScore: a.cvss?.score,
      patchedVersions: extractGHPatched(a, packageName),
      source: 'github' as const,
    }));
}

function advisoryAffectsVersion(advisory: any, packageName: string, version: string): boolean {
  const vulnPackages: any[] = advisory.vulnerabilities ?? [];
  return vulnPackages.some((vp) => {
    if (vp.package?.ecosystem !== 'npm') return false;
    if (vp.package?.name !== packageName) return false;

    // If the current version satisfies the patched range, the vuln is fixed — skip it.
    if (vp.patched_versions) {
      try {
        if (semver.satisfies(version, vp.patched_versions, { includePrerelease: true })) return false;
      } catch {
        // unparseable range — fall through to vulnerable_version_range check
      }
    }

    // If a vulnerable range is specified, check whether our version is inside it.
    if (vp.vulnerable_version_range) {
      try {
        return semver.satisfies(version, vp.vulnerable_version_range, { includePrerelease: true });
      } catch {
        return true; // unparseable range — assume affected
      }
    }

    // No range info at all — conservatively assume it affects the current version.
    return true;
  });
}

function mapGHSeverity(raw: string | undefined): Vulnerability['severity'] {
  if (!raw) return 'UNKNOWN';
  const s = raw.toUpperCase();
  if (s === 'CRITICAL') return 'CRITICAL';
  if (s === 'HIGH') return 'HIGH';
  if (s === 'MEDIUM' || s === 'MODERATE') return 'MEDIUM';
  if (s === 'LOW') return 'LOW';
  return 'UNKNOWN';
}

function extractGHPatched(advisory: any, packageName: string): string | undefined {
  const vulnPackages: any[] = advisory.vulnerabilities ?? [];
  const match = vulnPackages.find(
    (vp) => vp.package?.ecosystem === 'npm' && vp.package?.name === packageName,
  );
  return match?.patched_versions ?? undefined;
}

// ─── Source 3: npm Advisory Bulk endpoint ────────────────────────────────

async function queryNpmAdvisory(packageName: string, version: string): Promise<Vulnerability[]> {
  // POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
  // Body: { "<name>": ["<version>", ...] }
  const response = await requestWithRetry({
    url: 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    method: 'POST',
    data: { [packageName]: [version] },
    timeout: TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
  });

  const data: Record<string, any[]> = response.data ?? {};
  const advisories: any[] = data[packageName] ?? [];

  return advisories.map((a) => ({
    id: `npm-advisory-${a.id}`,
    summary: a.title,
    details: a.overview,
    aliases: [a.cve ?? '', ...(a.cves ?? [])].filter(Boolean),
    modified: a.updated,
    published: a.created,
    severity: mapNpmSeverity(a.severity),
    cvssScore: a.cvss?.score,
    patchedVersions: a.patched_versions,
    source: 'npm' as const,
  }));
}

function mapNpmSeverity(raw: string | undefined): Vulnerability['severity'] {
  if (!raw) return 'UNKNOWN';
  const s = raw.toUpperCase();
  if (s === 'CRITICAL') return 'CRITICAL';
  if (s === 'HIGH') return 'HIGH';
  if (s === 'MODERATE') return 'MEDIUM';
  if (s === 'LOW') return 'LOW';
  return 'UNKNOWN';
}

// ─── Deduplication ────────────────────────────────────────────────────────

/**
 * Merges vulns from multiple sources, keeping one canonical entry per
 * vulnerability identity (CVE ID or GHSA ID). The highest-severity source
 * entry wins; OSV is preferred as the most structured source.
 */
function deduplicateVulns(vulns: Vulnerability[]): Vulnerability[] {
  const canonical = new Map<string, Vulnerability>();

  for (const v of vulns) {
    // Build a set of all identifiers for this vuln (its own id + all aliases)
    const ids = [v.id, ...(v.aliases ?? [])].map((s) => s.trim().toUpperCase()).filter(Boolean);

    // Find if any existing entry shares an identifier
    let existingKey: string | undefined;
    for (const id of ids) {
      if (canonical.has(id)) {
        existingKey = id;
        break;
      }
    }

    if (existingKey) {
      // Merge: prefer OSV > GitHub > npm; pick higher severity
      const existing = canonical.get(existingKey)!;
      const merged = mergeVulns(existing, v);
      // Re-index under all known ids
      for (const id of ids) canonical.set(id, merged);
      const existingIds = [existing.id, ...(existing.aliases ?? [])].map((s) => s.toUpperCase());
      for (const id of existingIds) canonical.set(id, merged);
    } else {
      // New entry
      for (const id of ids) canonical.set(id, v);
    }
  }

  // Collect unique objects (a single vuln may be stored under multiple keys)
  const seen = new Set<Vulnerability>();
  const result: Vulnerability[] = [];
  for (const v of canonical.values()) {
    if (!seen.has(v)) {
      seen.add(v);
      result.push(v);
    }
  }
  return result;
}

const SOURCE_PRIORITY: Record<Vulnerability['source'], number> = { osv: 0, github: 1, npm: 2 };
const SEV_RANK: Record<NonNullable<Vulnerability['severity']>, number> = {
  CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0,
};

function mergeVulns(a: Vulnerability, b: Vulnerability): Vulnerability {
  // Pick the more authoritative source for prose fields
  const base = SOURCE_PRIORITY[a.source] <= SOURCE_PRIORITY[b.source] ? a : b;
  const other = base === a ? b : a;

  // Merge aliases
  const allAliases = Array.from(
    new Set([...(a.aliases ?? []), ...(b.aliases ?? []), a.id, b.id]),
  ).filter((s) => s !== base.id);

  // Pick highest severity
  const sev =
    SEV_RANK[a.severity ?? 'UNKNOWN'] >= SEV_RANK[b.severity ?? 'UNKNOWN'] ? a.severity : b.severity;

  return {
    ...base,
    aliases: allAliases,
    severity: sev,
    cvssScore: a.cvssScore ?? b.cvssScore,
    patchedVersions: a.patchedVersions ?? b.patchedVersions,
    summary: base.summary ?? other.summary,
    details: base.details ?? other.details,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function checkVulnerabilities(
  packageName: string,
  version: string,
  offline = false,
): Promise<VulnResult> {
  const config = loadConfig();
  // Cache key includes version so different versions get independent entries.
  // Use a versioned prefix (v3) so stale v2 cache entries (which lacked proper
  // version-range filtering) are automatically invalidated on first run.
  const cacheKey = `vulns_v3_${version}`;
  const cached = cache.get<Vulnerability[]>(packageName, cacheKey, config.cacheTtlMs, offline);

  if (cached) {
    return {
      status: cached.length > 0 ? 'vulnerable' : 'clean',
      vulnerabilities: cached,
      sources: ['osv', 'github', 'npm'],
      failedSources: [],
    };
  }

  if (offline) {
    return { status: 'unknown', vulnerabilities: [], sources: [], failedSources: ['osv', 'github', 'npm'] };
  }

  logger.info(`Checking vulnerabilities (OSV) for ${packageName}@${version}`);

  let osvVulns: Vulnerability[] = [];
  let osvFailed = false;

  try {
    osvVulns = await queryOSV(packageName, version);
  } catch (err: any) {
    osvFailed = true;
    logger.warn(`[OSV] vuln check failed for ${packageName}@${version}: ${err.message}`);
  }

  const succeededSources: ('osv' | 'github' | 'npm')[] = [];
  const failedSources: ('osv' | 'github' | 'npm')[] = [];
  const allVulns: Vulnerability[] = [];

  if (!osvFailed) {
    succeededSources.push('osv');
    allVulns.push(...osvVulns);
  } else {
    failedSources.push('osv');
  }

  // Only query GitHub and npm if OSV found some vulnerabilities
  // (to enrich/verify them with better CVSS scores / patched versions metadata).
  if (osvVulns.length > 0) {
    logger.info(`OSV found vulnerabilities; querying GitHub and npm advisories for ${packageName}@${version}`);
    const [ghResult, npmResult] = await Promise.allSettled([
      queryGitHubAdvisory(packageName, version),
      queryNpmAdvisory(packageName, version),
    ]);

    if (ghResult.status === 'fulfilled') {
      succeededSources.push('github');
      allVulns.push(...ghResult.value);
    } else {
      failedSources.push('github');
      logger.warn(`[GITHUB] vuln check failed for ${packageName}@${version}: ${ghResult.reason?.message}`);
    }

    if (npmResult.status === 'fulfilled') {
      succeededSources.push('npm');
      allVulns.push(...npmResult.value);
    } else {
      failedSources.push('npm');
      logger.warn(`[NPM] vuln check failed for ${packageName}@${version}: ${npmResult.reason?.message}`);
    }
  }

  const merged = deduplicateVulns(allVulns);

  // Only cache if at least one source succeeded
  if (succeededSources.length > 0) {
    cache.set(packageName, cacheKey, merged);
  }

  // Status is 'unknown' only if ALL sources failed (no signal whatsoever)
  const status =
    succeededSources.length === 0
      ? 'unknown'
      : merged.length > 0
        ? 'vulnerable'
        : 'clean';

  return { status, vulnerabilities: merged, sources: succeededSources, failedSources };
}
