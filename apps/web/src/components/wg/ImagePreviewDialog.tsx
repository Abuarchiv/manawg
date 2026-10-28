'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

/** Full-size image in a native modal dialog; Escape and a backdrop click close it. */
export function ImagePreviewDialog({
	src,
	label,
	onClose,
}: {
	src: string;
	label: string;
	onClose: () => void;
}) {
	const previewDialogRef = useRef<HTMLDialogElement>(null);
	const previewCloseButtonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const dialog = previewDialogRef.current;
		if (!dialog) return;

		if (!dialog.open) dialog.showModal();
		requestAnimationFrame(() => previewCloseButtonRef.current?.focus());

		return () => {
			if (dialog.open) dialog.close();
		};
	}, []);

	return (
		<dialog
			ref={previewDialogRef}
			aria-label={`${label}-Vorschau`}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
		>
			<Button
				variant="secondary"
				size="icon-lg"
				ref={previewCloseButtonRef}
				type="button"
				onClick={onClose}
				aria-label={`${label}-Vorschau schließen`}
				className="absolute right-4 top-4"
			>
				<X aria-hidden />
			</Button>
			{/* biome-ignore lint/performance/noImgElement: user-uploaded storage URL, next/image is not used for these */}
			<img
				src={src}
				alt={`${label} groß`}
				className="max-h-full max-w-full rounded-lg object-contain"
			/>
		</dialog>
	);
}
