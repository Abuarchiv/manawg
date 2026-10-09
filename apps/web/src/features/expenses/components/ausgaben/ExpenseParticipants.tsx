'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FieldDescription } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import type { Member } from '@/components/wg/WgContextProvider';
import { parseEuroAmount } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { useEffect, useState } from 'react';
import { equalSharesAmong } from './manual-split-distribute';

interface ExpenseParticipantsProps {
	members: Member[];
	amountStr: string;
	disabled: boolean;
	/** The form's split mode; going back to the equal split restores everyone. */
	splitMode: string;
	/** Switches the form to manual shares computed for the chosen people. */
	onChoose: (shares: Record<string, string>) => void;
}

/** "Nicht alle beteiligt?": drop members from an equal split without typing every amount. */
export function ExpenseParticipants({
	members,
	amountStr,
	disabled,
	splitMode,
	onChoose,
}: ExpenseParticipantsProps) {
	const [hint, setHint] = useState<string | null>(null);
	const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
	const everyone = members.map((member) => member.id);

	useEffect(() => {
		if (splitMode === 'equal') setExcluded(new Set());
	}, [splitMode]);

	function toggle(memberId: string): void {
		const euros = parseEuroAmount(amountStr);
		const amountCents = euros === null ? 0 : Math.round(euros * CENTS_PER_EURO);
		if (amountCents <= 0) {
			setHint('Gib zuerst den Betrag ein, dann kannst du Personen herausnehmen.');
			return;
		}
		const next = new Set(excluded);
		if (next.has(memberId)) next.delete(memberId);
		else next.add(memberId);
		const shares = equalSharesAmong(
			amountCents,
			everyone.filter((id) => !next.has(id)),
		);
		if (!shares) {
			setHint('Mindestens eine Person muss beteiligt bleiben.');
			return;
		}
		setHint(null);
		setExcluded(next);
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
							checked={!excluded.has(member.id)}
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
