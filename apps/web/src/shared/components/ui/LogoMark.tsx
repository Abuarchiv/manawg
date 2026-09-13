'use client';

import { type ComponentProps, useId } from 'react';
import { BRAND } from '../../lib/brand';
import geometry from '../../lib/brand-mark.json';
import { cn } from '../../lib/cn';
import styles from './brand-mark.module.css';

interface LogoMarkProps extends ComponentProps<'svg'> {
	size?: number;
	tile?: boolean;
	tileFill?: string;
	markFill?: string;
	radius?: ComponentProps<'svg'>['radius'];
	loading?: boolean;
}

/** The supplied eight-body organism. Unique mask IDs allow multiple marks per page. */
export function LogoMark({
	size = 40,
	tile = true,
	className,
	tileFill = 'var(--primary)',
	markFill,
	radius = 0,
	loading = false,
	...props
}: LogoMarkProps) {
	const id = useId().replace(/:/g, '');
	const filterId = `mana-goo-${id}`;
	const maskId = `mana-hole-${id}`;
	const aperture = size <= 20 ? 34 : size <= 32 ? 26 : geometry.aperture.r;
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={size}
			height={tile ? size : (size * geometry.height) / geometry.width}
			viewBox={tile ? '0 0 512 512' : '0 0 416 346'}
			role="img"
			aria-label={BRAND.wordmark}
			data-brand-mark="organism"
			className={cn('shrink-0', loading && styles.loading, className)}
			{...props}
		>
			<defs>
				<filter id={filterId} x="-12%" y="-12%" width="124%" height="124%">
					<feGaussianBlur stdDeviation={geometry.blur} />
					<feColorMatrix type="matrix" values={geometry.matrix} />
				</filter>
				<mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="416" height="346">
					<g filter={`url(#${filterId})`} fill="white">
						{geometry.bodies.map((body) => (
							<circle key={body.cx} {...body} className={loading ? styles.body : undefined} />
						))}
					</g>
					<circle cx={geometry.aperture.cx} cy={geometry.aperture.cy} r={aperture} fill="black" />
				</mask>
			</defs>
			{tile && <rect width="512" height="512" rx={radius} fill={tileFill} />}
			<g transform={tile ? 'translate(97.28 123.98) scale(0.763077)' : undefined}>
				<rect
					width="416"
					height="346"
					fill={markFill ?? (tile ? 'var(--primary-foreground)' : 'currentColor')}
					mask={`url(#${maskId})`}
				/>
			</g>
		</svg>
	);
}

interface BrandLockupProps {
	size?: number;
	className?: string;
	wordmarkClassName?: string;
}

export function BrandLockup({
	size = 28,
	className = 'flex items-center gap-2',
	wordmarkClassName = 'font-heading text-xl font-semibold tracking-[-0.03em] text-foreground',
}: BrandLockupProps) {
	return (
		<span className={className}>
			<LogoMark size={size} tile={false} aria-hidden="true" />
			<span className={wordmarkClassName}>{BRAND.wordmark}</span>
		</span>
	);
}
