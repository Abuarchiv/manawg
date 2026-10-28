import type { ReactNode } from 'react';
import { ToastContainer } from '@/components/ui/Toast';

export default function SignupLayout({ children }: { children: ReactNode }) {
	return (
		<>
			{children}
			<ToastContainer />
		</>
	);
}
