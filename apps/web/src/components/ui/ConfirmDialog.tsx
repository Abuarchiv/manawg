'use client';

import type { LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';

type ConfirmDialogVariant = 'default' | 'danger';

interface ConfirmDialogProps {
	open: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: ConfirmDialogVariant;
	icon?: LucideIcon;
}

export function ConfirmDialog({
	open,
	onClose,
	onConfirm,
	title,
	description,
	confirmLabel = 'Bestätigen',
	cancelLabel = 'Abbrechen',
	variant = 'default',
	icon: Icon,
}: ConfirmDialogProps) {
	const cancelBtnRef = useRef<HTMLButtonElement>(null);

	const handleConfirm = () => {
		onConfirm();
		onClose();
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
		>
			<DialogContent initialFocus={cancelBtnRef} finalFocus={true} showCloseButton={false}>
				<DialogHeader>
					<DialogTitle className="flex items-start gap-2">
						{Icon && <Icon className="size-5 shrink-0" aria-hidden="true" />}
						<span className="min-w-0 wrap-break-word">{title}</span>
					</DialogTitle>
					<DialogDescription className="wrap-break-word">{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col">
					<Button
						ref={cancelBtnRef}
						type="button"
						onClick={onClose}
						variant="outline"
						className="h-auto min-h-11 w-full whitespace-normal py-2"
					>
						{cancelLabel}
					</Button>
					<Button
						type="button"
						onClick={handleConfirm}
						variant={variant === 'danger' ? 'destructive' : 'default'}
						className="h-auto min-h-11 w-full whitespace-normal py-2"
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
