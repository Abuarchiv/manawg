'use client';

import type * as React from 'react';
import { cn } from '@/shared/lib/cn';

function Label({ className, ...props }: React.ComponentProps<'label'>) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: this shared primitive receives htmlFor or a nested control from its caller.
		<label
			data-slot="label"
			className={cn(
				'flex items-center gap-2 text-[length:max(13px,0.8125rem)] font-sans leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
