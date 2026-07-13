import axios from 'axios';
import * as cache from '../utils/cache.js';
import * as logger from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { retrieveToken } from '../utils/keyring.js';
import { requestWithRetry } from '../utils/http.js';

export interface GitHubRepoData {
  stars: number;
  openIssues: number;
  forks: number;
  archived: boolean;
  contributorsCount: number;
  lastCommitDate?: string;
  commitsInLast90Days: number;
}

// Extract contributor count from GitHub pagination link header
function parseContributorsCount(linkHeader?: string): number {
  if (!linkHeader) return 0;
  // Format: <https://api.github.com/...page=100>; rel="last"
  const match = linkHeader.match(/page=(\d+)>;\s*rel="last"/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0;
}

export async function fetchGitHubRepoData(
  owner: string,
  repo: string,
  packageName: string,
  offline = false,
): Promise<GitHubRepoData | null> {
  const config = loadConfig();
  const cacheKey = `github_${owner}_${repo}`;
  const cached = cache.get<GitHubRepoData>(packageName, cacheKey, config.cacheTtlMs, offline);

  if (cached) {
    return cached;
  }

  if (offline) {
    return null;
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'revera-cli/1.0.0',
  };

  const keyringToken = await retrieveToken();
  if (keyringToken) {
    headers['Authorization'] = `token ${keyringToken}`;
  } else if (config.githubToken) {
    headers['Authorization'] = `token ${config.githubToken}`;
  } else if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  try {
    logger.info(`Fetching GitHub repo data for ${owner}/${repo}`);

    // Fetch primary repo details
    const repoRes = await requestWithRetry({
      url: `https://api.github.com/repos/${owner}/${repo}`,
      method: 'GET',
      headers,
      timeout: 8000,
    });

    const repoData = repoRes.data;

    // Fetch contributors count using standard page-pagination trick
    let contributorsCount = 0;
    try {
      const contribsRes = await requestWithRetry({
        url: `https://api.github.com/repos/${owner}/${repo}/contributors`,
        method: 'GET',
        params: { per_page: 1, anon: 'true' },
        headers,
        timeout: 8000,
      });
      contributorsCount = parseContributorsCount(contribsRes.headers['link']) || contribsRes.data.length || 0;
    } catch (err: any) {
      logger.warn(`Failed to fetch contributors count for ${owner}/${repo}: ${err.message}`);
    }

    // Fetch last 90 days of commits to estimate frequency
    let lastCommitDate: string | undefined;
    let commitsInLast90Days = 0;
    try {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const commitsRes = await requestWithRetry({
        url: `https://api.github.com/repos/${owner}/${repo}/commits`,
        method: 'GET',
        params: { per_page: 100, since: ninetyDaysAgo.toISOString() },
        headers,
        timeout: 8000,
      });

      const commits = commitsRes.data;
      commitsInLast90Days = commits.length;

      if (commits.length > 0) {
        lastCommitDate = commits[0].commit?.committer?.date || commits[0].commit?.author?.date;
      }
    } catch (err: any) {
      logger.warn(`Failed to fetch commits for ${owner}/${repo}: ${err.message}`);
    }

    const finalData: GitHubRepoData = {
      stars: repoData.stargazers_count ?? 0,
      openIssues: repoData.open_issues_count ?? 0,
      forks: repoData.forks_count ?? 0,
      archived: repoData.archived ?? false,
      contributorsCount,
      lastCommitDate,
      commitsInLast90Days,
    };

    cache.set(packageName, cacheKey, finalData);
    return finalData;
  } catch (err: any) {
    if (err.response?.status === 403 || err.response?.status === 429) {
      logger.warn(`GitHub API Rate limit or Forbidden for ${owner}/${repo}: ${err.message}`);
    } else {
      logger.warn(`Failed to fetch GitHub repo data for ${owner}/${repo}: ${err.message}`);
    }
    return null; // Return null so engine fallbacks can take over
  }
}

export async function fetchGitHubReadme(
  owner: string,
  repo: string,
  packageName: string,
  offline = false,
): Promise<string | null> {
  const config = loadConfig();
  const cacheKey = `github_readme_${owner}_${repo}`;
  const cached = cache.get<string>(packageName, cacheKey, config.cacheTtlMs, offline);

  if (cached) {
    return cached;
  }

  if (offline) {
    return null;
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'revera-cli/1.0.0',
  };

  const keyringToken = await retrieveToken();
  if (keyringToken) {
    headers['Authorization'] = `token ${keyringToken}`;
  } else if (config.githubToken) {
    headers['Authorization'] = `token ${config.githubToken}`;
  } else if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  try {
    logger.info(`Fetching GitHub README for ${owner}/${repo}`);
    const res = await requestWithRetry({
      url: `https://api.github.com/repos/${owner}/${repo}/readme`,
      method: 'GET',
      headers,
      timeout: 8000,
    });

    if (res.data?.content && res.data?.encoding === 'base64') {
      const readme = Buffer.from(res.data.content, 'base64').toString('utf8');
      cache.set(packageName, cacheKey, readme);
      return readme;
    }
  } catch (err: any) {
    logger.warn(`Failed to fetch GitHub README for ${owner}/${repo}: ${err.message}`);
  }

  return null;
}
