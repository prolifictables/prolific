export const retryableStatusCodes = [0, 408, 429, 500, 502, 503, 504];

export function calculateExponentialBackoff(
  attempts: number,
  baseMs: number = 1000,
  maxMs: number = 5 * 60 * 1000,
  jitter: boolean = true
): number {
  if (attempts <= 0) return 0;
  const cappedAttempts = Math.min(attempts, 30);
  const exponential = baseMs * Math.pow(2, cappedAttempts - 1);
  const capped = Math.min(exponential, maxMs);
  if (!jitter) return capped;
  const jitterFactor = 0.75 + Math.random() * 0.5;
  return Math.floor(capped * jitterFactor);
}

export function isRetryableStatusCode(statusCode: number): boolean {
  return retryableStatusCodes.includes(statusCode);
}
