'use client';

interface MemberOption {
	id: string;
	name: string;
}

interface Props {
	names: readonly string[];
	mapping: Readonly<Record<string, string | null>>;
	members: readonly MemberOption[];
	onChange: (name: string, memberId: string | null) => void;
}

export function ImportMemberMapping({ names, mapping, members, onChange }: Props) {
	if (names.length === 0) {
		return <p className="text-[13px] text-[var(--text-3)]">Keine Namen erkannt.</p>;
	}
	return (
		<ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
			{names.map((name) => {
				const value = mapping[name] ?? '';
				const unmapped = !value;
				return (
					<li key={name} className="flex items-center gap-3 p-3">
						<div className="min-w-0 flex-1">
							<div className="text-[14px] font-medium text-[var(--text-1)]">{name}</div>
							{unmapped && (
								<div
									id={`map-err-${name}`}
									role="alert"
									className="text-[11.5px] text-[var(--danger)]"
								>
									Bitte WG-Mitglied auswählen.
								</div>
							)}
						</div>
						<select
							value={value}
							onChange={(e) => onChange(name, e.target.value || null)}
							aria-label={`Mitglied für ${name} wählen`}
							aria-invalid={unmapped}
							aria-describedby={unmapped ? `map-err-${name}` : undefined}
							className={`h-11 min-w-44 rounded-md border bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
								unmapped ? 'border-[var(--danger)]/50' : 'border-[var(--border)]'
							}`}
						>
							<option value="">— bitte wählen —</option>
							{members.map((m) => (
								<option key={m.id} value={m.id}>
									{m.name}
								</option>
							))}
						</select>
					</li>
				);
			})}
		</ul>
	);
}
