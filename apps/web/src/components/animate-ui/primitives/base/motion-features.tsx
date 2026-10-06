'use client';

import { LazyMotion } from 'motion/react';
import type { ReactNode } from 'react';

// Die Animations-Features laden als eigener Chunk nach; die `m`-Komponenten rendern bis dahin
// ihre Startwerte (initial) und animieren danach wie zuvor.
const loadFeatures = () => import('./motion-dom-animation').then((mod) => mod.default);

export function MotionFeatures({ children }: { children: ReactNode }) {
	return <LazyMotion features={loadFeatures}>{children}</LazyMotion>;
}
