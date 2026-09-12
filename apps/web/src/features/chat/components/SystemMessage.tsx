import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { CheckCircle2, Info, LogIn, LogOut, Receipt } from 'lucide-react';

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
					text={`${asString(data.actorName, 'Jemand')} hat ${asString(data.description, 'eine Ausgabe')} für ${asString(data.amount, '0€')} eingetragen.`}
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
	text: string;
}) {
	return (
		<Marker variant="separator" className="my-2 justify-center text-xs">
			<MarkerIcon>
				<Icon aria-hidden />
			</MarkerIcon>
			<MarkerContent className="max-w-[80%] rounded-full bg-muted px-3 py-1 text-center">
				{text}
			</MarkerContent>
		</Marker>
	);
}
