import { fixtureClientProps } from '@/fixtures/client-mode';
import { NeuClient } from './NeuClient';

export const dynamic = 'force-dynamic';

export default function NeuPage() {
	return <NeuClient {...fixtureClientProps()} />;
}
