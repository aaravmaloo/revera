import chalk from 'chalk';
import { clearCache, getCacheInfo, getCachePath } from '../utils/cache.js';
import { theme } from '../ui/theme.js';
import path from 'node:path';

export function handleCacheClear(): void {
  try {
    clearCache();
    console.log(chalk.green(`${theme.icons.success}  Successfully cleared Aevix API cache!`));
  } catch (err: any) {
    console.error(chalk.red(`Failed to clear cache: ${err.message}`));
    process.exit(1);
  }
}

export function handleCacheStatus(): void {
  const info = getCacheInfo();
  const sizeMB = (info.sizeBytes / (1024 * 1024)).toFixed(3);
  console.log(theme.colors.primary.bold('\nAEVIX CACHE STATUS'));
  console.log(`  - Total Files:  ${chalk.white(info.fileCount)}`);
  console.log(`  - Cache Size:   ${chalk.white(sizeMB)} MB`);
  console.log(`  - Cache Path:   ${chalk.gray(path.dirname(getCachePath('test', 'test')))}`);
  console.log();
}
