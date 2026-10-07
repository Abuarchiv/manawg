import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { CheckCircle2, Info, LogIn, LogOut, Receipt } from 'lucide-react';
import type { ReactNode } from 'react';

interface SystemMessageProps {
	systemKind: string | null;
	payload: Record<string, unknown> | null;
}

function asString(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function SystemMessage({ systemKind, payload }: SystemMessageProps) {
	const data = payload ?? {};
	switch (systemKind) {
		case 'member.joined':
			return (
				<SystemRow icon={LogIn} text={`${asString(data.name, 'Jemand')} ist der WG beigetreten.`} />
			);
		case 'member.left':
			return (
				<SystemRow icon={LogOut} text={`${asString(data.name, 'Jemand')} hat die WG verlassen.`} />
			);
		case 'expense.created':
			return (
				<SystemRow
					icon={Receipt}
					text={
						<>
							{asString(data.actorName, 'Jemand')} hat {asString(data.description, 'eine Ausgabe')}{' '}
							für <span className="tabular-nums">{asString(data.amount, '0€')}</span> eingetragen.
						</>
					}
				/>
			);
		case 'chore.completed':
			return (
				<SystemRow
					icon={CheckCircle2}
					text={`${asString(data.actorName, 'Jemand')} hat „${asString(data.title, 'eine Aufgabe')}“ erledigt.`}
				/>
			);
		default:
			return <SystemRow icon={Info} text="Systemnachricht" />;
	}
}

function SystemRow({
	icon: Icon,
	text,
}: {
	icon: typeof CheckCircle2;
	text: ReactNode;
}) {
	return (
		<Marker
			variant="separator"
			className="my-2 justify-center text-xs before:min-w-3 after:min-w-3"
		>
			<MarkerIcon>
				<Icon aria-hidden />
			</MarkerIcon>
			<MarkerContent className="max-w-[85%] rounded-2xl bg-muted px-3 py-1 text-center text-foreground/80">
				{text}
			</MarkerContent>
		</Marker>
	);
}
