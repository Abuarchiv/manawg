'use client';

import { LazyMotion } from 'motion/react';
import type { ReactNode } from 'react';

// The animation features load as a separate chunk; until then the `m` components render
// their initial values and animate afterwards.
const loadFeatures = () => import('./motion-dom-animation').then((mod) => mod.default);

export function MotionFeatures({ children }: { children: ReactNode }) {
	return <LazyMotion features={loadFeatures}>{children}</LazyMotion>;
}
