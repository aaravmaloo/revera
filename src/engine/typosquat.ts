/**
 * Typosquatting detection module.
 *
 * Computes Levenshtein edit distance between a queried package name and a
 * curated list of highly popular npm packages. Flags low-adoption packages
 * that closely resemble a popular one as potential typosquats.
 */

// ── Levenshtein distance ───────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Curated list of top npm packages by weekly downloads.
 * Only packages with millions of weekly downloads are included to avoid
 * false positives when comparing against niche packages.
 */
const TOP_PACKAGES: string[] = [
  // Core utilities
  'lodash',
  'underscore',
  'ramda',
  'uuid',
  'nanoid',
  'semver',
  'chalk',
  'colors',
  'kleur',
  'ansi-styles',
  'glob',
  'minimatch',
  'micromatch',
  'rimraf',
  'mkdirp',
  'fs-extra',
  'path',
  'debug',
  'ms',
  'bytes',
  'mime',
  'mime-types',
  'dotenv',
  'cross-env',
  'env-paths',
  'moment',
  'dayjs',
  'date-fns',
  'luxon',
  'axios',
  'got',
  'node-fetch',
  'undici',
  'superagent',
  'request',
  'commander',
  'yargs',
  'minimist',
  'meow',
  'inquirer',
  'prompts',
  'ora',
  'listr2',
  'boxen',
  'figures',
  'execa',
  'cross-spawn',
  'which',
  'shebang-command',

  // Testing
  'jest',
  'mocha',
  'vitest',
  'chai',
  'sinon',
  'nock',
  'supertest',
  'jest-cli',
  'ts-jest',
  '@testing-library/react',

  // Build / Bundler
  'webpack',
  'vite',
  'rollup',
  'parcel',
  'esbuild',
  'swc',
  'babel',
  '@babel/core',
  '@babel/preset-env',
  '@babel/preset-react',
  'postcss',
  'autoprefixer',
  'tailwindcss',
  'sass',
  'typescript',
  'ts-node',
  'tsx',

  // Linting / Formatting
  'eslint',
  'prettier',
  'tslint',
  'stylelint',
  '@typescript-eslint/parser',
  '@typescript-eslint/eslint-plugin',

  // Frameworks
  'express',
  'koa',
  'fastify',
  'hapi',
  'restify',
  'feathers',
  'next',
  'nuxt',
  'gatsby',
  'remix',
  'astro',
  'sveltekit',
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  'vue',
  '@vue/core',
  'angular',
  '@angular/core',
  'svelte',
  'solid-js',
  'preact',

  // State management
  'redux',
  'mobx',
  'zustand',
  'jotai',
  'recoil',
  'valtio',
  'xstate',
  '@reduxjs/toolkit',
  'redux-saga',
  'redux-thunk',

  // Data fetching
  'react-query',
  '@tanstack/react-query',
  'swr',
  'apollo-client',
  'graphql',
  '@apollo/client',

  // Schema / Validation
  'zod',
  'yup',
  'joi',
  'ajv',
  'superstruct',
  'class-validator',

  // ORM / DB
  'prisma',
  'typeorm',
  'sequelize',
  'mongoose',
  'drizzle-orm',
  'pg',
  'mysql2',
  'sqlite3',
  'better-sqlite3',
  'redis',
  'ioredis',
  'mongodb',

  // Auth
  'jsonwebtoken',
  'passport',
  'bcrypt',
  'bcryptjs',
  'argon2',
  'cookie-parser',
  'express-session',

  // Utility
  'immer',
  'lodash-es',
  'clsx',
  'classnames',
  'slugify',
  'sharp',
  'jimp',
  'multer',
  'busboy',
  'form-data',
  'socket.io',
  'ws',
  'node-ipc',
  'cheerio',
  'jsdom',
  'playwright',
  'puppeteer',
  'csv-parse',
  'papaparse',
  'xlsx',
  'node-cron',
  'agenda',
  'bull',
  'bullmq',
  'winston',
  'pino',
  'bunyan',
  'loglevel',
  'nodemailer',
  'sendgrid',
  '@sendgrid/mail',
  'stripe',
  'paypal-rest-sdk',
  'aws-sdk',
  '@aws-sdk/client-s3',
];

export interface TyposquatResult {
  isSuspicious: boolean;
  similarTo: string | null;
  distance: number;
  reason: string;
}

/**
 * Returns a typosquat warning if the queried package:
 *   1. Has very low weekly downloads (under 10,000), AND
 *   2. Is within edit distance 2 of a highly popular package, AND
 *   3. Is not the popular package itself (exact match is fine).
 *
 * Distance 1 catches single-character insertions, deletions, substitutions,
 * and common mistakes like "lodahs", "loadsh", "next-js".
 * Distance 2 catches two-character mistakes like "reactt-dom".
 */
export function checkTyposquatting(packageName: string, weeklyDownloads: number): TyposquatResult {
  const NOT_SUSPICIOUS: TyposquatResult = {
    isSuspicious: false,
    similarTo: null,
    distance: Infinity,
    reason: '',
  };

  // Only flag packages with very low adoption
  if (weeklyDownloads >= 10_000) return NOT_SUSPICIOUS;

  // Strip scope prefix for comparison (@org/name -> name)
  const normalized = packageName.includes('/') ? packageName.split('/').pop()! : packageName;

  let closestMatch: string | null = null;
  let minDistance = Infinity;

  for (const popular of TOP_PACKAGES) {
    if (popular === packageName) return NOT_SUSPICIOUS; // exact match, safe

    const popularNorm = popular.includes('/') ? popular.split('/').pop()! : popular;
    const dist = levenshtein(normalized.toLowerCase(), popularNorm.toLowerCase());

    if (dist < minDistance) {
      minDistance = dist;
      closestMatch = popular;
    }
  }

  if (minDistance > 0 && minDistance <= 2 && closestMatch !== null) {
    return {
      isSuspicious: true,
      similarTo: closestMatch,
      distance: minDistance,
      reason:
        `"${packageName}" has very low adoption and closely resembles the popular package "${closestMatch}" ` +
        `(edit distance: ${minDistance}). This could be a typo or a typosquatting attempt.`,
    };
  }

  return NOT_SUSPICIOUS;
}
