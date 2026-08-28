'use client';

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
		<div className="my-2 flex justify-center">
			<span className="inline-flex max-w-[80%] items-center gap-1.5 rounded-full bg-[var(--surface)] px-3 py-1 text-[12px] text-[var(--text-3)] ring-1 ring-inset ring-[var(--border)]">
				<Icon className="h-3 w-3 shrink-0" aria-hidden />
				{text}
			</span>
		</div>
	);
}
