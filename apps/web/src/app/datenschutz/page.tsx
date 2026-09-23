import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/shared/lib/cn';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function DatenschutzPage() {
	return (
		<main
			id="main"
			tabIndex={-1}
			className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 bg-background px-4 py-6 text-foreground focus:outline-none"
			style={{
				paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))',
				paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
			}}
		>
			<Link href="/" className={cn(buttonVariants({ variant: 'ghost' }), 'self-start px-2')}>
				<ArrowLeft data-icon="inline-start" aria-hidden /> Zurück zu ManaWG
			</Link>
			<Card>
				<CardHeader>
					<CardTitle>
						<h1 className="text-lg">Datenschutz</h1>
					</CardTitle>
					<CardDescription>Stand: 3. September 2026</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4 leading-7 text-muted-foreground">
					<h2 className="text-xl font-semibold text-foreground">Anonyme Produktanalyse</h2>
					<p>
						Wir verwenden PostHog Cloud EU, um Seitenaufrufe sowie die erfolgreiche Erstellung und
						den erfolgreichen Beitritt zu einer WG zu zählen. Die Verarbeitung erfolgt in der
						EU-Region (Frankfurt) und dient ausschließlich dazu, ManaWG zu verbessern.
					</p>
					<p>
						Dabei setzen wir keine Analyse-Cookies und erstellen keine Personenprofile. Automatische
						Klickerfassung, Session-Aufzeichnungen und Umfragen sind deaktiviert. Wir übertragen
						keine Namen, E-Mail-Adressen, WG-Namen, WG-Codes, Nachrichten, Einkaufs- oder
						Finanzdaten an PostHog.
					</p>
					<p>
						PostHog erhält technisch notwendige Verbindungsdaten wie die IP-Adresse bei der Anfrage.
						Die Analyse kann durch Browser-Schutzfunktionen oder Inhaltsblocker verhindert werden;
						ManaWG funktioniert dann unverändert weiter.
					</p>
				</CardContent>
			</Card>
			<Link href="/neu" className={cn(buttonVariants({ variant: 'link' }), 'self-start px-0')}>
				Konto öffnen
			</Link>
		</main>
	);
}
