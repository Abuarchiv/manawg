import { type E2EWgFixture, buildE2EChatMessages, getE2EWgFixture } from './data';
import { isE2EDbDownMode } from './mode';

export interface FixtureWgView {
	wg: E2EWgFixture;
	/** Fixture rosters are always fully active. */
	members: Array<E2EWgFixture['members'][number] & { active: true }>;
	chatMessages: () => ReturnType<typeof buildE2EChatMessages>;
}

/**
 * The single page-data seam for `/wg/[code]/**` in the database-free build.
 *
 * `null` means this is a real build and the page loads from the database;
 * `'not_found'` means the fixture build has no WG under this share code.
 */
export function loadFixtureWgView(code: string): FixtureWgView | 'not_found' | null {
	if (!isE2EDbDownMode()) return null;
	const wg = getE2EWgFixture(code);
	if (!wg) return 'not_found';
	return {
		wg,
		members: wg.members.map((member) => ({ ...member, active: true as const })),
		chatMessages: () => buildE2EChatMessages(wg.id),
	};
}
