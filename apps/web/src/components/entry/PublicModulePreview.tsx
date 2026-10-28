import type { LucideIcon } from 'lucide-react';
import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
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

interface PreviewCopy {
	title: string;
	detail: string;
}

const PREVIEW_COPY = {
	einkauf: { title: 'Hafermilch', detail: '2 Packungen · von Mika' },
	ausgaben: { title: 'Pizzaabend', detail: 'Mika bezahlt · 4 Personen' },
	putzen: { title: 'Bad putzen', detail: 'Lea · heute' },
	pinnwand: { title: 'Übergabe am Freitag', detail: 'Jona · Schlüssel liegen im Flur bereit.' },
	fixkosten: { title: 'Internet', detail: '29,99 € monatlich · nächste Zahlung am 3. des Monats' },
	mahnungen: { title: 'Jona bekommt 12,50 €', detail: 'Geteilt aus dem Einkauf · seit 2 Tagen' },
	vorraete: { title: 'Toilettenpapier', detail: '2 Packungen · Mindestbestand 1' },
	kalender: { title: 'Putzplan-Check', detail: 'Freitag · 18:00 Uhr · für die ganze WG' },
	aktivitaet: { title: 'Sami hat Einkauf ergänzt', detail: 'Hafermilch · vor 12 Minuten' },
	chat: { title: 'In der WG', detail: '„Bin um acht wieder da.“ · Lea' },
} satisfies Record<string, PreviewCopy>;

type PreviewSlug = keyof typeof PREVIEW_COPY;

export interface PublicPreviewModule {
	slug: PreviewSlug;
	title: string;
	Icon: LucideIcon;
}

const ROW = 'min-h-11 rounded-none border-0 border-t border-border px-0 first:border-t-0';

const SHOPPING_ROWS = [
	['Hafermilch', '2 Packungen · von Mika', false],
	['Bananen', '6 Stück · von Lea', false],
	['Spülmittel', '1 Flasche · von Jona', true],
] as const;

function PreviewRows({ module }: { module: PublicPreviewModule }) {
	const copy = PREVIEW_COPY[module.slug];

	if (module.slug === 'einkauf') {
		return (
			<ItemGroup className="gap-0">
				{SHOPPING_ROWS.map(([title, detail, done]) => (
					<ItemEntry key={title} className={ROW}>
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
								{title}
								{done && <span className="sr-only">, erledigt</span>}
							</ItemTitle>
							<ItemDescription className="line-clamp-none break-words">{detail}</ItemDescription>
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
						28,40 €
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
							<AvatarFallback>LE</AvatarFallback>
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
	return (
		<section aria-label="So kann euer Alltag aussehen">
			<p className="px-1 pb-1.5 text-xs text-muted-foreground">
				Beispiel: So kann euer Alltag aussehen
			</p>
			<Card className="py-0">
				<div className="flex flex-col">
					{modules.map((module) => {
						const copy = PREVIEW_COPY[module.slug];
						return (
							<article
								key={module.slug}
								aria-label={`${module.title}, Beispiel-WG`}
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
											{copy.title} · {copy.detail}
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
	return (
		<section aria-label={`Beispielansicht für ${module.title}`}>
			<article aria-label={`${module.title}, Beispiel-WG`}>
				<Card className="h-full">
					<CardContent>
						<span className="mb-1 block text-right text-xs text-muted-foreground">Beispiel</span>
						<PreviewRows module={module} />
					</CardContent>
				</Card>
			</article>
		</section>
	);
}
