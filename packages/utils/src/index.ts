import { nanoid } from 'nanoid';
import { createHash } from 'crypto';
import clsx, { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(...inputs));
}

export const generateId = (prefix?: string): string => {
  const id = nanoid(16);
  return prefix ? `${prefix}_${id}` : id;
};

export const generateShortId = (length = 8): string => nanoid(length);

export const generateQRToken = (): string => {
  return nanoid(6).toUpperCase();
};

export const generateOrderNumber = (branchCode: string, sequence: number): string => {
  const padded = sequence.toString().padStart(5, '0');
  return `${branchCode}-${padded}`;
};

export const generateIdempotencyKey = (
  entityType: string,
  entityUniqueInput: string
): string => {
  const base = `${entityType}:${entityUniqueInput}:${Date.now()}`;
  return createHash('sha256').update(base).digest('hex');
};

export const formatMoney = (
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount / 100);
};

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (amount: number): number => amount / 100;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const retry = async <T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 3,
    delayMs = 1000,
    backoff = 2,
    onError,
  }: {
    maxAttempts?: number;
    delayMs?: number;
    backoff?: number;
    onError?: (err: Error, attempt: number) => void;
  } = {}
): Promise<T> => {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      onError?.(lastError, attempt);
      if (attempt < maxAttempts) {
        await sleep(delayMs * Math.pow(backoff, attempt - 1));
      }
    }
  }
  throw lastError;
};
