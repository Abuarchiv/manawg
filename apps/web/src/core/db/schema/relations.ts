/** Drizzle relational-query wiring between the tables of every domain module. */
import { relations } from 'drizzle-orm';
import { calendarSubscriptions, wgEvents } from './calendar';
import { wgChatMentions, wgChatMessages, wgChatReactions, wgChatReads } from './chat';
import {
	expenseImports,
	expensePayments,
	expenseReminders,
	expenseSplits,
	expenses,
} from './expenses';
import { chores, shoppingItems, wgInventoryItems, wgInventoryLog } from './household';
import { announcements } from './pinnwand';
import { auditEvents, pushSubscriptions, wgMembers, wgs } from './wg';

export const wgsRelations = relations(wgs, ({ many }) => ({
	members: many(wgMembers),
	expenses: many(expenses),
	expensePayments: many(expensePayments),
	shoppingItems: many(shoppingItems),
	announcements: many(announcements),
	chores: many(chores),
	wgEvents: many(wgEvents),
	inventoryItems: many(wgInventoryItems),
	auditEvents: many(auditEvents),
	expenseReminders: many(expenseReminders),
	chatMessages: many(wgChatMessages),
	calendarSubscriptions: many(calendarSubscriptions),
}));

export const expenseRemindersRelations = relations(expenseReminders, ({ one }) => ({
	wg: one(wgs, { fields: [expenseReminders.wgId], references: [wgs.id] }),
	debtor: one(wgMembers, {
		fields: [expenseReminders.debtorMemberId],
		references: [wgMembers.id],
		relationName: 'reminderDebtor',
	}),
	creditor: one(wgMembers, {
		fields: [expenseReminders.creditorMemberId],
		references: [wgMembers.id],
		relationName: 'reminderCreditor',
	}),
	sentBy: one(wgMembers, {
		fields: [expenseReminders.sentByMemberId],
		references: [wgMembers.id],
		relationName: 'reminderSentBy',
	}),
}));

export const wgEventsRelations = relations(wgEvents, ({ one }) => ({
	wg: one(wgs, { fields: [wgEvents.wgId], references: [wgs.id] }),
	createdBy: one(wgMembers, {
		fields: [wgEvents.createdByMemberId],
		references: [wgMembers.id],
	}),
}));

export const calendarSubscriptionsRelations = relations(calendarSubscriptions, ({ one }) => ({
	wg: one(wgs, { fields: [calendarSubscriptions.wgId], references: [wgs.id] }),
	member: one(wgMembers, { fields: [calendarSubscriptions.memberId], references: [wgMembers.id] }),
}));

export const wgInventoryItemsRelations = relations(wgInventoryItems, ({ one, many }) => ({
	wg: one(wgs, { fields: [wgInventoryItems.wgId], references: [wgs.id] }),
	logs: many(wgInventoryLog),
}));

export const wgInventoryLogRelations = relations(wgInventoryLog, ({ one }) => ({
	item: one(wgInventoryItems, {
		fields: [wgInventoryLog.itemId],
		references: [wgInventoryItems.id],
	}),
	member: one(wgMembers, {
		fields: [wgInventoryLog.memberId],
		references: [wgMembers.id],
	}),
}));

export const wgChatMessagesRelations = relations(wgChatMessages, ({ one, many }) => ({
	wg: one(wgs, { fields: [wgChatMessages.wgId], references: [wgs.id] }),
	sender: one(wgMembers, {
		fields: [wgChatMessages.senderMemberId],
		references: [wgMembers.id],
	}),
	replyTo: one(wgChatMessages, {
		fields: [wgChatMessages.replyToMessageId],
		references: [wgChatMessages.id],
		relationName: 'wgChatMessageReply',
	}),
	replies: many(wgChatMessages, { relationName: 'wgChatMessageReply' }),
	reactions: many(wgChatReactions),
	mentions: many(wgChatMentions),
}));

export const wgChatReactionsRelations = relations(wgChatReactions, ({ one }) => ({
	message: one(wgChatMessages, {
		fields: [wgChatReactions.messageId],
		references: [wgChatMessages.id],
	}),
	member: one(wgMembers, {
		fields: [wgChatReactions.memberId],
		references: [wgMembers.id],
	}),
}));

export const wgChatReadsRelations = relations(wgChatReads, ({ one }) => ({
	wg: one(wgs, { fields: [wgChatReads.wgId], references: [wgs.id] }),
	member: one(wgMembers, { fields: [wgChatReads.memberId], references: [wgMembers.id] }),
	lastReadMessage: one(wgChatMessages, {
		fields: [wgChatReads.lastReadMessageId],
		references: [wgChatMessages.id],
	}),
}));

export const wgChatMentionsRelations = relations(wgChatMentions, ({ one }) => ({
	message: one(wgChatMessages, {
		fields: [wgChatMentions.messageId],
		references: [wgChatMessages.id],
	}),
	member: one(wgMembers, {
		fields: [wgChatMentions.mentionedMemberId],
		references: [wgMembers.id],
	}),
}));

export const wgMembersRelations = relations(wgMembers, ({ one, many }) => ({
	wg: one(wgs, { fields: [wgMembers.wgId], references: [wgs.id] }),
	paidExpenses: many(expenses),
	debts: many(expenseSplits),
	expensePaymentsFrom: many(expensePayments, { relationName: 'paymentFrom' }),
	expensePaymentsTo: many(expensePayments, { relationName: 'paymentTo' }),
	pushSubscriptions: many(pushSubscriptions),
	calendarSubscriptions: many(calendarSubscriptions),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
	member: one(wgMembers, {
		fields: [pushSubscriptions.memberId],
		references: [wgMembers.id],
	}),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
	wg: one(wgs, { fields: [expenses.wgId], references: [wgs.id] }),
	paidBy: one(wgMembers, {
		fields: [expenses.paidByMemberId],
		references: [wgMembers.id],
	}),
	import: one(expenseImports, {
		fields: [expenses.importId],
		references: [expenseImports.id],
	}),
	splits: many(expenseSplits),
}));

export const expenseImportsRelations = relations(expenseImports, ({ one, many }) => ({
	wg: one(wgs, { fields: [expenseImports.wgId], references: [wgs.id] }),
	importedBy: one(wgMembers, {
		fields: [expenseImports.importedByMemberId],
		references: [wgMembers.id],
	}),
	expenses: many(expenses),
}));

export const expenseSplitsRelations = relations(expenseSplits, ({ one }) => ({
	expense: one(expenses, {
		fields: [expenseSplits.expenseId],
		references: [expenses.id],
	}),
	debtor: one(wgMembers, {
		fields: [expenseSplits.debtorMemberId],
		references: [wgMembers.id],
	}),
}));

export const expensePaymentsRelations = relations(expensePayments, ({ one }) => ({
	wg: one(wgs, { fields: [expensePayments.wgId], references: [wgs.id] }),
	fromMember: one(wgMembers, {
		fields: [expensePayments.fromMemberId],
		references: [wgMembers.id],
		relationName: 'paymentFrom',
	}),
	toMember: one(wgMembers, {
		fields: [expensePayments.toMemberId],
		references: [wgMembers.id],
		relationName: 'paymentTo',
	}),
}));
