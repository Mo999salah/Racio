import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

export const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--ink)] text-[var(--canvas)] hover:bg-[var(--ink-soft)]',
        quiet: 'bg-transparent text-[var(--ink)] hover:bg-[var(--surface-strong)]',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, className }))} {...props} />
  ),
);
Button.displayName = 'Button';
