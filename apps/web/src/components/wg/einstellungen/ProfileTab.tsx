'use client';

import { MemberAvatar } from '@/components/wg/dashboard/MemberAvatar';
import { Section } from '@/components/wg/einstellungen/Section';
import { ThemeOption } from '@/components/wg/einstellungen/ThemeOption';
import { useTheme } from '@manawg/shared/components/theme/ThemeProvider';
import { haptic } from '@manawg/shared/lib/haptics';
import { Monitor, Moon, Sun } from 'lucide-react';

interface ProfileTabProps {
	memberName: string;
	wgName: string;
}

export function ProfileTab({ memberName, wgName }: ProfileTabProps) {
	const { theme, setTheme } = useTheme();
	return (
		<>
			<Section title="Dein Profil" hint="Diese Identität ist nur an dieses Gerät gebunden.">
				<div className="flex items-center gap-3 px-4 py-3.5">
					<MemberAvatar name={memberName} size={40} />
					<div className="min-w-0 flex-1">
						<div className="truncate text-[15px] font-medium text-[var(--text-1)]">
							{memberName}
						</div>
						<div className="mt-0.5 text-[12.5px] text-[var(--text-3)]">in {wgName}</div>
					</div>
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
