import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageUploader } from './ImageUploader';

const imageStoreMock = vi.hoisted(() => ({
	readPendingImage: vi.fn(),
	storePendingImage: vi.fn(),
	uploadPendingImageToken: vi.fn(),
}));
const wgContextMock = vi.hoisted(() => ({
	identity: {
		memberId: 'member-1',
		memberToken: 'member-token-1' as string | undefined,
		name: 'Ava',
	},
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => ({
		identity: wgContextMock.identity,
	}),
}));

vi.mock('@/core/offline/offline-images', () => ({
	isPendingImageToken: (value: string | null | undefined) =>
		Boolean(value?.startsWith('manawg-pending-image:')),
	readPendingImage: imageStoreMock.readPendingImage,
	removePendingImage: vi.fn().mockResolvedValue(undefined),
	storePendingImage: imageStoreMock.storePendingImage,
	uploadPendingImageToken: imageStoreMock.uploadPendingImageToken,
}));

describe('ImageUploader', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		wgContextMock.identity.memberToken = 'member-token-1';
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
		imageStoreMock.readPendingImage.mockResolvedValue(null);
		imageStoreMock.uploadPendingImageToken.mockRejectedValue(new Error('network down'));
	});

	it('shows a visible message when uploads are not configured', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 503,
				ok: false,
				clone: () => ({
					json: () => Promise.resolve({ error: 'feature_disabled' }),
				}),
			}),
		);
		const file = new File(['image'], 'receipt.png', { type: 'image/png' });

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value={null}
				onChange={() => undefined}
			/>,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild-Upload ist noch nicht konfiguriert.',
		);
	});

	it('keeps the selected image pending when the upload signature service is temporarily unavailable', async () => {
		imageStoreMock.storePendingImage.mockResolvedValue('manawg-pending-image:receipt-db');
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 503,
				ok: false,
				clone: () => ({
					json: () => Promise.resolve({ error: 'db_error' }),
				}),
			}),
		);
		const onChange = vi.fn();
		const file = new File(['image'], 'receipt.png', { type: 'image/png' });

		render(
			<ImageUploader shareCode="MTE8PZAT" purpose="expense" value={null} onChange={onChange} />,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});

		expect(await screen.findByRole('status')).toHaveTextContent(
			'Bild vorbereitet. Der Upload startet automatisch, sobald das Netz wieder stabil ist.',
		);
		expect(screen.queryByText('Bild-Upload ist noch nicht konfiguriert.')).not.toBeInTheDocument();
		expect(onChange).toHaveBeenCalledWith('manawg-pending-image:receipt-db');
	});

	it('keeps the selected image as a pending upload when the network drops mid-upload', async () => {
		imageStoreMock.storePendingImage.mockResolvedValue('manawg-pending-image:receipt-1');
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
		const onChange = vi.fn();
		const file = new File(['image'], 'receipt.png', { type: 'image/png' });

		render(
			<ImageUploader shareCode="MTE8PZAT" purpose="expense" value={null} onChange={onChange} />,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});

		expect(await screen.findByRole('status')).toHaveTextContent(
			'Bild vorbereitet. Der Upload startet automatisch, sobald das Netz wieder stabil ist.',
		);
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		expect(imageStoreMock.storePendingImage).toHaveBeenCalledWith({
			file,
			shareCode: 'MTE8PZAT',
			purpose: 'expense',
		});
		expect(onChange).toHaveBeenCalledWith('manawg-pending-image:receipt-1');
	});

	it('explains stale membership when the upload signature is denied', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 401,
				ok: false,
				clone: () => ({
					json: () => Promise.resolve({ error: 'not_a_member' }),
				}),
			}),
		);
		const onChange = vi.fn();
		const file = new File(['image'], 'receipt.png', { type: 'image/png' });

		render(
			<ImageUploader shareCode="MTE8PZAT" purpose="expense" value={null} onChange={onChange} />,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild konnte nicht hochgeladen werden: Tritt der WG erneut bei.',
		);
		expect(screen.queryByText('Konnte Upload-Signatur nicht holen.')).not.toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
		expect(imageStoreMock.storePendingImage).not.toHaveBeenCalled();
	});

	it('explains invalid upload signature requests without raw API codes', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 400,
				ok: false,
				clone: () => ({
					json: () => Promise.resolve({ error: 'invalid_body' }),
				}),
			}),
		);
		const onChange = vi.fn();
		const file = new File(['image'], 'receipt.png', { type: 'image/png' });

		render(
			<ImageUploader shareCode="MTE8PZAT" purpose="expense" value={null} onChange={onChange} />,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild konnte nicht hochgeladen werden: Die Anfrage war ungültig.',
		);
		expect(screen.queryByText('Konnte Upload-Signatur nicht holen.')).not.toBeInTheDocument();
		expect(screen.queryByText('invalid_body')).not.toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
		expect(imageStoreMock.storePendingImage).not.toHaveBeenCalled();
	});

	it('explains server-side mime type and size rejections with actionable copy', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				status: 400,
				ok: false,
				clone: () => ({
					json: () => Promise.resolve({ error: 'invalid_mime_type' }),
				}),
			})
			.mockResolvedValueOnce({
				status: 400,
				ok: false,
				clone: () => ({
					json: () => Promise.resolve({ error: 'file_too_large' }),
				}),
			});
		vi.stubGlobal('fetch', fetchMock);
		const file = new File(['image'], 'receipt.png', { type: 'image/png' });

		const { unmount } = render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value={null}
				onChange={() => undefined}
			/>,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild konnte nicht hochgeladen werden: Bitte JPG, PNG, WebP oder HEIC wählen.',
		);
		unmount();

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value={null}
				onChange={() => undefined}
			/>,
		);
		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild konnte nicht hochgeladen werden: Das Bild ist zu groß.',
		);
	});

	it('does not start duplicate file uploads from rapid file selections', async () => {
		const fetchMock = vi.fn(() => new Promise(() => undefined));
		vi.stubGlobal('fetch', fetchMock);
		const file = new File(['image'], 'receipt.png', { type: 'image/png' });

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value={null}
				onChange={() => undefined}
			/>,
		);

		const input = screen.getByLabelText(/Bild hinzufügen/);
		fireEvent.change(input, { target: { files: [file] } });
		fireEvent.change(input, { target: { files: [file] } });

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
	});

	it('keeps file selection and removal disabled when the parent form is saving', () => {
		const onChange = vi.fn();

		const { rerender } = render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="announcement"
				value={null}
				onChange={onChange}
				disabled
			/>,
		);

		expect(screen.getByLabelText(/Bild hinzufügen/)).toBeDisabled();

		rerender(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="announcement"
				value="https://cdn.example.test/notice.png"
				onChange={onChange}
				disabled
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Beitragsbild entfernen' }));

		expect(screen.getByRole('button', { name: 'Beitragsbild entfernen' })).toBeDisabled();
		expect(onChange).not.toHaveBeenCalled();
	});

	it('rejects unsupported image formats before requesting an upload signature', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const file = new File(['image'], 'receipt.gif', { type: 'image/gif' });

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value={null}
				onChange={() => undefined}
			/>,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bitte JPG, PNG, WebP oder HEIC wählen.',
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('opens uploaded images in a named preview dialog', () => {
		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="https://cdn.example.test/receipt.png"
				onChange={() => undefined}
				imageLabel="Beleg"
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Beleg groß anzeigen' }));

		expect(screen.getByRole('dialog', { name: 'Beleg-Vorschau' })).toBeVisible();
		expect(screen.getByRole('img', { name: 'Beleg groß' })).toBeVisible();
	});

	it('renders image preview actions as touch-sized controls', () => {
		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="https://cdn.example.test/receipt.png"
				onChange={() => undefined}
				imageLabel="Beleg"
			/>,
		);

		expect(screen.getByRole('button', { name: 'Beleg groß anzeigen' })).toHaveClass('h-11', 'w-11');
		expect(screen.getByRole('button', { name: 'Beleg entfernen' })).toHaveClass('h-11', 'w-11');
	});

	it('renders the image preview close action as a touch-sized control', () => {
		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="https://cdn.example.test/receipt.png"
				onChange={() => undefined}
				imageLabel="Beleg"
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Beleg groß anzeigen' }));

		expect(screen.getByRole('button', { name: 'Beleg-Vorschau schließen' })).toHaveClass(
			'h-11',
			'w-11',
		);
	});

	it('closes the image preview from the dialog button', () => {
		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="https://cdn.example.test/receipt.png"
				onChange={() => undefined}
				imageLabel="Beleg"
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Beleg groß anzeigen' }));
		fireEvent.click(screen.getByRole('button', { name: 'Beleg-Vorschau schließen' }));

		expect(screen.queryByRole('dialog', { name: 'Beleg-Vorschau' })).not.toBeInTheDocument();
	});

	it('keeps the selected image pending when the signing endpoint has a temporary outage', async () => {
		imageStoreMock.storePendingImage.mockResolvedValue('manawg-pending-image:receipt-2');
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 500,
				ok: false,
			}),
		);
		const onChange = vi.fn();
		const file = new File(['image'], 'receipt.png', { type: 'image/png' });

		render(
			<ImageUploader shareCode="MTE8PZAT" purpose="expense" value={null} onChange={onChange} />,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});

		expect(await screen.findByRole('status')).toHaveTextContent(
			'Bild vorbereitet. Der Upload startet automatisch, sobald das Netz wieder stabil ist.',
		);
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		expect(onChange).toHaveBeenCalledWith('manawg-pending-image:receipt-2');
	});

	it('announces pending image retry as status instead of an error', async () => {
		imageStoreMock.readPendingImage.mockResolvedValue({
			file: new File(['image'], 'receipt.png', { type: 'image/png' }),
		});
		imageStoreMock.uploadPendingImageToken.mockRejectedValue(new Error('network down'));

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="manawg-pending-image:receipt-4"
				onChange={() => undefined}
			/>,
		);

		expect(await screen.findByRole('status')).toHaveTextContent(
			'Bild ist vorbereitet und wird erneut hochgeladen, sobald das Netz stabil ist.',
		);
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('explains stale membership when a pending image upload is rejected later', async () => {
		imageStoreMock.readPendingImage.mockResolvedValue({
			file: new File(['image'], 'receipt.png', { type: 'image/png' }),
		});
		imageStoreMock.uploadPendingImageToken.mockRejectedValue(
			new Error('sign-failed:401:not_a_member'),
		);

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="manawg-pending-image:receipt-auth"
				onChange={() => undefined}
			/>,
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild konnte nicht hochgeladen werden: Tritt der WG erneut bei.',
		);
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('explains disabled image uploads when a pending image retry is rejected later', async () => {
		imageStoreMock.readPendingImage.mockResolvedValue({
			file: new File(['image'], 'receipt.png', { type: 'image/png' }),
		});
		imageStoreMock.uploadPendingImageToken.mockRejectedValue(
			new Error('sign-failed:503:feature_disabled'),
		);

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="manawg-pending-image:receipt-disabled"
				onChange={() => undefined}
			/>,
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild-Upload ist noch nicht konfiguriert.',
		);
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('does not start duplicate pending image syncs from repeated online events', async () => {
		imageStoreMock.uploadPendingImageToken.mockReturnValue(new Promise(() => undefined));

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="manawg-pending-image:receipt-3"
				onChange={() => undefined}
			/>,
		);

		await waitFor(() => expect(imageStoreMock.uploadPendingImageToken).toHaveBeenCalledTimes(1));
		expect(imageStoreMock.uploadPendingImageToken).toHaveBeenCalledWith(
			'manawg-pending-image:receipt-3',
			'member-1',
			'member-token-1',
		);

		window.dispatchEvent(new Event('online'));
		window.dispatchEvent(new Event('online'));

		expect(imageStoreMock.uploadPendingImageToken).toHaveBeenCalledTimes(1);
	});

	it('keeps uploads pending until a tokenless legacy identity reloads the WG', async () => {
		wgContextMock.identity.memberToken = undefined;
		imageStoreMock.storePendingImage.mockResolvedValue('manawg-pending-image:legacy');
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value={null}
				onChange={() => undefined}
			/>,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [new File(['image'], 'receipt.png', { type: 'image/png' })] },
		});

		expect(await screen.findByRole('status')).toHaveTextContent(
			'Bild vorbereitet. Öffne die WG erneut, um den Upload fortzusetzen.',
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps pending image removal disabled while the background upload is running', async () => {
		imageStoreMock.readPendingImage.mockResolvedValue({
			file: new File(['image'], 'receipt.png', { type: 'image/png' }),
		});
		imageStoreMock.uploadPendingImageToken.mockReturnValue(new Promise(() => undefined));
		const onChange = vi.fn();

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="manawg-pending-image:receipt-5"
				onChange={onChange}
			/>,
		);

		await waitFor(() => expect(imageStoreMock.uploadPendingImageToken).toHaveBeenCalledTimes(1));
		const removeButton = screen.getByRole('button', { name: 'Belegbild entfernen' });

		expect(removeButton).toBeDisabled();
		fireEvent.click(removeButton);
		expect(onChange).not.toHaveBeenCalledWith(null);
	});

	it('shows a clear error when the offline image store is unavailable', async () => {
		imageStoreMock.storePendingImage.mockRejectedValue(new Error('indexeddb blocked'));
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
		const onChange = vi.fn();
		const file = new File(['image'], 'receipt.png', { type: 'image/png' });

		render(
			<ImageUploader shareCode="MTE8PZAT" purpose="expense" value={null} onChange={onChange} />,
		);

		fireEvent.change(screen.getByLabelText(/Bild hinzufügen/), {
			target: { files: [file] },
		});

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild konnte nicht zwischengespeichert werden. Versuche es später erneut.',
		);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('shows a clear error when a pending image is no longer available on this device', async () => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
		imageStoreMock.readPendingImage.mockResolvedValue(null);
		const onChange = vi.fn();

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="manawg-pending-image:missing"
				onChange={onChange}
			/>,
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild konnte auf diesem Gerät nicht mehr gefunden werden. Entferne den Platzhalter und wähle es erneut aus.',
		);
		expect(onChange).toHaveBeenCalledWith(null);
	});

	it('removes a pending upload token when the stored image is missing', async () => {
		imageStoreMock.uploadPendingImageToken.mockRejectedValue(new Error('pending-image-missing'));
		const onChange = vi.fn();

		render(
			<ImageUploader
				shareCode="MTE8PZAT"
				purpose="expense"
				value="manawg-pending-image:missing"
				onChange={onChange}
			/>,
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Bild konnte auf diesem Gerät nicht mehr gefunden werden. Entferne den Platzhalter und wähle es erneut aus.',
		);
		expect(onChange).toHaveBeenCalledWith(null);
	});
});
