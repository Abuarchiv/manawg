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
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

// Lives in app/wg (not app/wg/[code]): a not-found file does not catch notFound()
// thrown by the layout of its own segment, the parent segment's boundary does.
export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.wg');
	return { title: t('notFound'), robots: { index: false, follow: false } };
}

export default async function WgNotFound() {
	const t = await getTranslations('shell.wgNotFound');
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
								{t('title')}
							</h1>
							<EmptyDescription>{t('description')}</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button
								variant="outline"
								size="lg"
								render={<Link href="/neu" />}
								nativeButton={false}
							>
								{t('create')}
							</Button>
						</EmptyContent>
					</Empty>
				</CardContent>
			</Card>
		</main>
	);
}
