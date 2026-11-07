import type { Catalog } from '../catalog';
import type de from '../de/meta';

export default {
	brand: {
		title: 'ManaWG, la app para tu piso compartido: gastos, compras y plan de limpieza',
		description:
			'Con ManaWG compartes gastos, organizas las compras y repartes las tareas con el plan de limpieza. La app es gratuita y funciona en el navegador.',
	},
	authReset: { title: 'Restablecer contraseña' },
	agentConsent: {
		title: 'Conectar un asistente de IA',
		description: 'Permite que un asistente de IA acceda a tus pisos en ManaWG.',
	},
	invite: {
		title: 'Te han invitado a un piso',
		description:
			'Únete a tu piso en ManaWG: gastos, plan de limpieza, compras y tablón. Gratis, en el navegador y alojado en Alemania.',
	},
	discover: {
		description:
			'{description} La app para pisos compartidos: gastos, plan de limpieza, compras y tablón.',
	},
	join: {
		title: 'Crear o unirse a un piso',
		description: 'Crea un piso o únete a uno con una invitación.',
	},
	signIn: { title: 'Iniciar sesión' },
	notFound: { title: 'Página no encontrada' },
	offline: { title: 'Sin conexión' },
	register: {
		title: 'Crear cuenta',
		description: 'Crea tu cuenta de ManaWG para montar un piso o unirte a uno.',
	},
	wg: { fallbackName: 'Piso', notFound: 'Piso no encontrado' },
	pages: {
		recurring: 'Gastos fijos',
		statement: 'Resumen mensual',
		activity: 'Actividad',
		expenses: 'Gastos',
		chat: 'Chat',
		shopping: 'Compras',
		settings: 'Ajustes',
		import: 'Importar gastos',
		calendar: 'Calendario',
		reminders: 'Recordatorios',
		pinboard: 'Tablón',
		chores: 'Plan de limpieza',
		supplies: 'Suministros',
	},
} satisfies Catalog<typeof de>;
