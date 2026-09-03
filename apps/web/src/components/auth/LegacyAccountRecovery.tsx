'use client';

import { ErrorBox } from '@/components/neu/ErrorBox';
import {
	clearIdentity,
	getLegacyIdentityCandidates,
	memberAuthHeader,
} from '@/shared/lib/identity';
import { isValidShareCode, normalizeShareCode } from '@/shared/lib/share-code';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

const GENERIC_RECOVERY_ERROR =
	'Das alte Profil konnte nicht wiederhergestellt werden. Bitte prüfe den WG-Code und versuche es erneut.';

type ClaimResponse = {
	member?: {
		id?: unknown;
	};
};

function isSuccessfulClaim(body: unknown, memberId: string): body is ClaimResponse {
	if (!body || typeof body !== 'object') return false;
	const member = (body as ClaimResponse).member;
	return Boolean(member && typeof member === 'object' && member.id === memberId);
}

export function LegacyAccountRecovery() {
	const router = useRouter();
	const [shareCode, setShareCode] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);

	async function recover(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (submittingRef.current) return;

		const normalizedCode = normalizeShareCode(shareCode);
		setError(null);
		if (!isValidShareCode(normalizedCode)) {
			setError('Bitte gib einen gültigen WG-Code ein.');
			return;
		}

		submittingRef.current = true;
		setSubmitting(true);
		try {
			const candidates = getLegacyIdentityCandidates();
			for (const candidate of candidates) {
				try {
					const response = await fetch(
						`/api/wg/${encodeURIComponent(normalizedCode)}/members/${encodeURIComponent(candidate.memberId)}/claim`,
						{
							method: 'POST',
							headers: memberAuthHeader(candidate.memberId, candidate.memberToken),
						},
					);
					if (!response.ok) continue;

					const body: unknown = await response.json();
					if (!isSuccessfulClaim(body, candidate.memberId)) continue;

					clearIdentity(candidate.wgId);
					router.replace(`/wg/${encodeURIComponent(normalizedCode)}`);
					return;
				} catch {
					// Continue with the next local proof without exposing claim details.
				}
			}
			setError(GENERIC_RECOVERY_ERROR);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	}

	return (
		<section
			aria-labelledby="legacy-account-recovery-heading"
			className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
		>
			<div className="space-y-1">
				<h2
					id="legacy-account-recovery-heading"
					className="text-[15px] font-semibold text-[var(--text-1)]"
				>
					Altes Profil wiederherstellen
				</h2>
				<p className="text-[13px] leading-5 text-[var(--text-2)]">
					Gib den WG-Code ein, um ein gespeichertes Profil nach der Anmeldung zu übernehmen.
				</p>
			</div>

			<form onSubmit={recover} className="space-y-3" noValidate>
				<div className="space-y-2">
					<label
						htmlFor="legacy-recovery-share-code"
						className="block text-[13px] font-medium text-[var(--text-1)]"
					>
						WG-Code
					</label>
					<input
						id="legacy-recovery-share-code"
						name="shareCode"
						type="text"
						value={shareCode}
						onChange={(event) => setShareCode(event.target.value)}
						autoComplete="off"
						inputMode="text"
						maxLength={8}
						aria-describedby={error ? 'legacy-recovery-error' : undefined}
						aria-invalid={error ? true : undefined}
						className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 font-mono text-base uppercase tracking-[0.18em] text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					/>
				</div>

				{error ? <ErrorBox id="legacy-recovery-error">{error}</ErrorBox> : null}

				<button
					type="submit"
					disabled={submitting}
					className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--border-strong)] px-4 py-3 text-[14px] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
					{submitting ? 'Wird wiederhergestellt …' : 'Profil wiederherstellen'}
				</button>
			</form>
		</section>
	);
}
