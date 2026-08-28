import { NeuClient } from './NeuClient';

export const dynamic = 'force-dynamic';

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function NeuPage() {
	return <NeuClient />;
}
