'use client';

import { InstallButton } from '@/components/app/InstallButton';
import { useTheme } from '@/components/app/ThemeProvider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { useWg } from '@/components/wg/WgContextProvider';
import { LinkRow } from '@/components/wg/einstellungen/LinkRow';
import { MemberNameForm } from '@/components/wg/einstellungen/MemberNameForm';
import { Section } from '@/components/wg/einstellungen/Section';
import { WgNameSection } from '@/components/wg/einstellungen/WgNameSection';
import { haptic } from '@/shared/lib/haptics';
import { SUPPORT_MAILTO } from '@/shared/lib/support-mailto';
import { Monitor, Moon, Sun } from 'lucide-react';

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
}

export function ProfileTab({ memberName, wgName, shareCode, memberId }: ProfileTabProps) {
	const { theme, setTheme } = useTheme();
	const { isAdmin } = useWg();

	return (
		<>
			<Section title="Dein Profil">
				<div className="flex min-h-11 items-center gap-3 px-3 py-2">
					<MemberAvatar name={memberName} size={32} />
					<div className="min-w-0 flex-1">
						<div className="text-foreground text-sm font-medium [overflow-wrap:break-word]">
							{memberName}
						</div>
					</div>
				</div>
				<MemberNameForm memberName={memberName} shareCode={shareCode} memberId={memberId} />
				<div className="grid gap-2 px-3 pb-3">
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
					<div className="grid [&>*]:w-full">
						<InstallButton label="App installieren" />
					</div>
				</div>
			</Section>

			{isAdmin && <WgNameSection wgName={wgName} shareCode={shareCode} memberId={memberId} />}

			<Section title="Hilfe">
				<ul>
					<LinkRow href={SUPPORT_MAILTO} label="Fehler per E-Mail melden" />
				</ul>
			</Section>
		</>
	);
}
