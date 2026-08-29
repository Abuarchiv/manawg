import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';

vi.mock('@/shared/lib/haptics', () => ({ haptic: vi.fn() }));

describe('ChatComposer', () => {
	it('detects a mention for a member name ending in a diacritic', async () => {
		const onSend = vi.fn().mockResolvedValue(true);
		render(
			<ChatComposer
				members={[{ id: 'member-2', name: 'René' }]}
				currentMemberId="member-1"
				replyToMessageId={null}
				replyToPreview={null}
				replyToSenderName={null}
				onClearReply={vi.fn()}
				onSend={onSend}
				onPickImage={vi.fn()}
			/>,
		);

		const textarea = screen.getByRole('textbox', { name: 'Chat-Nachricht' });
		fireEvent.change(textarea, { target: { value: 'Hi @René wie geht es dir?' } });
		fireEvent.click(screen.getByRole('button', { name: 'Nachricht senden' }));

		await screen.findByRole('textbox');
		expect(onSend).toHaveBeenCalledWith(
			expect.objectContaining({ mentionMemberIds: ['member-2'] }),
		);
	});

	it('does not treat a diacritic as a word boundary, so a shorter name is not a false-positive prefix match', async () => {
		const onSend = vi.fn().mockResolvedValue(true);
		render(
			<ChatComposer
				members={[
					{ id: 'member-2', name: 'René' },
					{ id: 'member-3', name: 'Ren' },
				]}
				currentMemberId="member-1"
				replyToMessageId={null}
				replyToPreview={null}
				replyToSenderName={null}
				onClearReply={vi.fn()}
				onSend={onSend}
				onPickImage={vi.fn()}
			/>,
		);

		const textarea = screen.getByRole('textbox', { name: 'Chat-Nachricht' });
		fireEvent.change(textarea, { target: { value: 'Hi @René wie geht es dir?' } });
		fireEvent.click(screen.getByRole('button', { name: 'Nachricht senden' }));

		await screen.findByRole('textbox');
		expect(onSend).toHaveBeenCalledWith(
			expect.objectContaining({ mentionMemberIds: ['member-2'] }),
		);
	});
});
