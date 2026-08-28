import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardGrid } from './DashboardGrid';

const SHARE_CODE = 'WG/123?x=1';
const ENCODED_SHARE_CODE = encodeURIComponent(SHARE_CODE);
const MEMBER_ID = 'member-1';

function mockFetchAll404(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response),
	);
}

describe('DashboardGrid', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		if (typeof window !== 'undefined') window.localStorage.clear();
	});

	it('mounts all five new module cards when no expenses exist', async () => {
		mockFetchAll404();

		render(<DashboardGrid shareCode={SHARE_CODE} memberId={MEMBER_ID} expenseCount={0} />);

		expect(screen.getByRole('heading', { name: 'Kalender' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Vorräte' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Abos' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Mahnungen' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Import' })).toBeInTheDocument();

		await waitFor(() => {
			expect(screen.getAllByText('Feature kommt bald').length).toBeGreaterThan(0);
		});
	});

	it('falls back gracefully when endpoints return 404', async () => {
		mockFetchAll404();

		render(<DashboardGrid shareCode={SHARE_CODE} memberId={MEMBER_ID} expenseCount={0} />);

		await waitFor(() => {
			expect(screen.getAllByText('Feature kommt bald')).toHaveLength(4);
		});
	});

	it('hides the import hint once the WG has enough expenses', () => {
		mockFetchAll404();

		render(<DashboardGrid shareCode={SHARE_CODE} memberId={MEMBER_ID} expenseCount={5} />);

		expect(screen.queryByRole('heading', { name: 'Import' })).not.toBeInTheDocument();
	});

	it('encodes the share code when calling the events endpoint', async () => {
		mockFetchAll404();

		render(<DashboardGrid shareCode={SHARE_CODE} memberId={MEMBER_ID} expenseCount={0} />);

		await waitFor(() => {
			const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
			const eventsCall = calls.find(
				(call) => typeof call[0] === 'string' && (call[0] as string).includes('/events'),
			);
			expect(eventsCall).toBeDefined();
			expect(String(eventsCall?.[0])).toContain(`/api/wg/${ENCODED_SHARE_CODE}/events`);
		});
	});

	it('hides the import hint after dismissal via localStorage', () => {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(`manawg.dismissed_import_hint.${SHARE_CODE}`, '1');
		}
		mockFetchAll404();

		render(<DashboardGrid shareCode={SHARE_CODE} memberId={MEMBER_ID} expenseCount={0} />);

		expect(screen.queryByRole('heading', { name: 'Import' })).not.toBeInTheDocument();
	});
});
