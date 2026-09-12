'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { Section } from '@/components/wg/einstellungen/Section';
import { ThemeOption } from '@/components/wg/einstellungen/ThemeOption';
import { apiFetch } from '@/core/infra/api-client';
import { useTheme } from '@/shared/components/theme/ThemeProvider';
import { haptic } from '@/shared/lib/haptics';
import { Check, Monitor, Moon, Save, Sun } from 'lucide-react';
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
				<div className="flex min-h-[44px] items-center gap-3 px-4 py-3.5">
					<MemberAvatar name={memberName} size={40} />
					<div className="min-w-0 flex-1">
						<div className="text-foreground truncate text-[15px] font-medium">{memberName}</div>
						<div className="text-muted-foreground mt-0.5 text-[12.5px]">in {wgName}</div>
					</div>
				</div>
				<p className="border-border text-muted-foreground border-t px-4 py-3 text-xs leading-relaxed">
					Dein Account ist mit dieser WG-Mitgliedschaft verbunden. Nicht synchronisierte Entwürfe
					und Offline-Aktionen bleiben auf diesem Gerät.
				</p>
			</Section>

			<Section title="PayPal" hint="Empfängerkennung für ausdrücklich gestartete PayPal-Zahlungen.">
				<div className="p-4">
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="paypal-merchant-id">PayPal Merchant-ID</FieldLabel>
							<div className="flex flex-col gap-2">
								<Input
									id="paypal-merchant-id"
									type="text"
									value={paypalMerchantId}
									onChange={(event) => setPaypalMerchantId(event.target.value)}
									placeholder="13-stellige Merchant-ID"
									disabled={loadingPayPal || savingPayPal}
									className="h-11 min-h-[44px] text-base"
									autoComplete="off"
									inputMode="text"
								/>
								<Button
									type="button"
									variant="outline"
									onClick={() => void savePayPal()}
									disabled={loadingPayPal || savingPayPal}
									className="h-11 min-h-[44px] w-full"
								>
									{savingPayPal ? <Spinner aria-hidden /> : <Save aria-hidden />}
									{savingPayPal ? 'Speichert…' : 'Speichern'}
								</Button>
							</div>
							<FieldDescription>
								Die Merchant-ID ist deine PayPal-Empfängerkennung. Das Speichern hinterlegt nur
								diese Kennung; es überweist kein Geld und bestätigt keine PayPal-Freischaltung.
							</FieldDescription>
						</Field>
					</FieldGroup>
					{paypalMessage && (
						<Alert className="mt-3">
							<Check aria-hidden />
							<AlertTitle>Gespeichert</AlertTitle>
							<AlertDescription>{paypalMessage}</AlertDescription>
						</Alert>
					)}
					{paypalError && (
						<Alert variant="destructive" className="mt-3">
							<AlertTitle>Speichern fehlgeschlagen</AlertTitle>
							<AlertDescription>{paypalError}</AlertDescription>
						</Alert>
					)}
				</div>
			</Section>

			<Section title="Darstellung" hint="Hell, Dunkel oder dem System folgen.">
				{/* Three equally-sized toggle buttons — aria-pressed set, focus rings visible */}
				<div className="flex gap-2 p-4">
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
