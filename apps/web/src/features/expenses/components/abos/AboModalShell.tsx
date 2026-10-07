'use client';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft } from 'lucide-react';
import {
	type ReactNode,
	type SyntheticEvent,
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react';

/**
 * Die Seite hält Anlegen und Bearbeiten dauerhaft eingehängt und schaltet nur dieses Flag.
 * So läuft die Schließ-Animation des Sheets, statt dass der Knoten im selben Frame verschwindet.
 */
export const AboModalOpenContext = createContext(true);

interface AboModalShellProps {
	title: string;
	onClose: () => void;
	submitting: boolean;
	children: (requestClose: () => void) => ReactNode;
}

export function AboModalShell({ title, onClose, submitting, children }: AboModalShellProps) {
	const open = useContext(AboModalOpenContext);
	const [confirmClose, setConfirmClose] = useState(false);
	const dirtyRef = useRef(false);
	// Jedes Öffnen startet sauber: kein Rest vom letzten Entwurf, keine offene Rückfrage.
	useEffect(() => {
		if (!open) return;
		dirtyRef.current = false;
		setConfirmClose(false);
	}, [open]);
	const trackFieldChange = (event: SyntheticEvent<HTMLDivElement>) => {
		const target = event.target;
		if (target instanceof Element && target.matches('input, select, textarea'))
			dirtyRef.current = true;
	};
	const trackToggleChange = (event: SyntheticEvent<HTMLDivElement>) => {
		const target = event.target;
		if (target instanceof Element && target.closest('[data-slot="toggle-group-item"]')) {
			dirtyRef.current = true;
		}
	};
	const requestClose = () => {
		if (submitting) return;
		if (!dirtyRef.current) {
			onClose();
			return;
		}
		setConfirmClose(true);
	};
	return (
		<>
			<Dialog
				open={open}
				onOpenChange={(open) => {
					if (!open) requestClose();
				}}
			>
				<DialogContent
					showCloseButton={false}
					initialFocus={() => document.getElementById('abo-description')}
					className="top-0 flex h-dvh max-h-dvh w-full max-w-md translate-y-0 flex-col gap-0 rounded-none p-0"
				>
					<DialogHeader className="shrink-0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="icon"
								onClick={requestClose}
								disabled={submitting}
								aria-label="Fixkosten-Editor schließen"
							>
								<ArrowLeft />
							</Button>
							<DialogTitle>{title}</DialogTitle>
						</div>
					</DialogHeader>
					<Separator />
					<div
						className="min-h-0 flex-1 scroll-pb-40 overflow-y-auto overscroll-contain px-4 pt-4"
						onChangeCapture={trackFieldChange}
						onInputCapture={trackFieldChange}
						onClickCapture={trackToggleChange}
					>
						{children(requestClose)}
					</div>
				</DialogContent>
			</Dialog>
			<AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Eingaben verwerfen?</AlertDialogTitle>
						<AlertDialogDescription>
							Ungespeicherte Änderungen an diesen Fixkosten gehen beim Schließen verloren. Es wird
							nichts gespeichert.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">Weiterbearbeiten</AlertDialogCancel>
						<AlertDialogAction variant="destructive" className="min-h-11" onClick={onClose}>
							Verwerfen
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
