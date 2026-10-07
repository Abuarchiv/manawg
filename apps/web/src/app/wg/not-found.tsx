import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
} from '@/components/ui/empty';
import { SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

// Lives in app/wg (not app/wg/[code]): a not-found file does not catch notFound()
// thrown by the layout of its own segment, the parent segment's boundary does.
export const metadata: Metadata = {
	title: 'WG nicht gefunden — ManaWG',
	robots: { index: false, follow: false },
};

export default function WgNotFound() {
	return (
		<main
			id="main"
			tabIndex={-1}
			className="flex min-h-svh items-center justify-center bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] focus:outline-none"
		>
			<Card className="w-full max-w-md">
				<CardContent className="pt-6">
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<SearchX aria-hidden />
							</EmptyMedia>
							<h1
								data-slot="empty-title"
								className="min-w-0 max-w-full text-base font-semibold [overflow-wrap:break-word]"
							>
								WG nicht gefunden
							</h1>
							<EmptyDescription>
								Der 8-stellige Code ist falsch oder die WG wurde gelöscht.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button
								variant="outline"
								size="lg"
								render={<Link href="/neu" />}
								nativeButton={false}
							>
								Neue WG erstellen oder beitreten
							</Button>
						</EmptyContent>
					</Empty>
				</CardContent>
			</Card>
		</main>
	);
}
