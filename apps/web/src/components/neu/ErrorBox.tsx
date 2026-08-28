import { ALERT_DANGER } from '@/components/ui/styles';
import type { ReactNode } from 'react';

export function ErrorBox({ children, id }: { children: ReactNode; id?: string }) {
	return (
		<p id={id} role="alert" aria-live="assertive" className={ALERT_DANGER}>
			{children}
		</p>
	);
}
