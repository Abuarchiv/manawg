import { cn } from '@/shared/lib/cn';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { type VariantProps, cva } from 'class-variance-authority';
import { isValidElement } from 'react';

const buttonVariantsRaw = cva(
	"group/button relative inline-flex max-w-full items-center justify-center rounded-lg border border-transparent bg-clip-padding text-center text-sm font-medium whitespace-normal [overflow-wrap:break-word] transition-[color,background-color,border-color,transform] duration-[80ms] ease-out motion-safe:active:scale-[0.97] motion-reduce:active:scale-100 motion-reduce:transition-none outline-none select-none after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-full after:min-w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] data-[bottom-nav-item]:after:hidden in-data-[slot=button-group]:after:min-w-0 in-data-[slot=input-group]:after:min-w-0 [@media(any-hover:hover)]:focus-visible:border-ring [@media(any-hover:hover)]:focus-visible:ring-3 [@media(any-hover:hover)]:focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					'bg-primary text-primary-foreground hover:bg-primary/80 active:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100',
				outline:
					'border-border bg-background text-foreground hover:bg-muted hover:text-foreground active:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-foreground/[0.045] dark:hover:bg-foreground/[0.075]',
				secondary:
					'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
				ghost:
					'hover:bg-muted hover:text-foreground active:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
				destructive:
					'bg-destructive/10 text-destructive-text hover:bg-destructive/20 active:bg-destructive/30 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
				'destructive-solid':
					'bg-destructive text-white hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:text-background dark:focus-visible:ring-destructive/40',
				link: 'text-primary underline underline-offset-4 active:text-primary/80',
			},
			size: {
				default:
					'min-h-8 h-auto gap-1.5 px-2.5 py-1 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
				xs: "min-h-6 h-auto gap-1 rounded-lg px-2 py-0.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
				sm: "min-h-8 h-auto gap-1 rounded-lg px-2.5 py-1 text-sm in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
				lg: 'min-h-9 h-auto gap-1.5 px-2.5 py-1 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
				icon: 'size-8',
				'icon-xs':
					"size-6 rounded-lg in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
				'icon-sm': 'size-8 rounded-lg in-data-[slot=button-group]:rounded-lg',
				'icon-lg': 'size-10',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

/**
 * Merged, so `<a className={buttonVariants({ variant: 'outline' })}>` does not keep the base
 * `border-transparent` next to the variant's `border-border` (the transparent one won in light mode).
 */
const buttonVariants = (props?: Parameters<typeof buttonVariantsRaw>[0]) =>
	cn(buttonVariantsRaw(props));

function Button({
	className,
	variant = 'default',
	size = 'default',
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	// Base UI adds role="button" to every non-native button, which makes a link-rendered button
	// (render={<Link href />} nativeButton={false}) announce as a button. It stays a link.
	const linkRole =
		props.nativeButton === false &&
		isValidElement<{ href?: string }>(props.render) &&
		props.render.props.href !== undefined
			? 'link'
			: undefined;
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size }), className)}
			{...(linkRole ? { role: linkRole } : {})}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
