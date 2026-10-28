import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function ErrorBox({ children, id }: { children: ReactNode; id?: string }) {
	return (
		<Alert variant="destructive" id={id}>
			<AlertDescription>{children}</AlertDescription>
		</Alert>
	);
}
