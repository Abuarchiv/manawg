import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface ModuleCardProps {
	href: string;
	Icon: LucideIcon;
	title: string;
	badge?: ReactNode;
	primary: ReactNode;
	secondary?: ReactNode;
}
export function ModuleCard({ href, Icon, title, badge, primary, secondary }: ModuleCardProps) {
	return (
		<Item variant="outline" render={<Link href={href} />}>
			<ItemMedia variant="icon">
				<Icon aria-hidden />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="line-clamp-none break-words">{title}</ItemTitle>
				<ItemDescription>{secondary ?? primary}</ItemDescription>
			</ItemContent>
			{badge}
		</Item>
	);
}
