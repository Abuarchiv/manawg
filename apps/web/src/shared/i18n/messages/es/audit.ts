import type { Catalog } from '../catalog';
import type de from '../de/audit';

/** Spanish verbs change with the person: second person for the reader's own rows, third person otherwise. */
const v = (you: string, other: string) => `{self, select, yes {${you}} other {${other}}}`;

export default {
	summary: '{actorName} {text}',
	absenceCreated: { feed: `${v('añadiste', 'añadió')} una ausencia.` },
	absenceDeleted: { feed: `${v('eliminaste', 'eliminó')} una ausencia.` },
	announcementCommentCreated: { feed: `${v('escribiste', 'escribió')} una respuesta.` },
	announcementCommentUpdated: { feed: `${v('actualizaste', 'actualizó')} una respuesta.` },
	announcementCommentDeleted: {
		feed: `${v('eliminaste', 'eliminó')} una respuesta{moderated, select, yes { como admin} other {}}.`,
	},
	announcementReactionAdded: { feed: `${v('reaccionaste', 'reaccionó')} con “{reaction}”.` },
	announcementReactionRemoved: { feed: `${v('quitaste', 'quitó')} una reacción.` },
	announcementCreated: { feed: `${v('creaste', 'creó')} una publicación en el tablón.` },
	announcementUpdated: {
		feed: `{change, select, resolved {${v('marcaste', 'marcó')} una publicación del tablón como resuelta.} open {${v('reabriste', 'reabrió')} una publicación del tablón.} other {${v('actualizaste', 'actualizó')} una publicación del tablón.}}`,
	},
	announcementDeleted: { feed: `${v('eliminaste', 'eliminó')} una publicación del tablón.` },
	calendarFeedCreated: { feed: `${v('creaste', 'creó')} el feed del calendario.` },
	calendarFeedRotated: { feed: `${v('renovaste', 'renovó')} el feed del calendario.` },
	calendarFeedRevoked: { feed: `${v('revocaste', 'revocó')} el feed del calendario.` },
	chatMessageCreated: { feed: `${v('enviaste', 'envió')} un mensaje en el chat.` },
	chatMessageEdited: { feed: `${v('editaste', 'editó')} un mensaje del chat.` },
	chatMessageDeleted: { feed: `${v('eliminaste', 'eliminó')} un mensaje del chat.` },
	choreCreated: { feed: `${v('añadiste', 'añadió')} {title} al plan de limpieza.` },
	choreUpdated: { feed: `${v('actualizaste', 'actualizó')} {title}.` },
	choreDeleted: { feed: `${v('eliminaste', 'eliminó')} {title} del plan de limpieza.` },
	choreCompleted: { feed: `${v('completaste', 'completó')} {title}.` },
	choreCompletionUndone: { feed: `${v('desmarcaste', 'desmarcó')} {title} como completada.` },
	eventCreated: { feed: `${v('añadiste', 'añadió')} el evento “{title}”.` },
	eventUpdated: {
		feed: `{occurrence, select, cancel {${v('eliminaste', 'eliminó')} una fecha de la serie “{title}”.} change {${v('modificaste', 'modificó')} una fecha de la serie “{title}”.} other {${v('actualizaste', 'actualizó')} el evento “{title}”.}}`,
	},
	eventDeleted: { feed: `${v('eliminaste', 'eliminó')} el evento “{title}”.` },
	expenseCreated: { feed: `${v('añadiste', 'añadió')} {description}.` },
	expenseUpdated: {
		feed: `${v('actualizaste', 'actualizó')} {description}{amountChange, select, yes { ({from} → {to})} other {}}.`,
	},
	expenseDeleted: { feed: `${v('eliminaste', 'eliminó')} {description}.` },
	expenseSplitSettled: { feed: `${v('saldaste', 'saldó')} una parte de {description}.` },
	expenseSplitReopened: { feed: `${v('reabriste', 'reabrió')} una parte de {description}.` },
	expenseDebtSettled: {
		feed: `${v('saldaste', 'saldó')} {count, plural, one {# parte pendiente} other {# partes pendientes}}.`,
	},
	expenseDebtSettledManual: {
		feed: `${v('registraste', 'registró')} un pago en efectivo de {amount}.`,
	},
	expenseDebtSettledManualVoided: {
		feed: `${v('anulaste', 'anuló')} un pago en efectivo de {amount}.`,
	},
	expenseReminderSent: {
		feed: `${v('enviaste', 'envió')} un recordatorio a {debtorName} por los importes pendientes con {creditorName}.`,
	},
	importCompleted: {
		feed: `${v('importaste', 'importó')} {inserted, plural, one {# gasto} other {# gastos}}.`,
	},
	importUndone: {
		feed: `${v('deshiciste', 'deshizo')} una importación ({removed, plural, one {# gasto} other {# gastos}}).`,
	},
	inventoryCreated: { feed: `${v('añadiste', 'añadió')} {name} a los suministros.` },
	inventoryUpdated: { feed: `${v('actualizaste', 'actualizó')} {name} en los suministros.` },
	inventoryDeleted: {
		feed: `${v('eliminaste', 'eliminó')} {hasName, select, yes {{name}} other {un artículo}} de los suministros.`,
	},
	inventoryConsumed: {
		feed: `${v('tomaste', 'tomó')} {quantity} {unitKey, select, piece {{count, plural, =1 {ud.} other {uds.}}} litre {L} kilogram {kg} roll {{count, plural, =1 {rollo} other {rollos}}} pack {{count, plural, =1 {paquete} other {paquetes}}} other {{unit}}} de {name}.`,
	},
	memberInvited: { feed: `${v('enviaste', 'envió')} una invitación por correo electrónico.` },
	memberJoined: {
		feed: `{self, select, yes {te uniste} other {se unió}} al piso con una invitación.`,
	},
	memberReactivated: { feed: `${v('reactivaste', 'reactivó')} a {name}.` },
	memberDeactivated: { feed: `${v('indicaste', 'indicó')} que {name} se ha mudado.` },
	memberRenamed: {
		feed: '{self, select, yes {{byOther, select, yes {cambiaste el nombre de {before} a {after}.} other {cambiaste tu nombre (antes {before}).}}} other {{byOther, select, yes {cambió el nombre de {before} a {after}.} other {cambió su nombre (antes {before}).}}}}',
	},
	memberAdminTransferred: {
		feed: `${v('traspasaste', 'traspasó')} el rol de admin a {name}.`,
	},
	memberAccountDeletionRequested: {
		feed: `${v('solicitaste', 'solicitó')} eliminar la cuenta y ${v('dejaste', 'dejó')} el piso.{hasNewAdmin, select, yes { {newAdminName} es ahora admin.} other {}}`,
	},
	notificationSettingsUpdated: {
		feed: `${v('cambiaste', 'cambió')} los ajustes de notificaciones.`,
	},
	notificationPushSubscribed: { feed: `${v('activaste', 'activó')} Web Push.` },
	notificationPushUnsubscribed: { feed: `${v('desactivaste', 'desactivó')} Web Push.` },
	recurringCreated: {
		feed: `${v('guardaste', 'guardó')} {description} como plantilla de gasto fijo.`,
	},
	recurringPaused: { feed: `${v('pausaste', 'pausó')} el gasto fijo {description}.` },
	recurringResumed: { feed: `${v('reanudaste', 'reanudó')} el gasto fijo {description}.` },
	recurringUpdated: {
		feed: `${v('actualizaste', 'actualizó')} la plantilla de gasto fijo {description}.`,
	},
	recurringDeleted: {
		feed: `${v('eliminaste', 'eliminó')} la plantilla de gasto fijo {description}.`,
	},
	recurringCharged: {
		feed: '{description} se añadió automáticamente desde los gastos fijos.',
	},
	recurringAutoPaused: {
		feed: 'La plantilla de gasto fijo {description} se pausó automáticamente.',
	},
	recurringAdvanced: {
		feed: '{description} se creó a partir de una plantilla de gasto fijo.',
	},
	shoppingCreated: { feed: `${v('añadiste', 'añadió')} {title} a la lista de la compra.` },
	shoppingUpdated: { feed: `${v('cambiaste', 'cambió')} {name}.` },
	shoppingBought: { feed: `${v('compraste', 'compró')} {name}.` },
	shoppingReopened: { feed: `${v('reabriste', 'reabrió')} {name}.` },
	shoppingDeleted: { feed: `${v('eliminaste', 'eliminó')} {name} de la lista de la compra.` },
	shoppingClearedBought: {
		feed: `${v('eliminaste', 'eliminó')} {count, plural, one {# artículo comprado} other {# artículos comprados}}.`,
	},
	wgCreated: { feed: `${v('creaste', 'creó')} el piso.` },
	wgUpdated: { feed: `${v('cambiaste', 'cambió')} los ajustes del piso.` },
	wgInviteCreated: { feed: `${v('creaste', 'creó')} una invitación.` },
	wgInviteRevoked: { feed: `${v('revocaste', 'revocó')} una invitación.` },
	timeline: {
		system: 'Sistema',
		shoppingBought: 'Comprado: {name}',
		shoppingAdded: 'Añadido: {name}',
		choreDone: 'Completado: {title}',
		recurringFromTemplate: 'Creado desde plantilla: {description}',
		recurringCreated: 'Guardado como plantilla de gasto fijo: {description}',
		recurringLabel: 'Gastos fijos',
		absenceAway: '{self, select, yes {estás} other {está}} ausente',
		absenceEntered: 'Ausencia añadida',
	},
	detail: {
		kind: 'Tipo: {kind}',
		withImage: 'con imagen',
		splitCount: '{count, plural, one {# reparto} other {# repartos}}',
		everyDays: '{days, plural, =1 {a diario} other {cada # días}}',
		everyMonths: '{months, plural, =1 {cada mes} other {cada # meses}}',
		away: 'ausente {range}',
		nextDue: 'próximo vencimiento {date}',
		shares: '{count, plural, one {# parte} other {# partes}}',
	},
} satisfies Catalog<typeof de>;
