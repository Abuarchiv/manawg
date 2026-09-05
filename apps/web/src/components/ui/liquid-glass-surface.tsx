'use client';

import { cn } from '@/shared/lib/cn';
import { type ForwardedRef, type HTMLAttributes, forwardRef, useCallback } from 'react';
import { LiquidGlass, type LiquidGlassHandle } from 'simple-liquid-glass';

export type LiquidGlassSurfaceProps = HTMLAttributes<HTMLDivElement>;

function assignRef<T>(ref: ForwardedRef<T>, value: T | null): void {
	if (typeof ref === 'function') ref(value);
	else if (ref) ref.current = value;
}

export const LiquidGlassSurface = forwardRef<HTMLDivElement, LiquidGlassSurfaceProps>(
	function LiquidGlassSurface({ className, style, ...props }, ref) {
		const bridgeRef = useCallback(
			(handle: LiquidGlassHandle | null) => assignRef(ref, handle?.element ?? null),
			[ref],
		);

		return (
			<LiquidGlass
				{...props}
				{...(style ? { style } : {})}
				ref={bridgeRef}
				mode="preset"
				effectMode="blur"
				mobileFallback="css-only"
				className={cn('liquid-glass-surface', className)}
			/>
		);
	},
);

LiquidGlassSurface.displayName = 'LiquidGlassSurface';
