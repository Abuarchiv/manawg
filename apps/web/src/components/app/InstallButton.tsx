'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia } from '@/components/ui/item';
import { cn } from '@/shared/lib/cn';
import {
	type BeforeInstallEvent,
	isAppInstalled,
	isIosLikeDevice,
	subscribeInstall,
	triggerInstall,
} from '@/shared/lib/pwa-install';
import { Download, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

type Platform = 'desktop' | 'android' | 'ios' | 'unknown';

// A plain ICU argument takes an element at runtime; the typed `rich` signature lists only tags.
const bold = (text: string) =>
	(<span className="font-medium text-foreground">{text}</span>) as unknown as string;

type Props = {
	variant?: 'primary' | 'outline';
	className?: string;
	label: string;
};

export function InstallButton({ variant = 'outline', className, label }: Props) {
	const t = useTranslations('shell.install');
	const [event, setEvent] = useState<BeforeInstallEvent | null>(null);
	const [platform, setPlatform] = useState<Platform>('unknown');
	const [installed, setInstalled] = useState(false);
	const [showFallback, setShowFallback] = useState(false);
	const installButtonRef = useRef<HTMLButtonElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (isAppInstalled()) {
			setInstalled(true);
			return;
		}

		const ua = window.navigator.userAgent.toLowerCase();
		if (isIosLikeDevice(window.navigator)) setPlatform('ios');
		else if (/android/.test(ua)) setPlatform('android');
		else setPlatform('desktop');

		const unsub = subscribeInstall((ev) => {
			setEvent(ev);
			if (!ev && isAppInstalled()) setInstalled(true);
		});

		return unsub;
	}, []);

	if (installed) return null;

	const click = async () => {
		// iOS has no native install API: fall back to the instructions modal
		if (platform === 'ios') {
			setShowFallback(true);
			return;
		}

		if (event) {
			const result = await triggerInstall();
			if (result === 'accepted') {
				setInstalled(true);
			} else if (result === 'unavailable') {
				setShowFallback(true);
			}
			return;
		}

		// No native event available: show the instructions
		setShowFallback(true);
	};

	return (
		<Dialog open={showFallback} onOpenChange={setShowFallback}>
			<Button
				ref={installButtonRef}
				type="button"
				onClick={click}
				variant={variant === 'primary' ? 'default' : 'outline'}
				className={cn('h-auto whitespace-normal py-2', className)}
			>
				<Download data-icon="inline-start" aria-hidden />
				{label}
			</Button>
			<DialogContent
				initialFocus={closeButtonRef}
				finalFocus={installButtonRef}
				showCloseButton={false}
			>
				<DialogHeader className="pr-12">
					<DialogTitle>{t('title')}</DialogTitle>
					<DialogDescription>{t(`platform.${platform}`)}</DialogDescription>
				</DialogHeader>
				<Button
					ref={closeButtonRef}
					type="button"
					onClick={() => setShowFallback(false)}
					variant="ghost"
					size="icon"
					aria-label={t('close')}
					className="absolute top-2 right-2 size-9"
				>
					<X aria-hidden="true" />
				</Button>
				{platform === 'ios' && <IosSteps />}
				{platform === 'android' && <AndroidSteps />}
				{(platform === 'desktop' || platform === 'unknown') && <DesktopSteps />}
				<DialogFooter>
					<p className="text-sm text-muted-foreground">{t('footer')}</p>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Step({
	num,
	children,
}: {
	num: number;
	children: React.ReactNode;
}) {
	return (
		<Item render={<li />} variant="muted" size="sm" className="flex-nowrap items-start">
			<ItemMedia>
				<Badge variant="secondary">{num}</Badge>
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemDescription className="line-clamp-none">{children}</ItemDescription>
			</ItemContent>
		</Item>
	);
}

function IosSteps() {
	const t = useTranslations('shell.install.ios');
	return (
		<ItemGroup aria-label={t('label')}>
			<Step num={1}>{t.rich('step1', { share: bold(t('share')) })}</Step>
			<Step num={2}>{t.rich('step2', { addToHome: bold(t('addToHome')) })}</Step>
			<Step num={3}>{t.rich('step3', { add: bold(t('add')) })}</Step>
			<Step num={4}>{t('step4')}</Step>
		</ItemGroup>
	);
}

function AndroidSteps() {
	const t = useTranslations('shell.install.android');
	return (
		<ItemGroup aria-label={t('label')}>
			<Step num={1}>{t.rich('step1', { menu: bold(t('menu')) })}</Step>
			<Step num={2}>{t.rich('step2', { install: bold(t('install')) })}</Step>
			<Step num={3}>{t('step3')}</Step>
		</ItemGroup>
	);
}

function DesktopSteps() {
	const t = useTranslations('shell.install.desktop');
	return (
		<ItemGroup aria-label={t('label')}>
			<Step num={1}>{t.rich('step1', { install: bold(t('install')) })}</Step>
			<Step num={2}>{t.rich('step2', { menu: bold(t('menu')) })}</Step>
			<Step num={3}>{t('step3')}</Step>
		</ItemGroup>
	);
}
