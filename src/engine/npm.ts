import axios from 'axios';
import * as cache from '../utils/cache.js';
import * as logger from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

export interface NpmRegistryData {
  name: string;
  description?: string;
  'dist-tags': Record<string, string>;
  time: Record<string, string>;
  versions: Record<string, any>;
  repository?: {
    type?: string;
    url?: string;
  };
  homepage?: string;
  bugs?: {
    url?: string;
  };
  maintainers?: Array<{ name: string; email?: string }>;
  license?: string;
  readme?: string;
  readmeFilename?: string;
}

export interface NpmDownloadsData {
  downloads: number;
  start: string;
  end: string;
  package: string;
}

// Helper to extract GitHub owner and repo from repository URL
export function parseGitHubUrl(repoUrl?: string): { owner: string; repo: string } | null {
  if (!repoUrl) return null;

  // Clean URLs like git+https://github.com/owner/repo.git or git://github.com/owner/repo
  const cleanUrl = repoUrl
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://');

  try {
    const url = new URL(cleanUrl);
    if (url.hostname === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1] };
      }
    }
  } catch (err) {
    // If URL parsing fails, try regex fallback
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  return null;
}

export async function fetchRegistryData(packageName: string, offline = false): Promise<NpmRegistryData> {
  const config = loadConfig();
  const cacheKey = 'registry';
  const cached = cache.get<NpmRegistryData>(packageName, cacheKey, config.cacheTtlMs, offline);

  if (cached) {
    return cached;
  }

  if (offline) {
    throw new Error(`Offline mode: no cached registry data found for package "${packageName}"`);
  }

  const encodedPackage = packageName.startsWith('@')
    ? `@${encodeURIComponent(packageName.slice(1))}`
    : encodeURIComponent(packageName);

  const url = `https://registry.npmjs.org/${encodedPackage}`;
  logger.info(`Fetching NPM registry data from ${url}`);

  try {
    const response = await axios.get<NpmRegistryData>(url, {
      timeout: 10000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'aevix-cli/1.0.0',
      },
    });

    cache.set(packageName, cacheKey, response.data);
    return response.data;
  } catch (err: any) {
    logger.error(`Failed to fetch NPM registry data for ${packageName}: ${err.message}`);
    throw new Error(`Could not fetch package metadata for "${packageName}". (Registry details: ${err.message})`);
  }
}

export async function fetchDownloadStats(packageName: string, offline = false): Promise<NpmDownloadsData> {
  const config = loadConfig();
  const cacheKey = 'downloads';
  const cached = cache.get<NpmDownloadsData>(packageName, cacheKey, config.cacheTtlMs, offline);

  if (cached) {
    return cached;
  }

  if (offline) {
    // Return mock/0 downloads in offline fallback rather than crashing
    return { downloads: 0, start: '', end: '', package: packageName };
  }

  // Scoped packages in downloads API: /downloads/point/last-week/@scope/package
  const url = `https://api.npmjs.org/downloads/point/last-week/${packageName}`;
  logger.info(`Fetching NPM download stats from ${url}`);

  try {
    const response = await axios.get<NpmDownloadsData>(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'aevix-cli/1.0.0',
      },
    });

    cache.set(packageName, cacheKey, response.data);
    return response.data;
  } catch (err: any) {
    logger.warn(`Failed to fetch NPM download stats for ${packageName}: ${err.message}`);
    // If download stats fail (e.g. package not found or API down), return a fallback instead of failing the whole analysis
    return { downloads: 0, start: '', end: '', package: packageName };
  }
}

export async function hasDefinitelyTyped(packageName: string, offline = false): Promise<boolean> {
  if (offline) return false;
  // Scoped packages like @babel/core have types at @types/babel__core
  const typesName = packageName.startsWith('@')
    ? packageName.slice(1).replace(/\//g, '__')
    : packageName;
  const url = `https://registry.npmjs.org/@types%2F${encodeURIComponent(typesName)}`;
  try {
    const res = await axios.head(url, { timeout: 3000 });
    return res.status === 200;
  } catch (err) {
    return false;
  }
}
