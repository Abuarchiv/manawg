'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { LinkRow } from '@/components/wg/einstellungen/LinkRow';
import { Section } from '@/components/wg/einstellungen/Section';
import { apiFetch } from '@/core/infra/api-client';
import { InstallButton } from '@/shared/components/install-button';
import { useTheme } from '@/shared/components/theme/ThemeProvider';
import { haptic } from '@/shared/lib/haptics';
import { Check, Monitor, Moon, Save, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

const THEMES = [
	{ value: 'light', label: 'Hell', icon: Sun },
	{ value: 'dark', label: 'Dunkel', icon: Moon },
	{ value: 'system', label: 'System', icon: Monitor },
] as const;

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
	const [paypalLoaded, setPaypalLoaded] = useState(false);
	const [loadingPayPal, setLoadingPayPal] = useState(true);
	const [paypalLoadAttempt, setPaypalLoadAttempt] = useState(0);
	const [savingPayPal, setSavingPayPal] = useState(false);
	const [paypalMessage, setPaypalMessage] = useState<string | null>(null);
	const [paypalLoadError, setPaypalLoadError] = useState<string | null>(null);
	const [paypalSaveError, setPaypalSaveError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoadingPayPal(true);
		setPaypalLoaded(false);
		if (paypalLoadAttempt > 0) setPaypalLoadError(null);
		async function loadPayPal(): Promise<void> {
			try {
				const res = await apiFetch<{ member?: { paypalMerchantId?: string | null } }>(
					`/api/wg/${encodeURIComponent(shareCode)}/members/${memberId}`,
					{ memberId, memberToken },
				);
				if (cancelled) return;
				if (res.ok) {
					setPaypalMerchantId(res.data.member?.paypalMerchantId ?? '');
					setPaypalLoaded(true);
					setPaypalLoadError(null);
				} else {
					setPaypalLoaded(false);
					setPaypalLoadError('PayPal-Einstellung konnte nicht geladen werden.');
				}
			} catch {
				if (!cancelled) {
					setPaypalLoaded(false);
					setPaypalLoadError('PayPal-Einstellung konnte nicht geladen werden.');
				}
			} finally {
				if (!cancelled) setLoadingPayPal(false);
			}
		}
		void loadPayPal();
		return () => {
			cancelled = true;
		};
	}, [memberId, memberToken, shareCode, paypalLoadAttempt]);

	function retryPayPalLoad(): void {
		if (loadingPayPal) return;
		setLoadingPayPal(true);
		setPaypalLoadAttempt((attempt) => attempt + 1);
	}

	async function savePayPal(): Promise<void> {
		if (savingPayPal || !paypalLoaded) return;
		setSavingPayPal(true);
		setPaypalMessage(null);
		setPaypalSaveError(null);
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
			setPaypalLoadError(null);
		} else {
			setPaypalSaveError(
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
			<Section title="Dein Profil">
				<div className="flex min-h-[44px] items-center gap-3 px-3 py-2">
					<MemberAvatar name={memberName} size={32} />
					<div className="min-w-0 flex-1">
						<div className="text-foreground truncate text-[15px] font-medium">{memberName}</div>
						<div className="text-muted-foreground mt-0.5 text-[13px]">in {wgName}</div>
					</div>
				</div>
			</Section>

			<Section title="Darstellung">
				<div className="p-2">
					<ToggleGroup
						variant="segmented"
						className="w-full flex-wrap"
						value={[theme]}
						aria-label="Darstellung"
						onValueChange={(values) => {
							const next = THEMES.find((option) => option.value === values[0])?.value;
							if (!next) return;
							haptic('selection');
							setTheme(next);
						}}
					>
						{THEMES.map(({ value, label, icon: Icon }) => (
							<ToggleGroupItem key={value} value={value} className="min-w-max px-1.5">
								<Icon aria-hidden />
								{label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
				<div className="px-2 pb-2">
					<InstallButton label="App installieren" />
				</div>
			</Section>

			<Section title="PayPal">
				<div className="p-3">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void savePayPal();
						}}
					>
						<FieldGroup>
							<Field data-invalid={Boolean(paypalSaveError)}>
								<FieldLabel htmlFor="paypal-merchant-id">PayPal Merchant-ID</FieldLabel>
								<div className="flex flex-col gap-2">
									<Input
										id="paypal-merchant-id"
										type="text"
										value={paypalMerchantId}
										onChange={(event) => {
											setPaypalMerchantId(event.target.value);
											setPaypalMessage(null);
											setPaypalSaveError(null);
										}}
										placeholder="13-stellige Merchant-ID"
										disabled={!paypalLoaded || loadingPayPal || savingPayPal}
										className="text-base"
										autoComplete="off"
										inputMode="text"
										enterKeyHint="done"
										aria-invalid={paypalSaveError ? true : undefined}
										aria-describedby={paypalSaveError ? 'paypal-save-error' : undefined}
									/>
									<Button
										type="submit"
										variant="outline"
										disabled={!paypalLoaded || loadingPayPal || savingPayPal}
										className="self-start"
									>
										{savingPayPal ? <Spinner aria-hidden /> : <Save aria-hidden />}
										{savingPayPal ? 'Speichert…' : 'Speichern'}
									</Button>
								</div>
								<FieldDescription>
									Damit dir andere offene Beträge direkt per PayPal schicken können.
								</FieldDescription>
							</Field>
						</FieldGroup>
					</form>
					{loadingPayPal && (
						<output className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
							<Spinner aria-hidden />
							PayPal-Einstellung wird geladen…
						</output>
					)}
					{paypalLoadError && (
						<Alert variant="destructive" className="mt-3">
							<AlertTitle>Laden fehlgeschlagen</AlertTitle>
							<AlertDescription>
								<p>{paypalLoadError}</p>
								<Button
									type="button"
									variant="outline"
									onClick={retryPayPalLoad}
									disabled={loadingPayPal}
								>
									Erneut versuchen
								</Button>
							</AlertDescription>
						</Alert>
					)}
					{paypalMessage && (
						<Alert className="mt-3">
							<Check aria-hidden />
							<AlertTitle>Gespeichert</AlertTitle>
							<AlertDescription>{paypalMessage}</AlertDescription>
						</Alert>
					)}
					{paypalSaveError && (
						<Alert variant="destructive" className="mt-3">
							<AlertTitle>Speichern fehlgeschlagen</AlertTitle>
							<AlertDescription id="paypal-save-error">{paypalSaveError}</AlertDescription>
						</Alert>
					)}
				</div>
			</Section>

			<Section
				title="Hilfe"
				hint="Beschreibe, was passiert ist und wie wir den Fehler nachstellen können."
			>
				<ul>
					<LinkRow
						href="mailto:info@manawg.com?subject=Fehler%20in%20ManaWG"
						label="Fehler per E-Mail melden"
					/>
				</ul>
			</Section>
		</>
	);
}
