import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ThumbAction } from '@/components/wg/ThumbAction';
import { NAME_MAX } from '@/features/shopping/components/constants';
import { Plus } from 'lucide-react';

export function ShoppingAddBar({
	value,
	onChange,
	onSubmit,
	adding,
	addError,
	addNotice,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	adding: boolean;
	addError: string | null;
	addNotice: string | null;
}) {
	return (
		<ThumbAction>
			<div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-2">
				<form
					id="shopping-add-form"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmit();
					}}
					className="flex min-w-0 flex-wrap gap-2"
				>
					<Input
						id="shopping-name"
						value={value}
						onChange={(event) => onChange(event.target.value)}
						maxLength={NAME_MAX}
						placeholder="z. B. 2 Hafermilch"
						aria-label="Artikel-Name"
						enterKeyHint="done"
						aria-invalid={Boolean(addError)}
						aria-describedby={addError ? 'shopping-add-error' : undefined}
						className="min-w-[200px] flex-1 text-base"
					/>
					<Button
						type="submit"
						size="icon"
						// Nicht während des Speicherns sperren: ein deaktivierter Absende-Knopf blockiert auch
						// Enter im Feld, und der nächste Artikel würde nicht nachgereiht, sondern verschluckt.
						disabled={!value.trim()}
						aria-busy={adding}
						aria-label="Artikel hinzufügen"
						onPointerDown={(event) => event.preventDefault()}
						className="size-11 shrink-0"
					>
						{adding ? <Spinner aria-hidden /> : <Plus aria-hidden />}
					</Button>
				</form>
				{addError && (
					<Alert id="shopping-add-error" variant="destructive">
						<AlertDescription>{addError}</AlertDescription>
					</Alert>
				)}
				{addNotice && (
					<Alert>
						<AlertDescription>{addNotice}</AlertDescription>
					</Alert>
				)}
			</div>
		</ThumbAction>
	);
}
