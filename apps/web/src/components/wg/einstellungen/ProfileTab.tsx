'use client';

import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { Section } from '@/components/wg/einstellungen/Section';
import { ThemeOption } from '@/components/wg/einstellungen/ThemeOption';
import { apiFetch } from '@/core/infra/api-client';
import { useTheme } from '@/shared/components/theme/ThemeProvider';
import { haptic } from '@/shared/lib/haptics';
import { Check, Loader2, Monitor, Moon, Save, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ProfileTabProps {
	memberName: string;
	wgName: string;
	shareCode: string;
	memberId: string;
	memberToken?: string | undefined;
}

export function ProfileTab({
	memberName,
	wgName,
	shareCode,
	memberId,
	memberToken,
}: ProfileTabProps) {
	const { theme, setTheme } = useTheme();
	const [paypalMerchantId, setPaypalMerchantId] = useState('');
	const [loadingPayPal, setLoadingPayPal] = useState(true);
	const [savingPayPal, setSavingPayPal] = useState(false);
	const [paypalMessage, setPaypalMessage] = useState<string | null>(null);
	const [paypalError, setPaypalError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void apiFetch<{ member?: { paypalMerchantId?: string | null } }>(
			`/api/wg/${encodeURIComponent(shareCode)}/members/${memberId}`,
			{ memberId, memberToken },
		).then((res) => {
			if (cancelled) return;
			if (res.ok) setPaypalMerchantId(res.data.member?.paypalMerchantId ?? '');
			else setPaypalError('PayPal-Einstellung konnte nicht geladen werden.');
			setLoadingPayPal(false);
		});
		return () => {
			cancelled = true;
		};
	}, [memberId, memberToken, shareCode]);

	async function savePayPal(): Promise<void> {
		if (savingPayPal) return;
		setSavingPayPal(true);
		setPaypalMessage(null);
		setPaypalError(null);
		const res = await apiFetch<{ member: { paypalMerchantId?: string | null } }>(
			`/api/wg/${encodeURIComponent(shareCode)}/members/${memberId}`,
			{
				method: 'PATCH',
				memberId,
				memberToken,
				body: JSON.stringify({ paypalMerchantId: paypalMerchantId.trim() || null }),
			},
		);
		if (res.ok) {
			setPaypalMerchantId(res.data.member.paypalMerchantId ?? '');
			setPaypalMessage('PayPal Merchant-ID gespeichert.');
		} else {
			setPaypalError(
				res.error === 'member_not_verified'
					? 'Gerät noch nicht bestätigt. Lade die App neu und versuche es erneut.'
					: res.error === 'paypal_merchant_id_invalid'
						? 'Bitte gib eine gültige PayPal Merchant-ID ein.'
						: 'PayPal Merchant-ID konnte nicht gespeichert werden.',
			);
		}
		setSavingPayPal(false);
	}

	return (
		<>
			<Section
				title="Dein Profil"
				hint="Dein Account verbindet dich mit dieser WG. Nicht synchronisierte Entwürfe und Offline-Aktionen bleiben auf diesem Gerät."
			>
				<div className="flex items-center gap-3 px-4 py-3.5">
					<MemberAvatar name={memberName} size={40} />
					<div className="min-w-0 flex-1">
						<div className="truncate text-[15px] font-medium text-[var(--text-1)]">
							{memberName}
						</div>
						<div className="mt-0.5 text-[12.5px] text-[var(--text-3)]">in {wgName}</div>
					</div>
				</div>
				<p className="border-t border-[var(--border)] px-4 py-3 text-[12px] leading-relaxed text-[var(--text-3)]">
					Dein Account ist mit dieser WG-Mitgliedschaft verbunden. Nicht synchronisierte Entwürfe
					und Offline-Aktionen bleiben auf diesem Gerät.
				</p>
			</Section>

			<Section title="PayPal" hint="Empfängerkennung für ausdrücklich gestartete PayPal-Zahlungen.">
				<div className="space-y-3 p-4">
					<label
						className="block text-[13px] font-medium text-[var(--text-1)]"
						htmlFor="paypal-merchant-id"
					>
						PayPal Merchant-ID
					</label>
					<div className="flex flex-col gap-2 sm:flex-row">
						<input
							id="paypal-merchant-id"
							type="text"
							value={paypalMerchantId}
							onChange={(event) => setPaypalMerchantId(event.target.value)}
							placeholder="13-stellige Merchant-ID"
							disabled={loadingPayPal || savingPayPal}
							className="h-11 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-1)] outline-none transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-60"
						/>
						<button
							type="button"
							onClick={() => void savePayPal()}
							disabled={loadingPayPal || savingPayPal}
							className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
						>
							{savingPayPal ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
							) : (
								<Save className="h-3.5 w-3.5" aria-hidden />
							)}
							Speichern
						</button>
					</div>
					<p className="text-[12px] leading-relaxed text-[var(--text-3)]">
						Die Merchant-ID ist deine PayPal-Empfängerkennung. Das Speichern hinterlegt nur diese
						Kennung; es überweist kein Geld und bestätigt keine PayPal-Freischaltung.
					</p>
					{paypalMessage && (
						<output
							className="flex items-center gap-1.5 text-[12px] text-[var(--success)]"
							aria-live="polite"
						>
							<Check className="h-3.5 w-3.5" aria-hidden /> {paypalMessage}
						</output>
					)}
					{paypalError && (
						<p className="text-[12px] text-[var(--danger)]" role="alert">
							{paypalError}
						</p>
					)}
				</div>
			</Section>

			<Section title="Darstellung" hint="Hell, Dunkel oder dem System folgen.">
				{/* Three equally-sized toggle buttons — aria-pressed set, focus rings visible */}
				<div className="flex gap-2 p-3">
					<ThemeOption
						label="Hell"
						icon={<Sun className="h-4 w-4" aria-hidden />}
						active={theme === 'light'}
						onClick={() => {
							haptic('selection');
							setTheme('light');
						}}
					/>
					<ThemeOption
						label="Dunkel"
						icon={<Moon className="h-4 w-4" aria-hidden />}
						active={theme === 'dark'}
						onClick={() => {
							haptic('selection');
							setTheme('dark');
						}}
					/>
					<ThemeOption
						label="System"
						icon={<Monitor className="h-4 w-4" aria-hidden />}
						active={theme === 'system'}
						onClick={() => {
							haptic('selection');
							setTheme('system');
						}}
					/>
				</div>
			</Section>
		</>
	);
}
