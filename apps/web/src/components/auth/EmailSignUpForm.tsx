'use client';

import { useState } from 'react';
import type { AuthFormProps, BusyAction } from './auth-form-shared';
import { EmailCodeForm, useEmailCode } from './EmailCodeForm';

/**
 * Registration with name and e-mail address: the mailed code creates the account and signs in.
 * No password is chosen; one can be set later under Settings > Access.
 */
export function useEmailSignUp(props: AuthFormProps & { next: string }) {
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const code = useEmailCode({ ...props, email, setEmail, signUpName: name });
	return { code, name, setName };
}

export function EmailSignUpForm({
	auth,
	busy,
	intentQuery,
}: {
	auth: ReturnType<typeof useEmailSignUp>;
	busy: BusyAction;
	intentQuery: string;
}) {
	return (
		<EmailCodeForm
			auth={auth.code}
			busy={busy}
			intentQuery={intentQuery}
			signUp={{ name: auth.name, setName: auth.setName }}
		/>
	);
}
