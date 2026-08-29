import clsx, { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export * from './components/Button';
export * from './components/Card';
export * from './components/Badge';
export * from './components/Input';
