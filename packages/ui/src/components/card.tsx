import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn('border-b border-slate-200 px-4 py-3 dark:border-slate-800', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: CardProps) {
  return (
    <div className={cn('px-4 py-3', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn('border-t border-slate-200 px-4 py-3 dark:border-slate-800', className)}
      {...rest}
    >
      {children}
    </div>
  );
}
