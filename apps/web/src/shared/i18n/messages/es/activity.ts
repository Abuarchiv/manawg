import type { Catalog } from '../catalog';
import type de from '../de/activity';

export default {
	reminder: {
		choreStuck: '{title} lleva atascada {days, plural, one {# día} other {# días}}',
		choreDetail: '{assignee} tiene la tarea asignada. Ponte al día, asúmela o hablad un momento.',
		nobody: 'Nadie',
		announcementOpen:
			'Publicación del tablón abierta desde hace {days, plural, one {# día} other {# días}}',
		shoppingOpen: '{name} lleva en la lista {days, plural, one {# día} other {# días}}',
		shoppingDetail: 'Comprueba si aún lo necesitas.',
	},
	loadError: { lead: 'No se pudo cargar la actividad' },
	error: {
		title: 'No se pudo cargar la actividad ahora mismo',
		body: 'Algo salió mal en el registro de actividad. Inténtalo de nuevo o vuelve al inicio del piso.',
	},
	feed: {
		emptyTitle: 'Aún no hay actividad',
		emptyDescription: 'Lo que pase en el piso aparecerá aquí: gastos, compras, plan de limpieza.',
		history: 'Historial de actividad',
		you: 'Tú',
	},
	page: {
		heading: 'Actividad',
		reload: 'Recargar actividad',
		searchPlaceholder: 'Buscar',
		searchLabel: 'Buscar en la actividad',
		scope: 'Área',
		kinds: {
			all: 'Todo',
			expense: 'Gastos',
			shopping: 'Compras',
			announcement: 'Tablón',
			chore: 'Plan de limpieza',
			recurring: 'Gastos fijos',
			absence: 'Ausencias',
			audit: 'Cambios del piso',
		},
		who: 'Quién',
		onlyMe: 'Solo yo',
		open: 'Pendiente',
		openLabel: 'Por resolver',
		visibleCount:
			'{count, plural, =0 {No hay entradas visibles.} one {# entrada visible.} other {# entradas visibles.}}',
		today: 'Hoy',
		yesterday: 'Ayer',
		noMatch: 'No hay actividad para este filtro',
		resetFilters: 'Restablecer filtros',
		filteredWithin: 'Filtrando entre las últimas {count} entradas.',
		loadOlder: 'Cargar entradas anteriores',
		loadingLabel: 'Cargando actividad',
		notLoaded: 'No se cargó la actividad. Inténtalo de nuevo.',
	},
} satisfies Catalog<typeof de>;
