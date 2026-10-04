'use client';

import { cva } from 'class-variance-authority';

const toggleVariants = cva(
	"group/toggle relative inline-flex min-w-0 after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] max-w-full items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-normal [overflow-wrap:anywhere] transition-colors duration-[120ms] ease-out outline-none hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: 'bg-transparent',
				outline:
					'border border-input bg-transparent hover:bg-muted aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground/90 aria-pressed:hover:text-background aria-pressed:active:bg-foreground/90 aria-pressed:active:text-background',
				segmented:
					'flex-1 bg-transparent text-foreground/75 hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border dark:aria-pressed:bg-foreground/15 dark:aria-pressed:ring-foreground/25',
			},
			size: {
				default:
					'min-h-8 min-w-8 h-auto px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
				sm: "min-h-8 min-w-8 h-auto rounded-[min(var(--radius-md),12px)] px-2.5 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
				lg: 'min-h-8 min-w-8 h-auto px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

export { toggleVariants };
