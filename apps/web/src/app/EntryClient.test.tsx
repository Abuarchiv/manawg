import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
const getKnownWgs = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@manawg/shared/lib/identity', () => ({ getKnownWgs: () => getKnownWgs() }));

import { EntryClient } from './EntryClient';

beforeEach(() => {
	replace.mockReset();
	getKnownWgs.mockReset();
});

describe('EntryClient', () => {
	it('opens the most recently visited WG', () => {
		getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'WG Nord', lastVisitedAt: 2 },
			{ code: 'OLDCODE1', name: 'WG Alt', lastVisitedAt: 1 },
		]);

		render(<EntryClient />);

		expect(replace).toHaveBeenCalledWith('/wg/MTE8PZAT');
	});

	it('sends a first-time visitor to the join/create flow', () => {
		getKnownWgs.mockReturnValue([]);

		render(<EntryClient />);

		expect(replace).toHaveBeenCalledWith('/neu');
	});

	// getKnownWgs already returns [] when storage is blocked (private window),
	// so the entry route must degrade to /neu rather than dead-end.
	it('falls through to the join flow when no WG can be read', () => {
		getKnownWgs.mockReturnValue([]);

		render(<EntryClient />);

		expect(replace).toHaveBeenCalledWith('/neu');
		expect(screen.getByText('ManaWG wird geöffnet …')).toBeInTheDocument();
	});

	it('percent-encodes a share code so it cannot break out of the path', () => {
		getKnownWgs.mockReturnValue([{ code: 'A/B?c=1', name: 'WG', lastVisitedAt: 1 }]);

		render(<EntryClient />);

		expect(replace).toHaveBeenCalledWith('/wg/A%2FB%3Fc%3D1');
	});
});
