import chalk from 'chalk';
import { loadConfig, saveConfig, AevixConfig } from '../utils/config.js';
import { theme } from '../ui/theme.js';

export function handleConfigGet(key: string): void {
  const config = loadConfig();
  if (!(key in config)) {
    console.error(chalk.red(`Error: Invalid configuration key "${key}".`));
    process.exit(1);
  }
  const val = config[key as keyof AevixConfig];
  console.log(val !== undefined ? val : '');
}

export function handleConfigSet(key: string, value: string): void {
  const config = loadConfig();
  if (!(key in config)) {
    console.error(chalk.red(`Error: Invalid configuration key "${key}".`));
    process.exit(1);
  }

  const updated: Partial<AevixConfig> = {};

  try {
    if (key === 'cacheTtlMs' || key === 'minScoreThreshold') {
      const num = parseInt(value, 10);
      if (isNaN(num)) throw new Error('Value must be a valid number');
      if (key === 'minScoreThreshold' && (num < 0 || num > 100)) {
        throw new Error('minScoreThreshold must be between 0 and 100');
      }
      updated[key] = num;
    } else if (key === 'installSuggest') {
      const normalized = value.toLowerCase().trim();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        updated[key] = true;
      } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        updated[key] = false;
      } else {
        throw new Error('Value must be a boolean (true/false)');
      }
    } else if (key === 'theme') {
      const val = value.toLowerCase().trim();
      if (val !== 'dark' && val !== 'light' && val !== 'glass') {
        throw new Error('Theme must be "dark", "light", or "glass"');
      }
      updated[key] = val;
    } else if (key === 'packageManager') {
      const val = value.toLowerCase().trim();
      const valid = ['npm', 'pnpm', 'yarn', 'bun', 'auto'];
      if (!valid.includes(val)) {
        throw new Error(`Package manager must be one of: ${valid.join(', ')}`);
      }
      updated[key] = val as any;
    } else if (key === 'githubToken') {
      updated[key] = value.trim();
    }

    const saved = saveConfig(updated);
    console.log(
      chalk.green(
        `${theme.icons.success}  Updated: ${chalk.bold(key)} = ${chalk.bold(String(saved[key as keyof AevixConfig]))}`
      )
    );
  } catch (err: any) {
    console.error(chalk.red(`Error setting config: ${err.message}`));
    process.exit(1);
  }
}

export function handleConfigList(): void {
  const config = loadConfig();

  const hideToken = (t?: string) => {
    if (!t) return chalk.italic.gray('not set');
    if (t.length <= 8) return '********';
    return `${t.slice(0, 4)}...${t.slice(-4)}`;
  };

  console.log();
  console.log(theme.colors.primary.bold('  ▲ AEVIX CONFIGURATION'));
  console.log(theme.colors.muted('  ' + '─'.repeat(45)));

  const rows: [string, string, string][] = [
    ['githubToken',       hideToken(config.githubToken),              'string'],
    ['cacheTtlMs',        config.cacheTtlMs.toString(),               'number'],
    ['minScoreThreshold', config.minScoreThreshold.toString(),        'number'],
    ['installSuggest',    config.installSuggest ? 'true' : 'false',   'boolean'],
    ['packageManager',    config.packageManager,                      'string'],
    ['theme',             config.theme,                               'string'],
  ];

  for (const [key, val, type] of rows) {
    const keyStr  = chalk.white(key.padEnd(22));
    const valStr  = key === 'installSuggest'
      ? (val === 'true' ? chalk.green(val) : chalk.red(val))
      : chalk.cyan(val);
    const typeStr = chalk.gray(type);
    console.log(`  ${keyStr} ${valStr.padEnd(20)}  ${typeStr}`);
  }

  console.log();
  console.log(chalk.dim('  Config path: ~/.aevix/config.json'));
  console.log();
}
