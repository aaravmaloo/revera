import fs from 'node:fs';
import path from 'node:path';
import { getReveraDir } from './config.js';
import * as logger from './logger.js';

const CACHE_DIR = path.join(getReveraDir(), 'cache');

function getCacheDir(): string {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  return CACHE_DIR;
}

function safeFilename(packageName: string): string {
  // E.g., @nestjs/core -> __nestjs__core.json
  return packageName.replace(/\//g, '__') + '.json';
}

export function getCachePath(packageName: string, key: string): string {
  const dir = getCacheDir();
  return path.join(dir, safeFilename(`${packageName}_${key}`));
}

export function get<T>(packageName: string, key: string, ttlMs: number, offline = false): T | null {
  const cacheFile = getCachePath(packageName, key);
  if (!fs.existsSync(cacheFile)) {
    return null;
  }

  try {
    const stats = fs.statSync(cacheFile);
    const ageMs = Date.now() - stats.mtimeMs;

    if (!offline && ageMs > ttlMs) {
      logger.info(`Cache expired for package ${packageName} (key: ${key}), age: ${ageMs}ms, ttl: ${ttlMs}ms`);
      return null;
    }

    const data = fs.readFileSync(cacheFile, 'utf-8');
    logger.info(`Cache hit for package ${packageName} (key: ${key})`);
    return JSON.parse(data) as T;
  } catch (err: any) {
    logger.error(`Error reading cache for package ${packageName} (key: ${key}): ${err.message}`);
    return null;
  }
}

export function set<T>(packageName: string, key: string, data: T): void {
  try {
    const cacheFile = getCachePath(packageName, key);
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf-8');
    logger.info(`Cache updated for package ${packageName} (key: ${key})`);
  } catch (err: any) {
    logger.error(`Error writing cache for package ${packageName} (key: ${key}): ${err.message}`);
  }
}

export function clearCache(): void {
  const dir = getCacheDir();
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file.endsWith('.json')) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
  logger.info('Cache cleared successfully');
}

export function getCacheInfo(): { fileCount: number; sizeBytes: number } {
  const dir = getCacheDir();
  let fileCount = 0;
  let sizeBytes = 0;
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isFile()) {
        fileCount++;
        sizeBytes += fs.statSync(filePath).size;
      }
    }
  }
  return { fileCount, sizeBytes };
}
