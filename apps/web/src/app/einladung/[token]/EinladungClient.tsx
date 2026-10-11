'use client';

import { NAME_MAX } from '@/app/neu/start-flow';
import { useAccountNamePrefill } from '@/app/neu/use-start-draft';
import { BackButton } from '@/components/app/BackButton';
import { ErrorBox } from '@/components/app/ErrorBox';
import { TextField } from '@/components/app/TextField';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { invitePath } from '@/core/utils/invite-token';
import { cn } from '@/shared/lib/cn';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInviteJoin } from './use-invite-join';

/** The page behind an invitation link: sign in if needed, show the WG, ask for a name, join. */
export function EinladungClient({ token }: { token: string }) {
	const router = useRouter();
	const { phase, claim, name, setName, error, nameInvalid, busy, join, retry, deadMessage } =
		useInviteJoin(token);
	useAccountNamePrefill(phase.kind === 'ready', setName);
	const next = encodeURIComponent(invitePath(token));

	if (phase.kind === 'signed-out') {
		return (
			<EntryFrame
				title="Einladung annehmen"
				headingId="invite-heading"
				description="Melde dich an, um der WG beizutreten."
			>
				<div className="flex flex-col gap-2">
					<Link href={`/neu?next=${next}`} className={cn(buttonVariants(), 'w-full')}>
						Anmelden
					</Link>
					<Link
						href={`/registrieren?next=${next}`}
						className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
					>
						Konto erstellen
					</Link>
				</div>
				<LegalLinks consent />
			</EntryFrame>
		);
	}

	if (phase.kind === 'dead') {
		return (
			<EntryFrame title="Einladung nicht mehr gültig" headingId="invite-heading">
				<ErrorBox>{deadMessage}</ErrorBox>
				<Link href="/neu" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
					Zu deinen WGs
				</Link>
			</EntryFrame>
		);
	}

	if (phase.kind === 'error') {
		return (
			<EntryFrame title="Einladung" headingId="invite-heading">
				<ErrorBox>Die Einladung konnte gerade nicht geprüft werden.</ErrorBox>
				<Button type="button" variant="outline" onClick={retry}>
					Erneut prüfen
				</Button>
			</EntryFrame>
		);
	}

	if (phase.kind === 'loading') {
		return (
			<EntryFrame title="Einladung" headingId="invite-heading">
				<output
					aria-live="polite"
					aria-label="Einladung wird geprüft"
					className="flex flex-col gap-3"
				>
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<span className="sr-only">Einladung wird geprüft</span>
				</output>
			</EntryFrame>
		);
	}

	return (
		<EntryFrame
			title={`Tritt der WG „${phase.wgName}“ bei`}
			headingId="invite-heading"
			description="Mit diesem Namen sehen dich deine Mitbewohner."
		>
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void join();
				}}
				className="flex flex-col gap-5"
			>
				<FieldGroup>
					<TextField
						id="join-name"
						label="Dein Anzeigename"
						placeholder="z. B. Anna"
						value={name}
						onChange={setName}
						maxLength={NAME_MAX}
						autoComplete="given-name"
						autoFocus
						required
						invalid={nameInvalid}
						describedBy={nameInvalid ? 'join-name-error' : undefined}
						enterKeyHint="done"
					/>
					{error && nameInvalid && <ErrorBox id="join-name-error">{error}</ErrorBox>}
				</FieldGroup>
				{error && !nameInvalid && <ErrorBox id="join-name-form-error">{error}</ErrorBox>}
				<div className="flex flex-wrap items-center gap-2">
					<BackButton onClick={() => router.push('/neu')} disabled={busy} />
					<Button type="submit" disabled={busy} className="flex-1">
						{busy ? (
							<Spinner data-icon="inline-start" aria-hidden />
						) : (
							<ArrowRight data-icon="inline-start" aria-hidden />
						)}
						{busy ? 'Tritt bei…' : 'Beitreten'}
					</Button>
				</div>
			</form>
			{phase.unclaimed.length > 0 && (
				<section aria-labelledby="claim-heading" className="flex flex-col gap-2 border-t pt-4">
					<h2 id="claim-heading" className="text-sm font-medium">
						Schon Mitglied?
					</h2>
					<p className="text-muted-foreground text-xs">
						Wurde dein Profil angelegt, bevor es Konten gab? Übernimm es mit deinem Konto.
					</p>
					<div className="flex flex-wrap gap-2">
						{phase.unclaimed.map((member) => (
							<Button
								key={member.id}
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() => void claim(member.id)}
							>
								Ich bin {member.name}
							</Button>
						))}
					</div>
				</section>
			)}
		</EntryFrame>
	);
}
