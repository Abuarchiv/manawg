'use client';

import { cn } from '@/shared/lib/cn';
import { type ForwardedRef, forwardRef, useCallback } from 'react';
import { LiquidGlass, type LiquidGlassHandle, type LiquidGlassProps } from 'simple-liquid-glass';

export type LiquidGlassSurfaceProps = Omit<LiquidGlassProps, 'mode' | 'effectMode'>;

function assignRef<T>(ref: ForwardedRef<T>, value: T | null): void {
	if (typeof ref === 'function') ref(value);
	else if (ref) ref.current = value;
}

export const LiquidGlassSurface = forwardRef<HTMLDivElement, LiquidGlassSurfaceProps>(
	function LiquidGlassSurface({ className, ...props }, ref) {
		const bridgeRef = useCallback(
			(handle: LiquidGlassHandle | null) => assignRef(ref, handle?.element ?? null),
			[ref],
		);

		return (
			<LiquidGlass
				ref={bridgeRef}
				mode="preset"
				effectMode="blur"
				mobileFallback="css-only"
				className={cn('liquid-glass-surface', className)}
				{...props}
			/>
		);
	},
);

LiquidGlassSurface.displayName = 'LiquidGlassSurface';
