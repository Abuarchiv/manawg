import { ToastContainer } from '@/components/ui/Toast';
import type { ReactNode } from 'react';

export default function RegistrierenLayout({ children }: { children: ReactNode }) {
	return (
		<>
			{children}
			<ToastContainer />
		</>
	);
}
