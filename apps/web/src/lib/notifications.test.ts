import { describe, expect, it } from 'vitest';
import {
	formatNotificationMessage,
	notificationCategoryForEvent,
	notificationPriorityForEvent,
} from './notifications';

describe('formatNotificationMessage', () => {
	it('formats expense notifications for both channels', () => {
		expect(
			formatNotificationMessage('expense.created', {
				wgName: 'Küche 4',
				title: 'Pizza',
				amountCents: 2450,
				actorName: 'Mina',
			}),
		).toEqual({
			title: 'Neue Ausgabe',
			body: 'Mina hat in Küche 4 Pizza für 24,50 € eingetragen.',
			urlPath: '/ausgaben',
		});
	});

	it('links expense notifications to the created expense when an id is present', () => {
		expect(
			formatNotificationMessage('expense.created', {
				wgName: 'Küche 4',
				title: 'Pizza',
				amountCents: 2450,
				actorName: 'Mina',
				expenseId: 'expense 1&open=true',
			}).urlPath,
		).toBe('/ausgaben?highlight=expense%201%26open%3Dtrue');
	});

	it('formats chore reminders for the assigned member', () => {
		expect(
			formatNotificationMessage('chore.due', {
				wgName: 'Küche 4',
				title: 'Bad putzen',
			}),
		).toEqual({
			title: 'Putzplan',
			body: 'Bad putzen ist heute in Küche 4 fällig.',
			urlPath: '/putzen',
		});
	});

	it('links chore reminders to the due chore when an id is present', () => {
		expect(
			formatNotificationMessage('chore.due', {
				wgName: 'Küche 4',
				title: 'Bad putzen',
				choreId: 'chore 1&open=true',
			}).urlPath,
		).toBe('/putzen?highlight=chore%201%26open%3Dtrue');
	});

	it('links shopping notifications to the created list item when an id is present', () => {
		expect(
			formatNotificationMessage('shopping.added', {
				wgName: 'Küche 4',
				title: 'Milch',
				actorName: 'Mina',
				shoppingItemId: 'shopping 1&open=true',
			}).urlPath,
		).toBe('/einkauf?highlight=shopping%201%26open%3Dtrue');
	});

	it('formats announcement interaction notifications', () => {
		expect(
			formatNotificationMessage('announcement.commented', {
				wgName: 'Küche 4',
				title: 'Kann ich übernehmen',
				actorName: 'Mina',
				announcementId: 'a1',
			}),
		).toEqual({
			title: 'Neue Antwort',
			body: 'Mina hat auf der Pinnwand geantwortet: Kann ich übernehmen',
			urlPath: '/pinnwand#announcement-a1',
		});
	});

	it('formats notification test messages', () => {
		expect(formatNotificationMessage('notification.test', { wgName: 'Küche 4' })).toEqual({
			title: 'ManaWG Test',
			body: 'Benachrichtigungen funktionieren für Küche 4.',
			urlPath: '/einstellungen#benachrichtigungen',
		});
	});

	it('formats recurring expense charges as abo notifications', () => {
		expect(
			formatNotificationMessage('expense.recurring_charged', {
				wgName: 'Küche 4',
				description: 'Netflix',
				amountCents: 1799,
				expenseId: 'e1',
			}),
		).toEqual({
			title: 'Neue Abo-Buchung',
			body: 'Neue Abo-Buchung: Netflix 17,99 €',
			urlPath: '/ausgaben?highlight=e1',
		});
	});
});

describe('notificationCategoryForEvent', () => {
	it('maps events to user-facing notification preferences', () => {
		expect(notificationCategoryForEvent('announcement.posted')).toBe('announcements');
		expect(notificationCategoryForEvent('notification.test')).toBe('announcements');
		expect(notificationCategoryForEvent('chore.due')).toBe('chores');
		expect(notificationCategoryForEvent('expense.created')).toBe('expenses');
		expect(notificationCategoryForEvent('shopping.added')).toBe('shopping');
	});
});

describe('notificationPriorityForEvent', () => {
	it('assigns channel priority levels', () => {
		expect(notificationPriorityForEvent('chore.due')).toBe('urgent');
		expect(notificationPriorityForEvent('announcement.reacted')).toBe('silent');
		expect(notificationPriorityForEvent('expense.created')).toBe('normal');
	});
});
