import { Badge } from '@/components/ui/badge';
import { Pause } from 'lucide-react';

export function AboPausedBadge() {
	return (
		<Badge variant="secondary" aria-label="Abo pausiert">
			<Pause />
			Pausiert
		</Badge>
	);
}
