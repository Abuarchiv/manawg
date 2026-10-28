'use client';

import { Bell, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Switch } from '@/components/animate-ui/components/base/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldTitle } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { Section } from '@/components/wg/settings/Section';
import { NOTIFICATION_PREFERENCES, useNotificationSettings } from './use-notification-settings';

const PUSH_HINT_ID = 'notification-push-hint';
const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 7;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
	value: hour,
	label: `${String(hour).padStart(2, '0')}:00`,
}));

function HourSelect({
	label,
	ariaLabel,
	value,
	disabled,
	onChange,
}: {
	label: string;
	ariaLabel: string;
	value: number;
	disabled: boolean;
	onChange: (hour: number) => void;
}) {
	return (
		<Field className="min-w-0">
			<FieldTitle>{label}</FieldTitle>
			<NativeSelect
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(Number(e.target.value))}
				aria-label={ariaLabel}
				className="w-full min-w-0 text-base"
			>
				{HOUR_OPTIONS.map((option) => (
					<NativeSelectOption key={option.label} value={option.value}>
						{option.label}
					</NativeSelectOption>
				))}
			</NativeSelect>
		</Field>
	);
}

export function NotificationSection({ code, memberId }: { code: string; memberId: string }) {
	const t = useTranslations('settings.notifications');
	const {
		status,
		pushActive,
		pushBlocked,
		pending,
		pushTarget,
		message,
		error,
		loadingStatus,
		loadStatus,
		setPushEnabled,
		togglePreference,
		saveQuietHours,
		sendTestNotification,
	} = useNotificationSettings({ code, memberId });
	const notificationBusy = pending !== null || loadingStatus;
	const notificationControlsDisabled = !status || notificationBusy;
	const pushConfigured = status?.pushConfigured !== false;
	// Exactly one hint shows at a time; the switch points at it so a screen reader hears why it is off or disabled.
	const pushHint = !pushConfigured || (!pushActive && (pushBlocked || status?.pushOptIn === true));
	const quietHoursSet = status?.quietStartHour != null && status?.quietEndHour != null;
	const feedbackRef = useRef<HTMLDivElement>(null);
	// The message sits below all switches; a user toggling one at the top would not see it.
	useEffect(() => {
		if (message || (status && error)) feedbackRef.current?.scrollIntoView({ block: 'nearest' });
	}, [message, error, status]);

	return (
		<Section id="notification-settings" title={t('title')}>
			<div className="grid min-w-0 gap-3 p-3">
				{loadingStatus && (
					<div className="grid gap-2" aria-live="polite">
						<Skeleton className="h-11 w-full" />
						<p className="text-muted-foreground text-xs">{t('loading')}</p>
					</div>
				)}
				{!status && error && (
					<LoadErrorBanner
						message={error}
						onRetry={() => void loadStatus()}
						busy={loadingStatus}
						retryLabel={t('reload')}
					/>
				)}
				{status && (
					<>
						<Field
							orientation="horizontal"
							className="has-[>[data-slot=field-content]]:items-center"
						>
							<FieldContent>
								<FieldTitle>
									{t('webPush')}
									{pushActive && <Bell className="text-muted-foreground h-3.5 w-3.5" aria-hidden />}
								</FieldTitle>
								{!pushConfigured && (
									<FieldDescription id={PUSH_HINT_ID}>{t('notConfigured')}</FieldDescription>
								)}
								{pushConfigured && !pushActive && pushBlocked && (
									<FieldDescription id={PUSH_HINT_ID}>{t('blocked')}</FieldDescription>
								)}
								{pushConfigured && !pushActive && !pushBlocked && status.pushOptIn && (
									<FieldDescription id={PUSH_HINT_ID}>{t('inactiveHere')}</FieldDescription>
								)}
								{pushActive && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => void sendTestNotification()}
										disabled={notificationControlsDisabled}
										aria-label={pending === 'test' ? t('sendingTestAria') : t('sendTestAria')}
										className="-ml-2.5 self-start"
									>
										{pending === 'test' && <Spinner aria-hidden />}
										{t('sendTest')}
									</Button>
								)}
							</FieldContent>
							<Switch
								checked={pushTarget ?? pushActive}
								disabled={
									notificationControlsDisabled || !pushConfigured || (pushBlocked && !pushActive)
								}
								aria-busy={pending === 'push'}
								aria-label={t('webPush')}
								{...(pushHint ? { 'aria-describedby': PUSH_HINT_ID } : {})}
								onCheckedChange={setPushEnabled}
							/>
						</Field>

						<div className="min-w-0 max-w-full">
							{NOTIFICATION_PREFERENCES.map((pref, index) => (
								<div key={pref.key}>
									{index > 0 && <Separator />}
									<Field
										orientation="horizontal"
										className="min-h-11 py-1 has-[>[data-slot=field-content]]:items-center"
									>
										<FieldContent>
											<FieldTitle>{t(`prefs.${pref.name}`)}</FieldTitle>
											{pref.hint && (
												<FieldDescription id={`notification-pref-${pref.key}-hint`}>
													{t(`prefHints.${pref.hint}`)}
												</FieldDescription>
											)}
										</FieldContent>
										<Switch
											checked={status?.[pref.key] ?? true}
											disabled={notificationControlsDisabled}
											aria-label={t(`prefs.${pref.name}`)}
											{...(pref.hint
												? { 'aria-describedby': `notification-pref-${pref.key}-hint` }
												: {})}
											onCheckedChange={() => void togglePreference(pref.key)}
										/>
									</Field>
								</div>
							))}
						</div>

						<div className="border-border grid min-w-0 max-w-full grid-cols-1 gap-2 border-t pt-2">
							<Field
								orientation="horizontal"
								className="min-h-11 py-1 has-[>[data-slot=field-content]]:items-center"
							>
								<FieldContent>
									<FieldTitle>{t('quiet.title')}</FieldTitle>
									<FieldDescription id="notification-quiet-hint">
										{t('quiet.hint')}
									</FieldDescription>
								</FieldContent>
								<Switch
									checked={quietHoursSet}
									disabled={notificationControlsDisabled}
									aria-label={t('quiet.title')}
									aria-describedby="notification-quiet-hint"
									onCheckedChange={(next) =>
										void (next
											? saveQuietHours(DEFAULT_QUIET_START, DEFAULT_QUIET_END)
											: saveQuietHours(null, null))
									}
								/>
							</Field>
							{quietHoursSet && (
								<div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
									<HourSelect
										label={t('quiet.from')}
										ariaLabel={t('quiet.fromAria')}
										value={status.quietStartHour ?? DEFAULT_QUIET_START}
										disabled={notificationControlsDisabled}
										onChange={(value) =>
											void saveQuietHours(value, status.quietEndHour ?? (value + 8) % 24)
										}
									/>
									<HourSelect
										label={t('quiet.to')}
										ariaLabel={t('quiet.toAria')}
										value={status.quietEndHour ?? DEFAULT_QUIET_END}
										disabled={notificationControlsDisabled}
										onChange={(value) =>
											void saveQuietHours(status.quietStartHour ?? (value + 16) % 24, value)
										}
									/>
								</div>
							)}
						</div>
					</>
				)}

				<div ref={feedbackRef} className="grid gap-3 scroll-mb-24 empty:hidden">
					{message && (
						<Alert>
							<CheckCircle2 aria-hidden />
							<AlertDescription>{message}</AlertDescription>
						</Alert>
					)}
					{status && error && (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
				</div>
			</div>
		</Section>
	);
}
