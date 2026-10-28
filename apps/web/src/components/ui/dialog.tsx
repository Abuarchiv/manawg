'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
import { useDismissOnBack } from '@/shared/lib/use-dismiss-on-back';

function Dialog({
	open: openProp,
	defaultOpen = false,
	onOpenChange,
	actionsRef: _ignoredActionsRef,
	...props
}: DialogPrimitive.Root.Props) {
	// Back-button dismissal needs the primitive's imperative close() action, so
	// this wrapper always owns actionsRef (no caller uses it today).
	const actionsRef = React.useRef<DialogPrimitive.Root.Actions>(null);
	const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
	const open = openProp ?? uncontrolledOpen;

	useDismissOnBack(open, actionsRef);

	return (
		<DialogPrimitive.Root
			data-slot="dialog"
			open={openProp}
			defaultOpen={defaultOpen}
			actionsRef={actionsRef}
			onOpenChange={(nextOpen, eventDetails) => {
				setUncontrolledOpen(nextOpen);
				onOpenChange?.(nextOpen, eventDetails);
			}}
			{...props}
		/>
	);
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-overlay"
			className={cn(
				'fixed inset-0 isolate z-50 bg-black/40 duration-[220ms] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
				className,
			)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	showCloseButton = true,
	...props
}: DialogPrimitive.Popup.Props & {
	showCloseButton?: boolean;
}) {
	const t = useTranslations('shell.ui');
	return (
		<DialogPortal>
			{/* forceRender: a confirm dialog nested in a drawer or dialog still dims what is behind it. */}
			<DialogOverlay forceRender />
			<DialogPrimitive.Popup
				data-slot="dialog-content"
				// duration-[220ms] times the enter/exit keyframes. Without transition-none it would also
				// animate width and max-width for 220ms whenever the viewport or root font size changes.
				className={cn(
					'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[min(calc(100%-2rem),24rem)] max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 transition-none duration-[220ms] outline-none data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-2',
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close
						data-slot="dialog-close"
						render={<Button variant="ghost" className="absolute top-3.5 right-3.5" size="icon" />}
					>
						<XIcon />
						<span className="sr-only">{t('close')}</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</DialogPortal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />
	);
}

function DialogFooter({
	className,
	showCloseButton = false,
	children,
	...props
}: React.ComponentProps<'div'> & {
	showCloseButton?: boolean;
}) {
	const t = useTranslations('shell.ui');
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				'-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4',
				className,
			)}
			{...props}
		>
			{children}
			{showCloseButton && (
				<DialogPrimitive.Close render={<Button variant="outline" />}>
					{t('close')}
				</DialogPrimitive.Close>
			)}
		</div>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn('font-heading text-base leading-none font-semibold', className)}
			{...props}
		/>
	);
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn(
				'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
				className,
			)}
			{...props}
		/>
	);
}

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle };
