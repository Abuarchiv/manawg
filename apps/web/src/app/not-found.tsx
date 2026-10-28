import { House } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
} from '@/components/ui/empty';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.notFound');
	return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function NotFound() {
	const t = await getTranslations('shell.notFound');
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
							className="min-w-0 max-w-full text-lg font-semibold [overflow-wrap:break-word]"
						>
							{t('title')}
						</h1>
						<EmptyDescription>{t('description')}</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button size="lg" render={<Link href="/" />} nativeButton={false}>
							{t('toHome')}
						</Button>
					</EmptyContent>
				</Empty>
			</div>
		</main>
	);
}
