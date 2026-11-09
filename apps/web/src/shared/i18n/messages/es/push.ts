import type { Catalog } from '../catalog';
import type de from '../de/push';

export default {
	fallback: {
		wgName: 'tu piso',
		someone: 'Alguien',
		expense: 'un gasto',
		fixedCostTemplate: 'Una plantilla de gasto fijo',
		creditor: 'alguien',
		task: 'Una tarea',
		shoppingItem: 'algo',
		event: 'Evento',
		supply: 'Suministro',
		post: 'Publicación',
		newMessage: 'Mensaje nuevo',
		newReply: 'Respuesta nueva',
		newMention: 'Mención nueva',
		soon: 'pronto',
	},
	eventTime: {
		allDay: '{date} (todo el día)',
	},
	test: {
		title: 'Prueba de ManaWG',
		body: 'Las notificaciones funcionan para {wgName}.',
	},
	expenseCreated: {
		title: 'Gasto nuevo',
		body: '{actorName} añadió {title} por {amount} en {wgName}.',
	},
	expenseUpdated: {
		title: 'Gasto modificado',
		share: '{actorName} cambió {title}: tu parte {from} → {to}',
		same: '{actorName} cambió {title}. Tu parte sigue en {amount}.',
	},
	expenseDeleted: {
		title: 'Gasto eliminado',
		body: '{actorName} eliminó {title}. Tu saldo cambia en {amount}.',
	},
	recurringCharged: {
		title: 'Nuevo cargo de gasto fijo',
		body: 'Nuevo cargo de gasto fijo: {description} {amount}',
	},
	expenseReminder: {
		title: 'Recordatorio',
		body: '{amount} para {creditor}, aún pendiente.',
		bodyAged:
			'{amount} para {creditor}, aún pendiente (el gasto más antiguo tiene {days, plural, one {{days, number, ::group-off} día} other {{days, number, ::group-off} días}}).',
	},
	debtSettled: {
		title: 'Saldo registrado',
		received: '{actorName} confirmó que ha recibido {amount} de ti.',
		paid: '{actorName} te ha pagado {amount}. Si no es correcto, abre Gastos y disputa el pago allí.',
	},
	paymentVoided: {
		title: 'Pago en efectivo anulado',
		body: '{actorName} anuló el pago en efectivo de {amount}. El importe vuelve a estar pendiente.',
	},
	importCompleted: {
		title: 'Importación terminada',
		body: '{actorName} importó {inserted, plural, one {{inserted, number, ::group-off} gasto} other {{inserted, number, ::group-off} gastos}} en {wgName}.',
	},
	announcementPosted: {
		title: 'Publicación nueva en el tablón',
		body: '{actorName} en {wgName}: {title}',
	},
	announcementCommented: {
		title: 'Respuesta nueva',
		body: '{actorName} respondió en el tablón: {title}',
	},
	announcementResolved: {
		title: 'Publicación del tablón resuelta',
		body: '{actorName} marcó una publicación como resuelta: {title}',
	},
	memberJoined: {
		title: 'Novedad en tu piso',
		body: '{actorName} se ha unido a {wgName}.',
	},
	choreDue: {
		title: 'Plan de limpieza',
		today: '{title} toca hoy en {wgName}.',
		tomorrow: '{title} toca mañana en {wgName}.',
		onDate: '{title} toca el {date} en {wgName}.',
		overdue:
			'{title} lleva pendiente en {wgName} {days, plural, one {{days, number, ::group-off} día} other {{days, number, ::group-off} días}}.',
		unassigned: 'No hay nadie asignado.',
	},
	shoppingAdded: {
		title: 'Lista de la compra',
		body: '{actorName} añadió {title} a la lista de la compra de {wgName}.',
	},
	eventCreated: {
		title: 'Evento nuevo',
		body: '{actorName} añadió “{title}” en {wgName} para el {when}.',
	},
	eventMoved: {
		title: 'Evento movido',
		series: '{actorName} movió el evento recurrente “{title}” en {wgName}.',
		single: '{actorName} movió “{title}” en {wgName} al {when}.',
	},
	eventCancelled: {
		title: 'Evento cancelado',
		series: '{actorName} canceló el evento recurrente “{title}” en {wgName}.',
		single: '{actorName} canceló “{title}” del {when} en {wgName}.',
	},
	eventUpcoming: {
		title: 'Evento mañana',
		allDay: 'Mañana en {wgName}: “{title}” el {when}.',
		timed: 'Mañana en {wgName}: “{title}”, {when}.',
	},
	eventToday: {
		title: 'Evento hoy',
		allDay: 'Hoy en {wgName}: “{title}” dura todo el día.',
		ongoing: 'Hoy en {wgName}: “{title}” sigue en curso.',
		timed: 'Hoy en {wgName}: “{title}”, {when}.',
	},
	lowStock: {
		title: 'Suministro a punto de acabarse',
		body: 'Queda poco en {wgName}: {itemName}.',
		bodyDetail: 'Queda poco en {wgName}: {itemName} ({quantity} de {threshold}).',
	},
	chatMessage: {
		title: 'Chat – {wgName}',
		body: '{sender}: {preview}',
	},
	chatMention: {
		title: '{sender} te ha mencionado',
		body: '{sender} te ha mencionado: {preview}',
	},
} satisfies Catalog<typeof de>;
