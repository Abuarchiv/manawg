import Link from 'next/link';

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function DatenschutzPage() {
	return (
		<main
			id="main"
			tabIndex={-1}
			className="mx-auto min-h-svh max-w-2xl px-5 py-12 text-[var(--text-1)]"
		>
			<Link href="/" className="text-sm text-[var(--accent)] hover:underline">
				← Zurück zu ManaWG
			</Link>
			<h1 className="mt-8 text-3xl font-semibold tracking-tight">Datenschutz</h1>
			<p className="mt-3 text-sm text-[var(--text-3)]">Stand: 3. September 2026</p>

			<section className="mt-10 space-y-4 leading-7 text-[var(--text-2)]">
				<h2 className="text-xl font-semibold text-[var(--text-1)]">Anonyme Produktanalyse</h2>
				<p>
					Wir verwenden PostHog Cloud EU, um Seitenaufrufe sowie die erfolgreiche Erstellung und den
					erfolgreichen Beitritt zu einer WG zu zählen. Die Verarbeitung erfolgt in der EU-Region
					(Frankfurt) und dient ausschließlich dazu, ManaWG zu verbessern.
				</p>
				<p>
					Dabei setzen wir keine Analyse-Cookies und erstellen keine Personenprofile. Automatische
					Klickerfassung, Session-Aufzeichnungen und Umfragen sind deaktiviert. Wir übertragen keine
					Namen, E-Mail-Adressen, WG-Namen, WG-Codes, Nachrichten, Einkaufs- oder Finanzdaten an
					PostHog.
				</p>
				<p>
					PostHog erhält technisch notwendige Verbindungsdaten wie die IP-Adresse bei der Anfrage.
					Die Analyse kann durch Browser-Schutzfunktionen oder Inhaltsblocker verhindert werden;
					ManaWG funktioniert dann unverändert weiter.
				</p>
			</section>
		</main>
	);
}
