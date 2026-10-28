import type { ReactNode } from 'react';
import { ToastContainer } from '@/components/ui/Toast';

export default function RegistrierenLayout({ children }: { children: ReactNode }) {
	return (
		<>
			{children}
			<ToastContainer />
		</>
	);
}
