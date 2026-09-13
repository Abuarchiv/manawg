'use client';

import { cn } from '@/shared/lib/cn';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

function Switch({
	className,
	size = 'default',
	...props
}: SwitchPrimitive.Root.Props & {
	size?: 'sm' | 'default';
}) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(
				'peer group/switch relative inline-flex h-11 w-11 shrink-0 items-center rounded-[22px] border border-transparent bg-transparent outline-none group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:pointer-events-none before:rounded-[15px] before:content-[""] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:w-[68px] data-[size=default]:before:h-[30px] data-[size=default]:before:w-[68px] data-[size=default]:before:rounded-[15px] data-[size=sm]:before:h-3.5 data-[size=sm]:before:w-6 data-[size=sm]:before:rounded-full dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:before:bg-primary data-unchecked:before:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50',
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none absolute top-[9.5px] left-[2.5px] block rounded-[12.5px] bg-background ring-0 transition-[left,top,width,height] duration-[280ms] ease-[cubic-bezier(0.34,1.28,0.64,1)] group-data-[size=default]/switch:h-[25px] group-data-[size=default]/switch:w-[38px] group-data-[size=default]/switch:data-checked:left-[27.5px] group-data-[size=default]/switch:group-active/switch:top-[2.5px] group-data-[size=default]/switch:group-active/switch:left-[-8px] group-data-[size=default]/switch:group-active/switch:h-[39px] group-data-[size=default]/switch:group-active/switch:w-[59px] group-data-[checked]/switch:group-active/switch:left-[17px] group-data-[size=sm]/switch:top-4 group-data-[size=sm]/switch:left-2.5 group-data-[size=sm]/switch:size-3 group-data-[size=sm]/switch:rounded-full group-data-[size=sm]/switch:data-checked:left-5 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
