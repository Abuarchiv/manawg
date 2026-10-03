import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
} from '@/components/ui/empty';
import { House } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
	title: 'Seite nicht gefunden — ManaWG',
};

export default function NotFound() {
	return (
		<main
			id="main"
			tabIndex={-1}
			className="flex min-h-svh flex-col items-center justify-center bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-center focus:outline-none"
		>
			<div className="w-full max-w-md">
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<House aria-hidden />
						</EmptyMedia>
						<h1
							data-slot="empty-title"
							className="min-w-0 max-w-full text-lg font-semibold [overflow-wrap:anywhere]"
						>
							Seite nicht gefunden
						</h1>
						<EmptyDescription>Prüfe den Link oder geh zurück zur Startseite.</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button size="lg" render={<Link href="/" />} nativeButton={false}>
							Zur Startseite
						</Button>
					</EmptyContent>
				</Empty>
			</div>
		</main>
	);
}
