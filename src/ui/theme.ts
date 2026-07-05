import chalk from 'chalk';

export const theme = {
  colors: {
    primary: chalk.hex('#6366f1'), // Beautiful Indigo
    secondary: chalk.hex('#a5b4fc'), // Light Indigo
    accent: chalk.hex('#f43f5e'), // Soft Rose
    muted: chalk.hex('#64748b'), // Slate Muted
    success: chalk.hex('#10b981'), // Modern Emerald
    warning: chalk.hex('#f59e0b'), // Soft Amber
    danger: chalk.hex('#ef4444'), // Red
    info: chalk.hex('#06b6d4'), // Cyan
  },
  icons: {
    bullet: '✦',
    success: '✔',
    failure: '✖',
    warning: '⚠',
    info: 'ℹ',
    arrow: '→',
    star: '★',
    download: '↓',
  },
  getScoreColor(score: number) {
    if (score >= 90) return chalk.hex('#10b981').bold; // Emerald
    if (score >= 75) return chalk.hex('#06b6d4').bold; // Cyan
    if (score >= 50) return chalk.hex('#f59e0b').bold; // Amber
    return chalk.hex('#ef4444').bold; // Red
  },
  getRecommendationStyle(rec: string) {
    switch (rec) {
      case 'Highly Recommended':
        return chalk.hex('#10b981').bold;
      case 'Recommended':
        return chalk.hex('#06b6d4').bold;
      case 'Recommended with Reservations':
        return chalk.hex('#f59e0b').bold; // Amber — trust concern softens a good score
      case 'Use With Caution':
        return chalk.hex('#f97316').bold; // Orange — clear warning
      case 'Caution':
        return chalk.hex('#f59e0b').bold;
      case 'Not Recommended':
      default:
        return chalk.hex('#ef4444').bold;
    }
  },
};
