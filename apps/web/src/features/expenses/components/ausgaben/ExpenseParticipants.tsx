'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FieldDescription } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import type { Member } from '@/components/wg/WgContextProvider';
import { parseEuroAmount } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { useState } from 'react';
import { equalSharesAmong } from './manual-split-distribute';

interface ExpenseParticipantsProps {
	members: Member[];
	amountStr: string;
	disabled: boolean;
	/** Switches the form to manual shares computed for the chosen people. */
	onChoose: (shares: Record<string, string>) => void;
}

/** "Nicht alle beteiligt?": drop members from an equal split without typing every amount. */
export function ExpenseParticipants({
	members,
	amountStr,
	disabled,
	onChoose,
}: ExpenseParticipantsProps) {
	const [hint, setHint] = useState<string | null>(null);
	const everyone = members.map((member) => member.id);

	function toggle(memberId: string): void {
		const euros = parseEuroAmount(amountStr);
		const amountCents = euros === null ? 0 : Math.round(euros * CENTS_PER_EURO);
		if (amountCents <= 0) {
			setHint('Gib zuerst den Betrag ein, dann kannst du Personen herausnehmen.');
			return;
		}
		const remaining = everyone.filter((id) => id !== memberId);
		const shares = equalSharesAmong(amountCents, remaining);
		if (!shares) {
			setHint('Mindestens eine Person muss beteiligt bleiben.');
			return;
		}
		setHint(null);
		onChoose(shares);
	}

	if (members.length < 2) return null;
	return (
		<details className="rounded-lg border border-border px-3 py-2">
			<summary className="min-h-11 cursor-pointer py-2.5 text-sm font-medium">
				Nicht alle beteiligt?
			</summary>
			<div className="flex flex-col gap-1 pb-1">
				{members.map((member) => (
					<div key={member.id} className="flex min-h-11 items-center gap-3">
						<Checkbox
							id={`participant-${member.id}`}
							checked
							disabled={disabled}
							onCheckedChange={() => toggle(member.id)}
						/>
						<Label htmlFor={`participant-${member.id}`} className="min-w-0 flex-1 break-words">
							{member.name}
						</Label>
					</div>
				))}
				<FieldDescription>
					Nimmst du jemanden heraus, teilt ManaWG den Betrag gleichmäßig auf die übrigen auf. Du
					kannst die Anteile danach manuell anpassen.
				</FieldDescription>
				{hint && <output className="text-sm text-destructive">{hint}</output>}
			</div>
		</details>
	);
}
