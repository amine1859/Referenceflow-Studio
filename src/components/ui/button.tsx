import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium outline-none transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'border border-primary/80 bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(94,107,255,0.24)] hover:-translate-y-px hover:bg-primary/90 hover:shadow-[0_10px_30px_rgba(94,107,255,0.32)]',
        secondary: 'border border-border bg-card text-foreground shadow-sm hover:-translate-y-px hover:border-border-strong hover:bg-surface-elevated',
        ghost: 'border border-transparent bg-transparent text-muted-foreground hover:bg-surface-elevated hover:text-foreground',
        outline: 'border border-border bg-background/35 text-foreground hover:border-border-strong hover:bg-surface-elevated',
        danger: 'border border-danger/35 bg-danger/12 text-danger hover:bg-danger hover:text-white',
      },
      size: {
        sm: 'h-8 rounded-lg px-3 text-xs [&_svg]:size-3.5',
        md: 'h-10 px-4 [&_svg]:size-4',
        lg: 'h-11 px-5 [&_svg]:size-4.5',
        icon: 'size-9 p-0 [&_svg]:size-4',
        'icon-sm': 'size-8 rounded-lg p-0 [&_svg]:size-3.5',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : 'button';
    return <Component ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
