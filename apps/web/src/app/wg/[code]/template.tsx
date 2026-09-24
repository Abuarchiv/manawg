'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

export default function WgPageTemplate({ children }: { children: ReactNode }) {
	const reduceMotion = useReducedMotion();
	const transition = reduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' as const };

	return (
		<motion.div
			initial={reduceMotion ? false : { opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={transition}
			className="min-w-0"
		>
			{children}
		</motion.div>
	);
}
