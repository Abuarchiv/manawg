import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export interface SuggestionGroup {
	label: string;
	names: string[];
}

export function ShoppingSuggestions({
	groups,
	disabled,
	onAdd,
}: {
	groups: SuggestionGroup[];
	disabled: boolean;
	onAdd: (name: string) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			{groups.map((group) => (
				<div key={group.label} className="flex min-w-0 flex-col gap-2">
					<p className="text-[12px] font-medium text-muted-foreground">{group.label}</p>
					<ul aria-label={group.label} className="-mx-4 -my-1.5 flex flex-wrap gap-2 px-4 py-1.5">
						{group.names.map((name) => (
							<li key={name} className="min-w-0 max-w-full">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									disabled={disabled}
									onClick={() => onAdd(name)}
									onFocus={(event) => {
										if (!event.currentTarget.matches(':focus-visible')) return;
										const action = document.querySelector<HTMLElement>(
											'[data-page-primary-action]',
										);
										if (
											action &&
											event.currentTarget.getBoundingClientRect().bottom >
												action.getBoundingClientRect().top
										) {
											event.currentTarget.scrollIntoView({ block: 'start', inline: 'nearest' });
										}
									}}
									aria-label={`${name} hinzufügen`}
									className="min-w-0 max-w-full"
								>
									<Plus data-icon="inline-start" aria-hidden />
									<span className="truncate">{name}</span>
								</Button>
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}
