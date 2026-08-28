import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type BubbleMessage, MessageBubble } from './MessageBubble';

function buildMessage(overrides: Partial<BubbleMessage> = {}): BubbleMessage {
	return {
		id: 'msg-1',
		senderMemberId: 'member-1',
		kind: 'text',
		body: 'Ursprünglicher Text',
		imageUrl: null,
		createdAt: new Date().toISOString(),
		editedAt: null,
		deletedAt: null,
		replyToMessageId: null,
		...overrides,
	};
}

describe('MessageBubble', () => {
	it('shows the latest message body when reopening the edit form after an external update', () => {
		const { rerender } = render(
			<MessageBubble
				message={buildMessage({ body: 'Ursprünglicher Text' })}
				sender={{ name: 'Anna', color: null }}
				currentMemberId="member-1"
				isAdmin={false}
				isOwn
				reactions={[]}
				replyTo={null}
				replyToSender={null}
				onReact={vi.fn()}
				onUnreact={vi.fn()}
				onEdit={vi.fn().mockResolvedValue(undefined)}
				onDelete={vi.fn().mockResolvedValue(undefined)}
				onReply={vi.fn()}
			/>,
		);

		// A newer edit (e.g. from a realtime refresh) lands while the menu is closed.
		rerender(
			<MessageBubble
				message={buildMessage({ body: 'Neuer Text von woanders' })}
				sender={{ name: 'Anna', color: null }}
				currentMemberId="member-1"
				isAdmin={false}
				isOwn
				reactions={[]}
				replyTo={null}
				replyToSender={null}
				onReact={vi.fn()}
				onUnreact={vi.fn()}
				onEdit={vi.fn().mockResolvedValue(undefined)}
				onDelete={vi.fn().mockResolvedValue(undefined)}
				onReply={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: /Aktionen für Nachricht/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));

		expect(screen.getByLabelText('Nachricht bearbeiten')).toHaveValue('Neuer Text von woanders');
	});

	it("offers delete on another member's message when the viewer is admin", () => {
		render(
			<MessageBubble
				message={buildMessage({ senderMemberId: 'someone-else' })}
				sender={{ name: 'Anna', color: null }}
				currentMemberId="member-1"
				isAdmin
				isOwn={false}
				reactions={[]}
				replyTo={null}
				replyToSender={null}
				onReact={vi.fn()}
				onUnreact={vi.fn()}
				onEdit={vi.fn().mockResolvedValue(undefined)}
				onDelete={vi.fn().mockResolvedValue(undefined)}
				onReply={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: /Aktionen für Nachricht/ }));

		expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
	});

	it("does not offer delete on another member's message when the viewer is not admin", () => {
		render(
			<MessageBubble
				message={buildMessage({ senderMemberId: 'someone-else' })}
				sender={{ name: 'Anna', color: null }}
				currentMemberId="member-1"
				isAdmin={false}
				isOwn={false}
				reactions={[]}
				replyTo={null}
				replyToSender={null}
				onReact={vi.fn()}
				onUnreact={vi.fn()}
				onEdit={vi.fn().mockResolvedValue(undefined)}
				onDelete={vi.fn().mockResolvedValue(undefined)}
				onReply={vi.fn()}
			/>,
		);

		expect(
			screen.queryByRole('button', { name: /Aktionen für Nachricht/ }),
		).not.toBeInTheDocument();
	});
});
