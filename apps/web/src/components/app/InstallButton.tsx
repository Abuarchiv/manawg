'use client';

import { Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

type Platform = 'desktop' | 'android' | 'ios' | 'unknown';

type Props = {
	variant?: 'primary' | 'outline';
	className?: string;
	label: string;
};

export function InstallButton({ variant = 'outline', className, label }: Props) {
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
					<DialogTitle>ManaWG als App installieren</DialogTitle>
					<DialogDescription>
						{platform === 'ios' && 'iOS / Safari'}
						{platform === 'android' && 'Android'}
						{platform === 'desktop' && 'Desktop-Browser'}
						{platform === 'unknown' && 'Anleitung'}
					</DialogDescription>
				</DialogHeader>
				<Button
					ref={closeButtonRef}
					type="button"
					onClick={() => setShowFallback(false)}
					variant="ghost"
					size="icon"
					aria-label="Installationsdialog schließen"
					className="absolute top-2 right-2 size-9"
				>
					<X aria-hidden="true" />
				</Button>
				{platform === 'ios' && <IosSteps />}
				{platform === 'android' && <AndroidSteps />}
				{(platform === 'desktop' || platform === 'unknown') && <DesktopSteps />}
				<DialogFooter>
					<p className="text-sm text-muted-foreground">
						Danach startet ManaWG ohne Browser-Leiste, direkt vom Startbildschirm.
					</p>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Step({ num, children }: { num: number; children: React.ReactNode }) {
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
	return (
		<ItemGroup aria-label="Installationsschritte für iOS">
			<Step num={1}>
				Tippe in Safari auf <span className="font-medium text-foreground">Teilen</span>.
			</Step>
			<Step num={2}>
				Scrolle nach unten und wähle{' '}
				<span className="font-medium text-foreground">„Zum Home-Bildschirm“</span>.
			</Step>
			<Step num={3}>
				Tippe oben rechts auf <span className="font-medium text-foreground">Hinzufügen</span>.
			</Step>
			<Step num={4}>
				Öffne ManaWG vom Home-Bildschirm und melde dich einmal an. Das iPhone trennt App und Safari,
				danach bleibst du angemeldet.
			</Step>
		</ItemGroup>
	);
}

function AndroidSteps() {
	return (
		<ItemGroup aria-label="Installationsschritte für Android">
			<Step num={1}>
				Tippe in Chrome oben rechts auf <span className="font-medium text-foreground">⋮ Menü</span>.
			</Step>
			<Step num={2}>
				Wähle <span className="font-medium text-foreground">„App installieren“</span> oder „Zum
				Startbildschirm“.
			</Step>
			<Step num={3}>Bestätige. ManaWG liegt dann auf dem Startbildschirm.</Step>
		</ItemGroup>
	);
}

function DesktopSteps() {
	return (
		<ItemGroup aria-label="Installationsschritte im Browser">
			<Step num={1}>
				Klicke in der Adressleiste auf{' '}
				<span className="font-medium text-foreground">Installieren</span>.
			</Step>
			<Step num={2}>
				Alternativ öffnest du das <span className="font-medium text-foreground">⋮ Menü</span> und
				wählst „ManaWG installieren“.
			</Step>
			<Step num={3}>Bestätige. ManaWG startet dann wie eine App.</Step>
		</ItemGroup>
	);
}
