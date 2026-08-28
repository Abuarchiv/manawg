import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportPage from './page';

const apiClientMock = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => ({
		wg: {
			id: 'wg-1',
			name: 'Test WG',
			shareCode: 'MTE8PZAT',
			joiningEnabled: true,
		},
		members: [
			{ id: 'id-lisa', name: 'Lisa', color: null },
			{ id: 'id-tom', name: 'Tom', color: null },
		],
		identity: { memberId: 'id-lisa', name: 'Lisa' },
	}),
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

vi.mock('@/lib/wg/ocr', () => ({
	runOcrOnImage: vi.fn(),
}));

describe('ImportPage', () => {
	beforeEach(() => {
		apiClientMock.apiFetch.mockReset();
		apiClientMock.apiFetch.mockResolvedValue({
			ok: false,
			status: 400,
			error: 'invalid_body',
		});
	});

	it('renders the heading and source picker on first load', () => {
		render(<ImportPage />);
		expect(screen.getByRole('heading', { name: /Ausgaben importieren/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Splitwise CSV/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Splid CSV/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Screenshot/i })).toBeInTheDocument();
	});

	it('advances to the input step after picking a source', () => {
		render(<ImportPage />);
		fireEvent.click(screen.getByRole('button', { name: /Splitwise CSV/i }));
		expect(screen.getByRole('heading', { name: /CSV einfügen/i })).toBeInTheDocument();
	});

	it('clears the previous payload when switching import sources', () => {
		render(<ImportPage />);

		fireEvent.click(screen.getByRole('button', { name: /Splitwise CSV/i }));
		fireEvent.change(screen.getByLabelText('CSV-Inhalt'), {
			target: {
				value: 'Date,Description,Cost,Currency,Lisa\n2026-04-01,Pizza,20.00,EUR,20.00',
			},
		});
		fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));

		fireEvent.click(screen.getByRole('button', { name: /Screenshot/i }));
		const previewButton = screen.getByRole('button', { name: 'Vorschau erstellen' });

		expect(previewButton).toBeDisabled();
		fireEvent.click(previewButton);
		expect(apiClientMock.apiFetch).not.toHaveBeenCalled();
	});
});
