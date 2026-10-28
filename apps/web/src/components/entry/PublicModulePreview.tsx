import type { LucideIcon } from 'lucide-react';
import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { cn } from '@/shared/lib/cn';
import type { PublicModuleSlug } from './public-modules';

export interface PublicPreviewModule {
	slug: PublicModuleSlug;
	title: string;
	Icon: LucideIcon;
}

const ROW = 'min-h-11 rounded-none border-0 border-t border-border px-0 first:border-t-0';

const SHOPPING_ROWS = [
	['milk', false],
	['bananas', false],
	['dish', true],
] as const;

function PreviewRows({ module }: { module: PublicPreviewModule }) {
	const t = useTranslations('entry.preview');
	const copy = { title: t(`${module.slug}.title`), detail: t(`${module.slug}.detail`) };

	if (module.slug === 'einkauf') {
		return (
			<ItemGroup className="gap-0">
				{SHOPPING_ROWS.map(([row, done]) => (
					<ItemEntry key={row} className={ROW}>
						<ItemMedia>
							<span
								aria-hidden
								className="flex size-5 items-center justify-center rounded-[6px] border border-input"
							>
								{done && <Check className="size-3.5" />}
							</span>
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle
								className={cn(
									'line-clamp-none break-words',
									done && 'text-muted-foreground line-through',
								)}
							>
								{t(`rows.${row}.title`)}
								{done && <span className="sr-only">{t('done')}</span>}
							</ItemTitle>
							<ItemDescription className="line-clamp-none break-words">
								{t(`rows.${row}.detail`)}
							</ItemDescription>
						</ItemContent>
					</ItemEntry>
				))}
			</ItemGroup>
		);
	}

	if (module.slug === 'ausgaben') {
		return (
			<ItemGroup className="gap-0">
				<ItemEntry className={ROW}>
					<ItemMedia variant="icon">
						<module.Icon aria-hidden />
					</ItemMedia>
					<ItemContent className="min-w-[10ch]">
						<ItemTitle className="line-clamp-none [overflow-wrap:break-word]">
							{copy.title}
						</ItemTitle>
						<ItemDescription className="line-clamp-none [overflow-wrap:break-word]">
							{copy.detail}
						</ItemDescription>
					</ItemContent>
					<ItemActions className="ml-auto shrink-0 font-mono text-sm whitespace-nowrap tabular-nums">
						{t('amount')}
					</ItemActions>
				</ItemEntry>
			</ItemGroup>
		);
	}

	if (module.slug === 'putzen') {
		return (
			<ItemGroup className="gap-0">
				<ItemEntry className={ROW}>
					<ItemMedia>
						<Avatar size="sm">
							<AvatarFallback>{t('initials')}</AvatarFallback>
						</Avatar>
					</ItemMedia>
					<ItemContent className="min-w-0">
						<ItemTitle className="line-clamp-none break-words">{copy.title}</ItemTitle>
						<ItemDescription className="line-clamp-none break-words">{copy.detail}</ItemDescription>
					</ItemContent>
				</ItemEntry>
			</ItemGroup>
		);
	}

	return (
		<ItemGroup className="gap-0">
			<ItemEntry className={ROW}>
				<ItemMedia variant="icon">
					<module.Icon aria-hidden />
				</ItemMedia>
				<ItemContent className="min-w-0">
					<ItemTitle className="line-clamp-none break-words">{copy.title}</ItemTitle>
					<ItemDescription className="line-clamp-none break-words">{copy.detail}</ItemDescription>
				</ItemContent>
			</ItemEntry>
		</ItemGroup>
	);
}

export function PublicModulePreviews({
	modules,
	hrefFor,
}: {
	modules: PublicPreviewModule[];
	hrefFor: (slug: string) => string;
}) {
	const t = useTranslations('entry.preview');
	return (
		<section aria-label={t('introLabel')}>
			<p className="px-1 pb-1.5 text-xs text-muted-foreground">{t('intro')}</p>
			<Card className="py-0">
				<div className="flex flex-col">
					{modules.map((module) => {
						return (
							<article
								key={module.slug}
								aria-label={t('article', { title: module.title })}
								className="@container"
							>
								<Item
									render={<Link href={hrefFor(module.slug)} />}
									className="min-h-11 rounded-none border-0 border-t border-border px-4 py-2.5 in-[article:first-child]:border-t-0"
								>
									<ItemMedia variant="icon" className="@max-[13rem]:hidden">
										<module.Icon aria-hidden />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle className="line-clamp-none break-words">{module.title}</ItemTitle>
										<ItemDescription className="line-clamp-none break-words">
											{t(`${module.slug}.title`)} · {t(`${module.slug}.detail`)}
										</ItemDescription>
									</ItemContent>
									<ChevronRight
										className="size-4 shrink-0 text-muted-foreground @max-[13rem]:hidden"
										aria-hidden
									/>
								</Item>
							</article>
						);
					})}
				</div>
			</Card>
		</section>
	);
}

export function PublicModulePreview({ module }: { module: PublicPreviewModule }) {
	const t = useTranslations('entry.preview');
	return (
		<section aria-label={t('section', { title: module.title })}>
			<article aria-label={t('article', { title: module.title })}>
				<Card className="h-full">
					<CardContent>
						<span className="mb-1 block text-right text-xs text-muted-foreground">
							{t('example')}
						</span>
						<PreviewRows module={module} />
					</CardContent>
				</Card>
			</article>
		</section>
	);
}
