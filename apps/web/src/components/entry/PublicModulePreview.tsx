import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/shared/lib/cn';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

export interface PublicPreviewModule {
	slug: string;
	title: string;
	description: string;
	Icon: LucideIcon;
}

interface PreviewCopy {
	title: string;
	detail: string;
	meta: string;
}

const PREVIEW_COPY: Record<string, PreviewCopy> = {
	einkauf: {
		title: 'Hafermilch',
		detail: '2 Packungen',
		meta: 'Noch offen · für alle',
	},
	ausgaben: {
		title: 'Pizzaabend',
		detail: 'Mika bezahlt · 28,40 €',
		meta: '4 Personen · 7,10 € pro Person',
	},
	putzen: {
		title: 'Bad putzen',
		detail: 'Samira · heute',
		meta: 'Offen · als Nächstes dran',
	},
	pinnwand: {
		title: 'Wohnungsübergabe am Freitag',
		detail: 'Alex · gestern',
		meta: 'Schlüssel liegen im Flur bereit.',
	},
	fixkosten: {
		title: 'Internet',
		detail: '29,99 € monatlich',
		meta: 'Nächste Zahlung am 3.',
	},
	mahnungen: {
		title: 'Noah bekommt 12,50 €',
		detail: 'Geteilt aus dem Einkauf',
		meta: 'Seit 2 Tagen offen',
	},
	vorraete: {
		title: 'Toilettenpapier',
		detail: '2 Packungen vorhanden',
		meta: 'Mindestbestand: 1 Packung',
	},
	kalender: {
		title: 'Putzplan-Check',
		detail: 'Freitag · 18:00 Uhr',
		meta: 'Für die ganze WG',
	},
	aktivitaet: {
		title: 'Mara hat Einkauf ergänzt',
		detail: 'Hafermilch · 2 Packungen',
		meta: 'Vor 12 Minuten',
	},
	chat: {
		title: 'In der WG',
		detail: '„Bin um acht wieder da.“',
		meta: 'Lea · vor 8 Minuten',
	},
	einstellungen: {
		title: 'WG-Mitglieder verwalten',
		detail: 'Einladungen und Rollen',
		meta: 'Nur für berechtigte Mitglieder',
	},
};

function previewFor(module: PublicPreviewModule): PreviewCopy {
	return (
		PREVIEW_COPY[module.slug] ?? {
			title: module.title,
			detail: module.description,
			meta: 'Beispielinhalte für eure WG',
		}
	);
}

