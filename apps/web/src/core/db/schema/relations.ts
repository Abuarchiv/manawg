import { relations } from 'drizzle-orm';
import { announcements } from './announcements';
import { wgChatMessages } from './chat';
import { auditEvents, calendarSubscriptions, wgEvents } from './events';
import { expensePayments, expenseReminders, expenseSplits, expenses } from './expenses';
import { chores, shoppingItems } from './household';
import { pushSubscriptions, wgMembers, wgs } from './wg';

export const wgsRelations = relations(wgs, ({ many }) => ({
	members: many(wgMembers),
	expenses: many(expenses),
	expensePayments: many(expensePayments),
	shoppingItems: many(shoppingItems),
	announcements: many(announcements),
	chores: many(chores),
	wgEvents: many(wgEvents),
	auditEvents: many(auditEvents),
	expenseReminders: many(expenseReminders),
	chatMessages: many(wgChatMessages),
	calendarSubscriptions: many(calendarSubscriptions),
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
