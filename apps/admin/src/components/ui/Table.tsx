'use client';

import { cn } from '@/lib/cn';
import React from 'react';

export interface Column<T> {
  key: string;
  title: React.ReactNode;
  render?: (row: T) => React.ReactNode;
  accessor?: keyof T;
  className?: string;
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyText?: string;
  onRowClick?: (row: T) => void;
  className?: string;
  headerClassName?: string;
  rowClassName?: (row: T) => string | undefined;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  rowKey,
  loading,
  emptyText = 'No data',
  onRowClick,
  className,
  headerClassName,
  rowClassName,
}: DataTableProps<T>) {
  return (
    <div className={cn('w-full overflow-auto scrollbar-thin', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className={cn(
            'border-b border-slate-200 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wider text-slate-500',
            headerClassName
          )}>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-4 py-3 whitespace-nowrap',
                  col.className
                )}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-16 text-center">
                <div className="flex flex-col items-center gap-3">
                  <svg className="animate-spin h-8 w-8 text-brand-600" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
                  </svg>
                  <span className="text-sm text-slate-500">Loading...</span>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-16 text-center text-slate-400 text-sm">
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-brand-50/40',
                  rowClassName?.(row)
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn('px-4 py-3 align-middle', col.className)}
                  >
                    {col.render ? col.render(row) : String((row as any)[col.accessor || col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
