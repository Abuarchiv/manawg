import type { Catalog } from '../catalog';
import type de from '../de/mail';

export default {
	shell: {
		linkFallback: 'Si el botón no funciona: {url}',
		legalNotice: 'Aviso legal',
		privacy: 'Política de privacidad',
		changeSettings: 'Cambiar ajustes',
		unsubscribe: 'Darse de baja',
	},
	welcome: {
		subject: 'Te damos la bienvenida a ManaWG',
		preheader: 'Tres pasos y tu piso estará en marcha.',
		title: 'Personas distintas, un día a día compartido.',
		intro:
			'{named, select, yes {Hola {firstName}, tu cuenta está lista.} other {Tu cuenta está lista.}} ManaWG reúne en un solo sitio los gastos, el plan de limpieza, las compras y los eventos de todo el piso.',
		stepCreate: 'Crea un piso o únete con una invitación',
		stepInvite: 'Invita a tus compañeros de piso',
		stepFirstExpense: 'Añade el primer gasto',
		button: 'Configurar tu piso',
		footer: 'Recibes este correo porque has creado una cuenta de ManaWG.',
	},
	invitation: {
		subject: '{inviter} te ha invitado a unirte a {wgName}',
		title: '{inviter} te ha invitado a unirte a {wgName}.',
		eyebrow: 'Invitación',
		preheader:
			'{count, plural, one {Ya hay una persona en el piso.} other {Ya hay # personas en el piso.}}',
		captionOne: '{name} ya es miembro.',
		captionMany: '{names} ya son miembros.',
		captionMore: '{names} y {count} más ya son miembros.',
		button: 'Aceptar invitación',
		footer:
			'El enlace es válido durante {days, plural, one {# día} other {# días}}. {inviter} ha introducido tu dirección. No la guardamos más allá de este correo.',
	},
	reminder: {
		subject: '{amount} para {creditor}, aún pendiente',
		title: 'Aún pendiente con {creditor}.',
		amountLabel: 'Aún pendiente con {creditor}',
		eyebrow: 'Recordatorio',
		age: '{days, plural, =0 {El gasto más antiguo es de hoy.} one {El gasto más antiguo tiene # día.} other {El gasto más antiguo tiene # días.}}',
		netted:
			'Los gastos más recientes. Los pagos y gastos en sentido contrario ya están descontados del importe de arriba.',
		oneClick:
			'En cuanto hayas pagado, registra el pago en la app. {creditor} lo ve allí al instante.',
		button: 'Abrir gastos',
		footer:
			'La misma persona puede enviarte un recordatorio como máximo una vez cada dos días, y solo si los has activado.',
	},
	accountDeleted: {
		subject: 'Tu cuenta ha sido eliminada',
		preheader: 'Se ha eliminado tu acceso.',
		title: 'Tu cuenta ha sido eliminada.',
		removed:
			'Se han eliminado tu acceso y tus suscripciones push y de calendario. Tu nombre se mantiene en los registros anteriores de tu piso para que las cuentas de los demás sigan cuadrando.',
		thanks: 'Gracias por el tiempo compartido. Puedes crear una cuenta nueva cuando quieras.',
		footer: 'Este es el último correo que recibirás de nosotros.',
	},
	statement: {
		subject: 'El resumen de {month} está listo',
		title: 'El resumen de {month} está listo.',
		preheader:
			'{people, plural, one {# persona} other {# personas}}, {expenses, plural, one {# gasto} other {# gastos}}, {status, select, settled {todo saldado} owed {te deben {amount}} multiple {importes pendientes en varias monedas} other {debes {amount}}}.',
		segmentSettled: 'Todo saldado',
		segmentOwed: 'Te deben',
		segmentOwes: 'Debes',
		openAsOf: 'Pendiente a fecha de {date}',
		total: 'Total',
		expenses: 'Gastos',
		share: 'Tu parte',
		transferFrom: 'de {name}',
		transferTo: 'a {name}',
		viewStatement: 'Ver resumen',
		attached: 'El resumen va adjunto en PDF.',
		cadence: 'Una vez al mes, el día 1.',
	},
} satisfies Catalog<typeof de>;
