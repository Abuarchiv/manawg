import {
	Switch as SwitchPrimitive,
	type SwitchProps,
	SwitchThumb as SwitchThumbPrimitive,
} from '@/components/animate-ui/primitives/base/switch';
import { cn } from '@/shared/lib/cn';

function Switch({ className, ...props }: SwitchProps) {
	return (
		<SwitchPrimitive
			className={cn(
				// No border: it would shrink the 68px track and push the thumb off-centre. Height in px: the thumb is positioned in px, a rem height would drift apart at 200 % text.
				'group/switch relative isolate peer inline-flex h-[44px] w-[68px] shrink-0 items-center rounded-[22px] border-0 bg-transparent px-0 outline-none before:absolute before:inset-x-0 before:top-1/2 before:h-[30px] before:-translate-y-1/2 before:pointer-events-none before:rounded-[15px] before:bg-(--switch-track) before:content-[""] focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
				// The thumb's pressed glass paints this colour too.
				'[--switch-track:var(--input)] data-[checked]:[--switch-track:var(--primary)] dark:data-[unchecked]:[--switch-track:color-mix(in_oklab,var(--muted-foreground)_60%,transparent)]',
				className,
			)}
			{...props}
		>
			<SwitchThumbPrimitive className="pointer-events-none absolute z-10 block rounded-full bg-background transition-[left,top,width,height,box-shadow,background-color,opacity] duration-[280ms] ease-[cubic-bezier(0.34,1.28,0.64,1)] dark:data-[checked]:bg-primary-foreground dark:data-[unchecked]:bg-foreground" />
		</SwitchPrimitive>
	);
}

export { Switch };
