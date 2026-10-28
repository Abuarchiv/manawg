import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { QUICK_CHORE_TEMPLATES } from '@/features/chores/components/constants';

/** Shown instead of the list: after a failed first load, or when there are no chores yet. */
export function ChoreListEmpty({
	loadFailed,
	onQuickChore,
}: {
	loadFailed: boolean;
	onQuickChore: (template: (typeof QUICK_CHORE_TEMPLATES)[number]) => void;
}) {
	if (loadFailed) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Noch keine Aufgaben geladen</EmptyTitle>
					<EmptyDescription>
						Versuche es erneut, sobald die Verbindung wieder da ist.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Sparkles aria-hidden />
				</EmptyMedia>
				<EmptyTitle>Noch keine Aufgaben</EmptyTitle>
				<EmptyDescription>Starte mit einer typischen WG-Aufgabe:</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="flex-row flex-wrap justify-center">
				{QUICK_CHORE_TEMPLATES.map((template) => (
					<Button key={template.title} variant="outline" onClick={() => onQuickChore(template)}>
						{template.title}
					</Button>
				))}
			</EmptyContent>
		</Empty>
	);
}