function ExampleBody({
	module,
	copy,
	featured,
}: {
	module: PublicPreviewModule;
	copy: PreviewCopy;
	featured: boolean;
}) {
	if (featured && module.slug === 'einkauf') {
		return (
			<div className="flex flex-col divide-y divide-border/70 rounded-lg border border-border/70 bg-muted/40 px-3">
				{[
					{ title: 'Hafermilch', detail: '2 Packungen · offen', done: false },
					{ title: 'Bananen', detail: '6 Stück · offen', done: false },
					{ title: 'Spülmittel', detail: '1 Flasche · erledigt', done: true },
				].map(({ title, detail, done }) => (
					<div key={title} className="flex items-center gap-3 py-3">
						<span
							aria-hidden="true"
							className={cn(
								'flex size-5 shrink-0 items-center justify-center rounded border text-[10px]',
								done
									? 'border-[var(--public-accent)] bg-[var(--public-accent-soft)] text-[var(--public-accent)]'
									: 'border-foreground/20 text-transparent',
							)}
						>
							{done ? '✓' : '·'}
						</span>
						<div className="min-w-0">
							<p className="font-medium">{title}</p>
							<p className="text-sm text-muted-foreground">{detail}</p>
						</div>
					</div>
				))}
			</div>
		);
	}
	if (featured && module.slug === 'ausgaben') {
		return (
			<div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/40 p-3">
				<div className="flex items-center justify-between gap-3">
					<p className="font-medium">Pizzaabend</p>
					<p className="font-semibold tabular-nums">28,40 €</p>
				</div>
				<p className="text-sm text-muted-foreground">Mika bezahlt · 4 Personen</p>
				<p className="text-sm font-medium text-[var(--public-accent)]">7,10 € pro Person</p>
			</div>
		);
	}
	if (featured && module.slug === 'putzen') {
		return (
			<div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/40 p-3">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--public-accent-soft)] text-sm font-semibold text-[var(--public-accent)]">
					S
				</span>
				<div className="min-w-0">
					<p className="font-medium">Bad putzen</p>
					<p className="text-sm text-muted-foreground">Samira · heute · offen</p>
				</div>
			</div>
		);
	}
	if (featured && module.slug === 'pinnwand') {
		return (
			<div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/40 p-3">
				<p className="font-medium">Wohnungsübergabe am Freitag</p>
				<p className="text-sm leading-5 text-muted-foreground">
					„Schlüssel liegen im Flur bereit.“
				</p>
				<p className="text-xs text-muted-foreground">Alex · gestern</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1">
			<p className={cn('font-medium', featured ? 'text-lg' : 'text-sm')}>{copy.title}</p>
			<p className="text-sm text-muted-foreground">{copy.detail}</p>
			<p className="text-xs text-muted-foreground">{copy.meta}</p>
		</div>
	);
}

function ExampleCard({
	module,
	featured = false,
}: { module: PublicPreviewModule; featured?: boolean }) {
	const copy = previewFor(module);
	const Icon = module.Icon;

	return (
		<article aria-label={`${module.title}, Beispiel-WG`}>
			<Card
				size={featured ? 'default' : 'sm'}
				className={cn(
					'border-0 bg-card/90 shadow-none ring-1 ring-foreground/10',
					featured && 'ring-foreground/15',
				)}
			>
				<CardContent className={cn('flex flex-col gap-4', !featured && 'gap-3')}>
					{!featured && (
						<div className="flex items-start justify-between gap-3">
							<div className="flex min-w-0 items-center gap-3">
								<span
									aria-hidden="true"
									className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--public-accent-soft)] text-[var(--public-accent)]"
								>
									<Icon className="size-4" />
								</span>
								<div className="min-w-0">
									<p className="break-words text-sm font-medium">{module.title}</p>
								</div>
							</div>
						</div>
					)}
					<ExampleBody module={module} copy={copy} featured={featured} />
				</CardContent>
			</Card>
		</article>
	);
}

export function PublicModulePreviews({ modules }: { modules: PublicPreviewModule[] }) {
	return (
		<section aria-labelledby="public-examples-heading" className="flex flex-col gap-3">
			<div className="flex items-end justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 id="public-examples-heading" className="text-base font-semibold">
						So kann euer Alltag aussehen
					</h2>
					<p className="text-sm text-muted-foreground">
						Vier kleine Einblicke aus einer Beispiel-WG.
					</p>
				</div>
				<Badge variant="secondary" className="shrink-0">
					Beispiel-WG
				</Badge>
			</div>
			<div className="public-preview-grid">
				{modules.map((module) => (
					<ExampleCard key={module.slug} module={module} />
				))}
			</div>
		</section>
	);
}

export function PublicModulePreview({
	module,
	homeHref = '/',
}: {
	module: PublicPreviewModule;
	homeHref?: string;
}) {
	return (
		<section aria-labelledby="public-module-preview-heading" className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<h2 id="public-module-preview-heading" className="text-base font-semibold">
					{module.title}
				</h2>
				<Badge variant="secondary" className="shrink-0">
					Beispiel-WG · fiktiv
				</Badge>
			</div>
			<ExampleCard module={module} featured />
			<Link
				href={homeHref}
				className="min-h-11 self-start text-sm font-medium text-[var(--public-accent)] underline-offset-4 hover:underline"
			>
				Alle Bereiche ansehen
			</Link>
		</section>
	);
}
