'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { setIdentity } from '@/shared/lib/identity';
import { MEMBER_NAME_MAX_LENGTH } from '@/shared/lib/limits';
import { type FormEvent, useEffect, useState } from 'react';

const NAME_ERRORS: Record<string, string> = {
	name_taken: 'Dieser Name ist in der WG schon vergeben.',
	name_changed: 'Dein Name wurde inzwischen geändert. Lade die Seite neu und versuche es erneut.',
	name_invalid: `Dein Name muss 1 bis ${MEMBER_NAME_MAX_LENGTH} Zeichen haben.`,
	member_deactivated: 'Als ausgezogenes Mitglied kannst du deinen Namen nicht ändern.',
};

/** Change the name the roommates see; the stored identity follows, then the page reloads. */
export function MemberNameForm() {
	const { wg, identity } = useWg();
	const [name, setName] = useState(identity.name);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setName(identity.name);
	}, [identity.name]);

	const trimmed = name.trim();
	const unchanged = trimmed === identity.name;

	async function submit(event: FormEvent): Promise<void> {
		event.preventDefault();
		if (pending || unchanged || !trimmed) return;
		setPending(true);
		setError(null);
		const res = await apiFetch<unknown>(
			`/api/wg/${encodeURIComponent(wg.shareCode)}/members/${encodeURIComponent(identity.memberId)}`,
			{
				method: 'PUT',
				memberId: identity.memberId,
				body: JSON.stringify({ name: trimmed, expectedName: identity.name }),
			},
		);
		setPending(false);
		if (!res.ok) {
			setError(
				NAME_ERRORS[res.error] ??
					(res.status === 0
						? 'Name konnte nicht geändert werden: Prüfe deine Verbindung und versuche es erneut.'
						: 'Name konnte nicht geändert werden: Versuche es gleich erneut.'),
			);
			return;
		}
		setIdentity(wg.id, { ...identity, name: trimmed });
		// Every screen shows the name; a reload is the one way to make them all agree.
		window.location.reload();
	}

	return (
		<form onSubmit={(event) => void submit(event)} className="grid gap-2 px-3 pb-3">
			<Field orientation="horizontal" className="flex-wrap items-center gap-2">
				<FieldLabel htmlFor="member-name" className="sr-only">
					Dein Name in der WG
				</FieldLabel>
				<Input
					id="member-name"
					value={name}
					maxLength={MEMBER_NAME_MAX_LENGTH}
					onChange={(event) => {
						setName(event.target.value);
						setError(null);
					}}
					autoComplete="given-name"
					enterKeyHint="done"
					disabled={pending}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? 'member-name-error' : undefined}
					className="min-w-0 flex-1 basis-40"
				/>
				<Button type="submit" disabled={pending || unchanged || !trimmed} className="h-11 shrink-0">
					{pending && <Spinner data-icon="inline-start" aria-hidden />}
					Name ändern
				</Button>
			</Field>
			{error && (
				<Alert variant="destructive">
					<AlertDescription id="member-name-error">{error}</AlertDescription>
				</Alert>
			)}
		</form>
	);
}
