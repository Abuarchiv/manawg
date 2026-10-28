import * as React from 'react';

function getStrictContext<T>(
	name?: string,
): readonly [
	({ value, children }: { value: T; children?: React.ReactNode }) => React.JSX.Element,
	() => T,
] {
	const Context = React.createContext<T | undefined>(undefined);

	// biome-ignore lint/correctness/noComponentHookFactories: one typed context per factory call is the point of this helper
	const Provider = ({ value, children }: { value: T; children?: React.ReactNode }) => (
		<Context.Provider value={value}>{children}</Context.Provider>
	);

	// biome-ignore lint/correctness/noComponentHookFactories: reads the context created by this factory call
	const useSafeContext = () => {
		const ctx = React.useContext(Context);
		if (ctx === undefined) {
			throw new Error(`useContext must be used within ${name ?? 'a Provider'}`);
		}
		return ctx;
	};

	return [Provider, useSafeContext] as const;
}

export { getStrictContext };
