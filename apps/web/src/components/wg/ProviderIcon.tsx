import type { ProviderKey } from '@/lib/wg/recurring-expenses';
import { Film, Music, Plug, Tv, Wifi } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

interface ProviderMeta {
	label: string;
	bgClass: string;
	textClass: string;
	Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const PROVIDER_META: Record<ProviderKey, ProviderMeta> = {
	netflix: {
		label: 'Netflix',
		bgClass: 'bg-red-500/10',
		textClass: 'text-red-500',
		Icon: Film,
	},
	spotify: {
		label: 'Spotify',
		bgClass: 'bg-emerald-500/10',
		textClass: 'text-emerald-500',
		Icon: Music,
	},
	disney: {
		label: 'Disney+',
		bgClass: 'bg-blue-500/10',
		textClass: 'text-blue-500',
		Icon: Tv,
	},
	strom: {
		label: 'Strom',
		bgClass: 'bg-yellow-500/10',
		textClass: 'text-yellow-600',
		Icon: Plug,
	},
	internet: {
		label: 'Internet',
		bgClass: 'bg-indigo-500/10',
		textClass: 'text-indigo-500',
		Icon: Wifi,
	},
};

interface ProviderIconProps {
	provider: ProviderKey | null;
	size?: number;
}

export function ProviderIcon({ provider, size = 28 }: ProviderIconProps) {
	if (!provider) return null;
	const meta = PROVIDER_META[provider];
	const Icon = meta.Icon;
	return (
		<span
			aria-label={meta.label}
			title={meta.label}
			className={`inline-flex shrink-0 items-center justify-center rounded-md ${meta.bgClass} ${meta.textClass}`}
			style={{ width: size, height: size }}
		>
			<Icon width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} aria-hidden />
		</span>
	);
}
