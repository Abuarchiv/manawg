import { Input as InputPrimitive } from '@base-ui/react/input';
import { Eye, EyeOff } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/shared/lib/cn';

// A keyboard labelled "next" must move on, not submit a half-filled form
// (Apple HIG / Material 3); browsers only change the key's label.
function focusNextField(event: React.KeyboardEvent<HTMLInputElement>): void {
	const input = event.currentTarget;
	if (event.key !== 'Enter' || event.nativeEvent.isComposing || !input.form) return;
	const fields = Array.from(input.form.elements).filter(
		(el): el is HTMLElement =>
			el instanceof HTMLElement &&
			el.tabIndex >= 0 &&
			!el.matches(':disabled, [type=hidden], [type=submit], [data-password-toggle]') &&
			el.getClientRects().length > 0,
	);
	const next = fields[fields.indexOf(input) + 1];
	if (!next) return;
	event.preventDefault();
	next.focus();
}

function InputField({ className, type, onKeyDown, ...props }: React.ComponentProps<'input'>) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				'h-11 w-full min-w-0 max-w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none group-data-[invalid=true]/field:text-foreground data-[slot=input-group-control]:h-full data-[slot=input-group-control]:min-h-0 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-transparent dark:disabled:bg-transparent dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
				className,
			)}
			onKeyDown={(event) => {
				onKeyDown?.(event);
				if (!event.defaultPrevented && props.enterKeyHint === 'next') focusNextField(event);
			}}
			{...props}
		/>
	);
}

// Every password field offers the usual show/hide toggle; the field keeps its own id, name and autofill hints.
function PasswordInput({ className, ...props }: React.ComponentProps<'input'>) {
	const [visible, setVisible] = React.useState(false);
	return (
		<div className="relative w-full">
			<InputField
				{...props}
				type={visible ? 'text' : 'password'}
				className={cn('pr-11', className)}
			/>
			<button
				type="button"
				data-password-toggle
				aria-pressed={visible}
				aria-label={visible ? 'Passwort verbergen' : 'Passwort anzeigen'}
				onClick={() => setVisible((value) => !value)}
				className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				{visible ? (
					<EyeOff aria-hidden className="size-4" />
				) : (
					<Eye aria-hidden className="size-4" />
				)}
			</button>
		</div>
	);
}

function Input(props: React.ComponentProps<'input'>) {
	return props.type === 'password' ? <PasswordInput {...props} /> : <InputField {...props} />;
}

export { Input };
