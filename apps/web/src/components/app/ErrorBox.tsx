import { Alert, AlertDescription } from '@/components/ui/alert';
import type { ReactNode } from 'react';

export function ErrorBox({ children, id }: { children: ReactNode; id?: string }) {
	return (
		<Alert variant="destructive" id={id}>
			<AlertDescription>{children}</AlertDescription>
		</Alert>
	);
}
