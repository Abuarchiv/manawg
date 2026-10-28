import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ToastContainer } from '@/components/ui/Toast';

export const metadata: Metadata = {
	title: 'WG erstellen oder beitreten',
	description: 'WG erstellen oder mit einer Einladung beitreten.',
	robots: { index: false, follow: false },
};

export default function NeuLayout({ children }: { children: ReactNode }) {
	return (
		<>
			{children}
			<ToastContainer />
		</>
	);
}
