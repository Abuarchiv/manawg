'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Section } from '@/components/wg/einstellungen/Section';
import { memberAuthHeader } from '@/shared/lib/identity';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';

const WG_NAME_MAX = 100;

interface WgNameSectionProps {
	wgName: string;
	shareCode: string;
	memberId: string;
	memberToken?: string | undefined;
}

/** Admin-only rename; the PATCH route has always accepted `name`, this is its UI. */
export function WgNameSection({ wgName, shareCode, memberId, memberToken }: WgNameSectionProps) {
	const router = useRouter();
	const [name, setName] = useState(wgName);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		setName(wgName);
	}, [wgName]);

	const trimmed = name.trim();
	const unchanged = trimmed === wgName;

	async function submit(event: FormEvent): Promise<void> {
		event.preventDefault();
		if (pending || unchanged || !trimmed) return;
		setPending(true);
		setError(null);
		setSaved(false);
		try {
			const res = await fetch(`/api/wg/${encodeURIComponent(shareCode)}`, {
				method: 'PATCH',
				headers: {
					'content-type': 'application/json',
					...memberAuthHeader(memberId, memberToken),
				},
				body: JSON.stringify({ name: trimmed }),
			});
			if (!res.ok) {
				setError(
					res.status === 403
						? 'Nur Admins können die WG umbenennen.'
						: 'WG konnte nicht umbenannt werden: Versuche es gleich erneut.',
				);
				return;
			}
			setSaved(true);
			router.refresh();
		} catch {
			setError('WG konnte nicht umbenannt werden: Prüfe deine Verbindung und versuche es erneut.');
		} finally {
			setPending(false);
		}
	}

	return (
		<Section title="WG-Name">
			<form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2 p-3">
				<Field>
					<FieldLabel htmlFor="wg-name">Name eurer WG</FieldLabel>
					<Input
						id="wg-name"
						value={name}
						maxLength={WG_NAME_MAX}
						onChange={(event) => {
							setName(event.target.value);
							setSaved(false);
						}}
						autoComplete="off"
						enterKeyHint="done"
						disabled={pending}
					/>
				</Field>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				{saved && <output className="text-xs text-muted-foreground">WG-Name gespeichert.</output>}
				<Button type="submit" disabled={pending || unchanged || !trimmed} className="self-start">
					{pending && <Spinner data-icon="inline-start" aria-hidden />}
					Speichern
				</Button>
			</form>
		</Section>
	);
}
