import axios from 'axios';
import * as cache from '../utils/cache.js';
import * as logger from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

export interface Vulnerability {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
}

export async function checkVulnerabilities(
  packageName: string,
  version: string,
  offline = false,
): Promise<Vulnerability[]> {
  const config = loadConfig();
  const cacheKey = `vulns_${version}`;
  const cached = cache.get<Vulnerability[]>(packageName, cacheKey, config.cacheTtlMs, offline);

  if (cached) {
    return cached;
  }

  if (offline) {
    return [];
  }

  const url = 'https://api.osv.dev/v1/query';
  logger.info(`Checking vulnerabilities at OSV for ${packageName}@${version}`);

  try {
    const response = await axios.post(
      url,
      {
        version,
        package: {
          name: packageName,
          ecosystem: 'npm',
        },
      },
      {
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'revera-cli/1.0.0',
        },
      },
    );

    const vulns: Vulnerability[] = response.data?.vulns || [];
    cache.set(packageName, cacheKey, vulns);
    return vulns;
  } catch (err: any) {
    logger.warn(`Failed to check OSV vulnerabilities for ${packageName}@${version}: ${err.message}`);
    // Return empty list on failure rather than crashing
    return [];
  }
}
