import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { SearchX } from 'lucide-react';
import Link from 'next/link';

// craftsman-ignore: TS002 — Next.js App Router requires default export for not-found pages
export default function WgNotFound() {
	return (
		<div className="flex min-h-[calc(100svh-4.25rem)] items-center justify-center bg-background px-4 pb-[env(safe-area-inset-bottom)]">
			<Card className="w-full max-w-md">
				<CardContent className="pt-6">
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<SearchX aria-hidden />
							</EmptyMedia>
							<EmptyTitle>WG nicht gefunden</EmptyTitle>
							<EmptyDescription>8-stelliger Code falsch oder WG wurde gelöscht.</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button
								variant="outline"
								size="lg"
								render={<Link href="/neu" />}
								nativeButton={false}
								className="min-h-11"
							>
								Neue WG erstellen oder beitreten
							</Button>
						</EmptyContent>
					</Empty>
				</CardContent>
			</Card>
		</div>
	);
}
