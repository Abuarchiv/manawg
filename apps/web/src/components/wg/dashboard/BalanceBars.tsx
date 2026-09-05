import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from '@/components/ui/empty';
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { formatEuroCents } from '@/core/utils/money';
import { cn } from '@/shared/lib/cn';
import Link from 'next/link';

interface BalanceRow {
	memberId: string;
	memberName: string;
	color: string | null;
	balanceCents: number;
}
interface BalanceBarsProps {
	balances: BalanceRow[];
	currentMemberId: string;
	emptyHref?: string;
}

export function BalanceBars({ balances, currentMemberId, emptyHref }: BalanceBarsProps) {
	if (balances.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Noch keine Ausgaben</EmptyTitle>
					<EmptyDescription>
						Sobald jemand etwas einträgt, erscheint hier der Saldo.
					</EmptyDescription>
				</EmptyHeader>
				{emptyHref && (
					<EmptyContent>
						<Link
							href={emptyHref}
							className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
						>
							Erste Ausgabe eintragen
						</Link>
					</EmptyContent>
				)}
			</Empty>
		);
	}
	const sorted = [...balances].sort((a, b) => b.balanceCents - a.balanceCents);
	return (
		<ItemGroup aria-label="Salden der WG-Mitglieder">
			{sorted.map((balance) => (
				<Item key={balance.memberId} variant="muted">
					<ItemMedia>
						<Avatar>
							<AvatarFallback>{balance.memberName.slice(0, 2).toUpperCase()}</AvatarFallback>
						</Avatar>
					</ItemMedia>
					<ItemContent className="min-w-0">
						<ItemTitle className="line-clamp-none break-words">
							{balance.memberName}
							{balance.memberId === currentMemberId && <Badge variant="outline">du</Badge>}
						</ItemTitle>
						<ItemDescription>
							{balance.balanceCents === 0
								? 'Ausgeglichen'
								: balance.balanceCents > 0
									? 'Bekommt aus der WG zurück'
									: 'Schuldet der WG'}
						</ItemDescription>
					</ItemContent>
					<Badge
						variant={balance.balanceCents < 0 ? 'destructive' : 'secondary'}
						className="tabular-nums"
					>
						{formatEuroCents(Math.abs(balance.balanceCents))}
					</Badge>
				</Item>
			))}
		</ItemGroup>
	);
}
