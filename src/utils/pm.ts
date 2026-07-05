import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import * as logger from './logger.js';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export function detectPackageManager(cwd: string = process.cwd()): PackageManager {
  const config = loadConfig();
  if (config.packageManager !== 'auto') {
    return config.packageManager;
  }

  // 1. Try to detect by lockfiles in current/parent directories
  let currentDir = cwd;
  const root = path.parse(currentDir).root;

  while (true) {
    if (fs.existsSync(path.join(currentDir, 'pnpm-lock.yaml'))) {
      logger.info(`Detected package manager: pnpm via lockfile at ${currentDir}`);
      return 'pnpm';
    }
    if (fs.existsSync(path.join(currentDir, 'package-lock.json'))) {
      logger.info(`Detected package manager: npm via lockfile at ${currentDir}`);
      return 'npm';
    }
    if (fs.existsSync(path.join(currentDir, 'yarn.lock'))) {
      logger.info(`Detected package manager: yarn via lockfile at ${currentDir}`);
      return 'yarn';
    }
    if (fs.existsSync(path.join(currentDir, 'bun.lockb')) || fs.existsSync(path.join(currentDir, 'bun.lock'))) {
      logger.info(`Detected package manager: bun via lockfile at ${currentDir}`);
      return 'bun';
    }

    if (currentDir === root) {
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  // 2. Try to detect by user agent env
  const userAgent = process.env.npm_config_user_agent || '';
  if (userAgent.includes('pnpm')) return 'pnpm';
  if (userAgent.includes('yarn')) return 'yarn';
  if (userAgent.includes('bun')) return 'bun';
  if (userAgent.includes('npm')) return 'npm';

  // 3. Fallback to npm
  logger.info('Could not detect package manager, falling back to npm');
  return 'npm';
}

export function getInstallCommand(pm: PackageManager, packageName: string, isDev = false): { cmd: string; args: string[] } {
  const devFlag = isDev ? (pm === 'yarn' ? '--dev' : '-D') : '';
  const args: string[] = [];

  switch (pm) {
    case 'pnpm':
      args.push('add');
      if (devFlag) args.push(devFlag);
      args.push(packageName);
      return { cmd: 'pnpm', args };
    case 'yarn':
      args.push('add');
      if (devFlag) args.push(devFlag);
      args.push(packageName);
      return { cmd: 'yarn', args };
    case 'bun':
      args.push('add');
      if (devFlag) args.push(devFlag);
      args.push(packageName);
      return { cmd: 'bun', args };
    case 'npm':
    default:
      args.push('install');
      if (devFlag) args.push(devFlag);
      args.push(packageName);
      return { cmd: 'npm', args };
  }
}
