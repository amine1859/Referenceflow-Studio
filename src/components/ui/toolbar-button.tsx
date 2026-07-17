import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ToolbarButtonProps = Omit<ButtonProps, 'size'> & {
  label: string;
  active?: boolean;
  danger?: boolean;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
};

export function ToolbarButton({
  label,
  active = false,
  danger = false,
  tooltipSide = 'right',
  className,
  children,
  ...props
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          title={label}
          className={cn(
            'text-muted-foreground hover:text-foreground',
            active && 'border-primary/25 bg-primary/14 text-primary hover:bg-primary/20 hover:text-primary',
            danger && 'hover:border-danger/20 hover:bg-danger/12 hover:text-danger',
            className,
          )}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
}
