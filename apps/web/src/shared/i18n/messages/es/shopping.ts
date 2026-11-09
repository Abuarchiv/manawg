import type { Catalog } from '../catalog';
import type de from '../de/shopping';

export default {
	errorPage: {
		title: 'No se ha podido cargar la compra ahora mismo',
		body: 'Algo ha salido mal en la lista de la compra. Inténtalo de nuevo o vuelve al inicio del piso.',
	},
	page: {
		title: 'Compras',
		openCount: '{count, plural, one {# pendiente} other {# pendientes}}',
		emptyTitle: 'La lista está vacía',
		emptyWithSuggestions: 'Añade un artículo abajo o toca una sugerencia.',
		empty: 'Añade un artículo abajo.',
		reload: 'Recargar lista',
		queued:
			'{count, plural, one {# acción está pendiente de sincronizar.} other {# acciones están pendientes de sincronizar.}}',
	},
	load: { list: 'No se ha podido cargar la lista de la compra' },
	suggestions: {
		lowStock: 'Se está acabando',
		frequent: 'Se compra a menudo',
		staples: 'Sugerencias',
		quick: { milk: 'Leche', bread: 'Pan', coffee: 'Café', toiletPaper: 'Papel higiénico' },
		addAria: 'Añadir {name}',
		added: '{name} añadido.',
	},
	list: {
		sectionLabel: 'Artículos de la compra',
		allBought: 'Todo comprado.',
		showMore: 'Mostrar más ({count, number})',
		done: 'Comprados ({count, number})',
		clearBought: 'Quitar comprados',
		clearBoughtAria: 'Quitar comprados ({count, number})',
	},
	row: {
		swipeBought: 'Comprado',
		swipeReopen: 'Reabrir',
		checkReopenAria: 'Reabrir {name}',
		checkCompleteAria: 'Marcar {name} como comprado',
		saving: 'Guardando…',
		waitingToSync: 'Pendiente de sincronizar…',
		bought: 'Comprado',
		boughtBy: '{who, select, self {Comprado por ti} other {Comprado por {name}}}',
		boughtUnknown: 'Comprado · persona sin indicar',
		addedByShort: '{who, select, self {Añadido por ti} other {Añadido por {name}}}',
		addedBy: '{who, select, self {Añadido por ti} other {Añadido por {name}}}',
		actionsAria: 'Acciones del artículo: {name}',
		edit: 'Editar',
		addAsExpense: 'Añadir como gasto',
		expenseHint: 'Podrás revisar el importe y el reparto antes de guardar.',
		removeConfirm: '“{name}” se eliminará de forma permanente. No se puede deshacer.',
		removeFinalAria: 'Eliminar definitivamente: {name}',
		removeAria: 'Quitar artículo: {name}',
		removeFinal: 'Eliminar definitivamente',
		remove: 'Quitar artículo',
		cannotRemove: 'Solo quien añadió el artículo o un administrador del piso puede quitarlo.',
		close: 'Cerrar',
	},
	addBar: {
		placeholder: 'p. ej. 2 aguacates',
		nameAria: 'Nombre del artículo',
		addAria: 'Añadir artículo',
	},
	editForm: {
		name: 'Nombre',
		quantity: 'Cantidad (opcional)',
		save: 'Guardar',
		saving: 'Guardando…',
		cancel: 'Cancelar',
	},
	receipt: {
		prompt: '¿Registrar {count, plural, one {# artículo} other {# artículos}} como gasto?',
		cta: 'Registrar gasto',
		dismiss: 'Ahora no',
		description: 'Compra: {names}',
	},
	skeleton: { loadingAria: 'Cargando la lista de la compra' },
	clearDialog: {
		title: '¿Quitar los artículos comprados?',
		description:
			'{count, plural, one {# artículo comprado se elimina} other {# artículos comprados se eliminan}} de forma permanente para todo el piso compartido. Los pendientes se mantienen.',
		cancel: 'Cancelar',
		confirm: 'Quitar',
	},
	errors: {
		sentence: '{subject}.',
		addSubject: 'No se ha podido guardar el artículo',
		nameInvalid: 'El nombre debe tener entre 1 y {max} caracteres.',
		quantityInvalid: 'La cantidad puede tener como máximo {max} caracteres.',
		statusInvalid: 'El estado no es válido.',
		requestInvalid: 'La solicitud no era válida.',
		insertFailed: 'Revisa la lista de la compra e inténtalo de nuevo.',
		addFallback: 'No se ha podido añadir el artículo. Inténtalo de nuevo en un momento.',
		idInvalid: 'Este artículo de la compra ya no se puede identificar.',
		subjectChecked: 'No se ha podido marcar “{name}” como comprado',
		subjectReopened: 'No se ha podido reabrir “{name}”',
		subjectRemoved: 'No se ha podido quitar “{name}”',
		subjectChanged: 'No se ha podido modificar “{name}”',
		actionFallback: '{subject}. Inténtalo de nuevo en un momento.',
		duplicate: '“{name}” ya está pendiente en la lista.',
		duplicateWithQuantity:
			'“{name}” ya está pendiente en la lista. Puedes cambiar la cantidad en “Acciones del artículo” → “Editar”.',
		clearNotAdmin:
			'Solo los administradores pueden quitar los artículos comprados para todo el piso compartido.',
		clearSubject: 'No se han podido quitar los artículos comprados',
	},
	toggle: {
		itemGone: 'Este artículo de la compra ya no existe y se ha quitado de tu lista.',
		queueBlocked:
			'El almacenamiento sin conexión está bloqueado. No se ha podido poner en cola el estado de la compra.',
		queuedCreateBought: 'En cola sin conexión. El artículo nuevo se sincronizará como comprado.',
		queuedCreateOpen: 'En cola sin conexión. El artículo nuevo se sincronizará como pendiente.',
		queuedBought: 'En cola sin conexión. El artículo se sincronizará como comprado más tarde.',
		queuedReopen: 'En cola sin conexión. El artículo se reabrirá más tarde.',
		statusChanged: 'El estado de la compra ha cambiado. Revisa la lista actualizada.',
		pendingChange:
			'“{name}” tiene un cambio que aún no se ha enviado. Lo encontrarás en Ajustes → Datos → Cola sin conexión.',
		versionMissing: 'El artículo se está actualizando. Revisa la lista e inténtalo de nuevo.',
		keyUnavailable:
			'No se ha podido guardar el estado de la compra de forma fiable. Inténtalo de nuevo.',
	},
	removal: {
		storageBlocked:
			'El almacenamiento sin conexión está bloqueado. No se ha podido quitar el artículo en cola.',
		queuedRemoved: 'Se ha quitado el artículo que estaba en cola sin conexión.',
		notAllowed: 'Solo quien añadió el artículo o un administrador del piso puede quitarlo.',
		cleared: 'Artículos comprados quitados.',
	},
	edit: {
		nameEmpty: 'El nombre no puede estar vacío.',
		waitingForSync: 'Este artículo aún está pendiente de sincronizar. Podrás editarlo después.',
		versionMissing: 'El artículo se está actualizando. Inténtalo de nuevo en un momento.',
		changed: 'El artículo ha cambiado. Revisa la versión actualizada e inténtalo de nuevo.',
		needsConnection: 'Necesitas conexión para editar.',
	},
	add: {
		keyUnavailable: 'No se ha podido guardar el artículo de forma fiable. Inténtalo de nuevo.',
		retryHint:
			'No se ha podido añadir el artículo. Comprueba si ya está en la lista e inténtalo de nuevo.',
		queueBlocked:
			'El almacenamiento sin conexión está bloqueado. Mantén el borrador abierto e inténtalo más tarde.',
		draftCleanupFailedOffline:
			'Guardado sin conexión, pero no se ha podido quitar el borrador anterior. Revisa la cola sin conexión.',
		draftCleanupFailed: 'Guardado, pero no se ha podido quitar el borrador sin conexión anterior.',
		queueEditAlreadySent: 'La entrada ya se ha enviado. Revisa la lista.',
		savedOffline: 'Guardado sin conexión. Se sincronizará cuando vuelvas a tener conexión.',
		deliveryFailed: 'Guardado. No se han podido enviar todas las notificaciones push.',
		deliveryUnknown: 'Guardado. No se ha podido confirmar el envío de las notificaciones push.',
	},
} satisfies Catalog<typeof de>;
