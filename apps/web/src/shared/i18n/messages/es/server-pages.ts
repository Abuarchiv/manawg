import type { Catalog } from '../catalog';
import type de from '../de/server-pages';

export default {
	unsubscribe: {
		statement: {
			title: 'Darse de baja del resumen mensual',
			question: '¿Darte de baja del resumen mensual?',
			explain:
				'Dejarás de recibir el resumen por correo a principios de cada mes. Seguirá disponible en la app.',
			done: 'Ya no recibirás el resumen mensual por correo. Puedes volver a activarlo en Ajustes, dentro de la app.',
		},
		reminders: {
			title: 'Darse de baja de los recordatorios',
			question: '¿Darte de baja de los recordatorios de importes pendientes?',
			explain:
				'Tus compañeros de piso ya no podrán recordarte importes pendientes por correo ni por push. Tus saldos seguirán visibles en la app.',
			done: 'Ya no recibirás recordatorios. Puedes volver a activarlos en Ajustes, dentro de la app.',
		},
		submit: 'Darme de baja',
		hint: 'Puedes volver a activarlo en Ajustes cuando quieras.',
		doneTitle: 'Baja confirmada',
		doneHeading: 'Baja confirmada.',
		invalidTitle: 'Enlace no válido',
		invalidBody: 'Este enlace no es válido o ha caducado. Cambia el ajuste en la app, en Ajustes.',
	},
} satisfies Catalog<typeof de>;
