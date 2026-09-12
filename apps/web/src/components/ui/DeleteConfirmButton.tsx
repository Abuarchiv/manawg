'use client';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDelete } from '@/core/hooks/useConfirmDelete';
import { cn } from '@/shared/lib/cn';
import { Trash2 } from 'lucide-react';

interface Props {
	id: string;
	onConfirm: () => void | Promise<void>;
	pending: boolean;
	ariaLabel: string;
	ariaLabelConfirm: string;
	timeoutMs?: number;
}

export function DeleteConfirmButton({
	id,
	onConfirm,
	pending,
	ariaLabel,
	ariaLabelConfirm,
	timeoutMs,
}: Props): React.ReactElement {
	const { confirmId, request } = useConfirmDelete(timeoutMs);
	const isArmed = confirmId === id;

	function handleClick(): void {
		const shouldConfirm = request(id);
		if (shouldConfirm) {
			void onConfirm();
		}
	}

	return (
		<Button
			type="button"
			onClick={handleClick}
			disabled={pending}
			aria-busy={pending}
			aria-label={isArmed ? ariaLabelConfirm : ariaLabel}
			variant={isArmed ? 'destructive' : 'ghost'}
			size={isArmed ? 'default' : 'icon'}
			className={cn('min-h-11', isArmed ? 'px-3' : 'size-11')}
		>
			{pending ? (
				<Spinner data-icon={isArmed ? 'inline-start' : undefined} aria-hidden />
			) : (
				<Trash2 data-icon={isArmed ? 'inline-start' : undefined} aria-hidden />
			)}
			{isArmed && 'OK'}
		</Button>
	);
}
