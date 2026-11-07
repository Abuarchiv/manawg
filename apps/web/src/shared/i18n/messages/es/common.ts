import type { Catalog } from '../catalog';
import type de from '../de/common';

export default {
	skipToContent: 'Saltar al contenido principal',
	loading: 'Cargando…',
	unknownPerson: 'Desconocido',
	errors: {
		withSubject: '{subject}: {detail}',
		network: 'Comprueba tu conexión e inténtalo de nuevo.',
		retry: 'Inténtalo de nuevo en un momento.',
		rateLimited: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
		readOnly: 'La app está en mantenimiento y solo permite lectura. Inténtalo más tarde.',
		maintenance: 'La app está en mantenimiento ahora mismo. Inténtalo más tarde.',
		sessionExpired: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
		signInAgain: 'Vuelve a iniciar sesión.',
		wgUnavailable: 'Vuelve a abrir el piso con el enlace actual.',
		invalidShareCode: 'El código del piso no es válido.',
		authInvalidated: 'Vuelve a unirte al piso.',
		queryTooLong: 'El término de búsqueda es demasiado largo.',
	},
	notificationWarning: {
		failed: 'Guardado. No se pudieron enviar todas las notificaciones push.',
		unknown: 'Guardado. No se pudo confirmar el envío de las notificaciones push.',
	},
	loadError: {
		withoutDetail: '{lead}.',
		lead: {
			expenses: 'No se pudieron cargar los gastos',
		},
	},
	time: {
		unknown: 'Hora desconocida',
		justNow: 'ahora mismo',
		minutesAgo: 'hace {count} min',
		hoursAgo: 'hace {count} h',
		yesterday: 'ayer',
		daysAgo: 'hace {count, plural, one {# día} other {# días}}',
		minutesAhead: 'en {count} min',
		hoursAhead: 'en {count} h',
		tomorrow: 'mañana',
		daysAhead: 'en {count, plural, one {# día} other {# días}}',
		date: '{date}',
		thisWeek: 'Esta semana',
		lastWeek: 'La semana pasada',
		weekOf: 'Semana del {date}',
	},
} satisfies Catalog<typeof de>;
