import fs from 'node:fs';
import path from 'node:path';
import { getAevixDir } from './config.js';

let logStream: fs.WriteStream | null = null;

function getLogStream(): fs.WriteStream {
  if (logStream) return logStream;

  const logsDir = path.join(getAevixDir(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logFile = path.join(logsDir, 'aevix.log');
  logStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });
  return logStream;
}

export function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: any): void {
  try {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] [${level}] ${message}${metaStr}\n`;
    getLogStream().write(line);
  } catch (err) {
    // Fail-safe: don't crash the CLI if logging fails
  }
}

export function info(message: string, meta?: any): void {
  log('INFO', message, meta);
}

export function warn(message: string, meta?: any): void {
  log('WARN', message, meta);
}

export function error(message: string, meta?: any): void {
  log('ERROR', message, meta);
}

export function closeLogger(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}
