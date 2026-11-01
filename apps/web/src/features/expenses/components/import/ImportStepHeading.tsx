import type { ReactNode, Ref } from 'react';

/** Step title; the wizard moves focus here when the step changes. */
export function ImportStepHeading({
	headingRef,
	children,
}: {
	headingRef: Ref<HTMLHeadingElement>;
	children: ReactNode;
}) {
	return (
		<h2
			ref={headingRef}
			tabIndex={-1}
			className="text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{children}
		</h2>
	);
}
