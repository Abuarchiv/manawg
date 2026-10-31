'use client';

import { LazyMotion } from 'motion/react';
import type { ReactNode } from 'react';
import domAnimation from './motion-dom-animation';

export function MotionFeatures({ children }: { children: ReactNode }) {
	return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}
