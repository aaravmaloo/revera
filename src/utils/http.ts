import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as logger from './logger.js';

export async function requestWithRetry<T = any>(
  config: AxiosRequestConfig & { url: string },
  retries = 3,
  delayMs = 1000,
): Promise<AxiosResponse<T>> {
  try {
    return await axios(config);
  } catch (err: any) {
    const status = err.response?.status;
    const isRateLimit = status === 429 || (status === 403 && err.response?.headers?.['x-ratelimit-remaining'] === '0');
    const isServerError = status >= 500 && status < 600;
    const isTransientNetwork = err.code === 'ECONNRESET' || err.code === 'EPIPE';

    if ((isRateLimit || isServerError || isTransientNetwork) && retries > 0) {
      // If server specifies a Retry-After header, honor it (in seconds)
      const retryAfterHeader = err.response?.headers?.['retry-after'];
      const waitTime = isRateLimit && retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : delayMs;

      logger.info(`Request to ${config.url} failed (${err.message}). Retrying in ${waitTime}ms... (${retries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return requestWithRetry(config, retries - 1, delayMs * 2);
    }
    throw err;
  }
}
