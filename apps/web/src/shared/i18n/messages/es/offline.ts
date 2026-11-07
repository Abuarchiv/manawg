import type { Catalog } from '../catalog';
import type de from '../de/offline';
import failure from './offline-failure';

export default {
	failure,
	state: {
		reviewRequired:
			'Requiere revisión. Puede que la primera versión ya esté guardada. La edición no se envió. Compara la entrada del piso y solo entonces descarta esta acción; vuelve a poner en cola los cambios que aún necesites.',
		replayExpired:
			'Requiere revisión. Ya pasó el plazo seguro para reintentar. Puede que esta acción ya esté guardada y no se enviará de nuevo. Compara la entrada del piso y solo entonces descarta esta acción; pon en cola únicamente los cambios que falten.',
		invalidActionTime:
			'Requiere revisión. La hora de esta acción no está clara. Puede que ya esté guardada y no se enviará de nuevo. Compara la entrada del piso y solo entonces descarta esta acción; pon en cola únicamente los cambios que falten.',
		serverCheck: 'Requiere revisión. {title}: {detail}',
		imageMissing:
			'Falta la imagen. El archivo adjunto local ya no está disponible. Quita el adjunto en la cola sin conexión o elige la imagen otra vez.',
		imageRemoved:
			'Imagen eliminada. Quita el adjunto en la cola sin conexión o elige la imagen otra vez.',
		recurringAdvance:
			'La plantilla de gasto fijo no avanzó. El gasto se creó. La plantilla sigue en la cola para ponerse al día.',
		reauth:
			'Debes iniciar sesión de nuevo. Abre el piso otra vez o únete con un enlace de invitación actual.',
		idempotency:
			'No se pudo preparar la acción para un envío fiable. Sigue guardada y no se envía; inténtalo de nuevo más tarde.',
	},
	copy: {
		queueCount:
			'{count, plural, =0 {No hay acciones sin conexión en espera.} one {# acción en espera.} other {# acciones en espera.}}',
		synced: '{count, plural, one {# acción sincronizada.} other {# acciones sincronizadas.}}',
		remaining:
			'{count, plural, one {# acción sigue en espera.} other {# acciones siguen en espera.}}',
		syncedAndRemaining: '{synced} {remaining}',
		syncedOffline:
			'{count, plural, one {# acción sin conexión sincronizada.} other {# acciones sin conexión sincronizadas.}}',
		queued:
			'{count, plural, one {# acción sin conexión espera para sincronizarse.} other {# acciones sin conexión esperan para sincronizarse.}}',
		reviewNeeded:
			'{count, plural, one {# acción necesita tu revisión.} other {# acciones necesitan tu revisión.}}',
		replayUnsupported:
			'Este navegador no puede enviar la cola desde aquí. Abre la app por https en un navegador actual para que se puedan transferir las acciones.',
		nothingLeft: 'Ya no hay acciones en espera.',
		nothingSynced:
			'Todavía no se ha sincronizado nada. Las acciones siguen guardadas de forma segura.',
		syncNotStarted:
			'No se pudo iniciar la sincronización. Comprueba tu conexión; las acciones siguen guardadas.',
	},
	summary: {
		verbatim: '{text}',
		shopping: { title: 'Compras', fallback: 'Artículo nuevo', itemFallback: 'Artículo' },
		shoppingUpdate: '{bought, select, yes {Marcar {name} como comprado} other {Reabrir {name}}}',
		announcement: { title: 'Publicación del tablón', fallback: 'Publicación nueva' },
		absence: { title: 'Ausente', detail: 'El plan de limpieza se salta a esta persona' },
		chore: { title: 'Tarea del plan de limpieza', fallback: 'Tarea nueva' },
		choreComplete: { title: 'Plan de limpieza', detail: 'Marcar tarea como hecha' },
		expense: { title: 'Gasto', fallback: 'Gasto nuevo' },
		expenseUpdate: { title: 'Actualizar gasto', fallback: 'Gasto' },
		recurring: { title: 'Plantilla de gasto fijo', fallback: 'Plantilla nueva' },
		recurringAdvance: {
			title: 'Plantilla de gasto fijo',
			detail: 'Recuperar el vencimiento omitido',
		},
	},
	risk: {
		stale: {
			title: 'Revisa antes de enviar',
			detail: 'Revisa la entrada antes de volver a enviarla.',
		},
		shoppingUpdate: {
			title: 'Revisa el estado',
			detail: 'Comprueba si otra persona ha cambiado el artículo de la compra mientras tanto.',
		},
		announcement: {
			title: 'Revisa el tablón',
			detail: 'Comprueba si el contenido, la categoría o el estado han quedado desactualizados.',
		},
		absence: {
			title: 'Revisa la ausencia',
			detail: 'Comprueba si el período o el plan de limpieza han cambiado.',
		},
		chore: {
			title: 'Revisa el plan de limpieza',
			detail: 'Comprueba si la tarea, el intervalo o la asignación han cambiado.',
		},
		choreComplete: {
			title: 'Posible conflicto',
			detail: 'Comprueba si la tarea ya se completó o se reasignó.',
		},
		expense: {
			title: 'Revisa el reparto',
			detail: 'Si han cambiado los miembros o los importes, edita el gasto antes de enviarlo.',
		},
		expenseUpdate: {
			title: 'Revisa la versión',
			detail: 'El gasto solo se actualiza si no ha cambiado desde que lo editaste.',
		},
		recurring: {
			title: 'Revisa los gastos fijos',
			detail: 'Comprueba la fecha de vencimiento y el reparto antes de enviar la plantilla.',
		},
		recurringAdvance: {
			title: 'Revisa los gastos fijos',
			detail: 'Comprueba si la plantilla ya avanzó.',
		},
		timeUnclear: {
			title: 'Revisa la hora',
			detail: 'La hora guardada no está clara. Revisa la entrada antes de volver a enviar.',
		},
		timeFuture: {
			title: 'Revisa la hora',
			detail: 'La hora guardada está en el futuro. Revisa la entrada antes de enviar.',
		},
	},
	conflict: {
		unknownDate: 'Fecha desconocida',
		templateExists:
			'Ya existe la misma plantilla de gasto fijo. Su próximo vencimiento es el {date}. Antes de enviar, comprueba si sería un duplicado.',
		advanceSame:
			'La plantilla del servidor sigue en el vencimiento esperado, {expected}. Puedes enviar la acción sin conexión.',
		advanceMoved:
			'La plantilla del servidor está ahora en {server} en lugar de {expected}. Antes de enviar, comprueba si el vencimiento ya se registró.',
	},
	serverCheck: {
		notFound: 'No se encontró en el servidor.',
		shoppingDuplicate:
			'Ya existe un artículo de compra parecido. Allí está {done, select, yes {hecho} other {pendiente}}. Antes de enviar, comprueba si sería un duplicado.',
		shoppingFound:
			'Se encontró la versión del servidor. Allí está {done, select, yes {hecho} other {pendiente}}. Antes de volver a enviar, comprueba si sigue siendo correcto.',
		shoppingGone: 'El artículo de la compra ya no existe en el servidor.',
		announcementDuplicate:
			'Ya existe la misma publicación del tablón. Allí está {resolved, select, yes {resuelta} other {pendiente}}. Antes de enviar, comprueba si sería un duplicado.',
		choreFound:
			'Se encontró la versión del servidor. Antes de enviar, comprueba quién es responsable y la fecha de vencimiento.',
		choreGone: 'La tarea ya no existe en el servidor.',
		choreDuplicate:
			'Ya existe la misma tarea de limpieza. Su intervalo allí es de cada {days, plural, one {día} other {# días}}. Antes de enviar, comprueba si sería un duplicado.',
		absenceDuplicate: 'Ya existe la misma ausencia en el servidor.',
		expenseDuplicate:
			'Ya existe el mismo gasto con el mismo importe. Antes de enviar, comprueba si sería un duplicado.',
		templateGone: 'Esta plantilla de gasto fijo ya no existe en el servidor.',
	},
	page: {
		heading: 'Cola',
		unauthenticated: 'Cuando inicies sesión, verás tus acciones en espera.',
		queued:
			'{count, plural, =0 {No hay acciones en espera.} one {# acción en espera.} other {# acciones en espera.}}',
		wgQueued:
			'{count, plural, =0 {No hay acciones en espera} one {# acción en espera} other {# acciones en espera}}',
		queueLabel: 'Acciones sin conexión en espera',
		hidden:
			'+{count, plural, one {# acción más} other {# acciones más}} en la cola. {link} abre la lista completa.',
		hiddenLink: 'Revisar todas las acciones',
		age: {
			unclear: 'Hora poco clara',
			future: 'Hora en el futuro',
			justNow: 'ahora mismo',
			minutes: 'hace {count} min',
			hours: 'hace {count} h',
			days: 'hace {count, plural, one {# día} other {# días}}',
		},
		label: {
			checking: 'Comprobando…',
			browserOffline: 'Modo sin conexión',
			serverUnreachable: 'Servidor no disponible',
			unauthenticated: 'Inicio de sesión necesario',
			ready: 'De nuevo en línea',
		},
		title: {
			checking: 'Comprobando tu conexión…',
			offline: 'Ahora mismo no tienes conexión.',
			serverUnreachable: 'Ahora mismo no se puede acceder al servidor.',
			unauthenticated: 'Inicia sesión para ver tus acciones sin conexión.',
			online: 'Ya estás conectado de nuevo.',
		},
		description: {
			checking: 'Un momento, estamos comprobando tu conexión y tu cuenta.',
			browserOffline:
				'Tus acciones guardadas en el dispositivo siguen visibles. Cuando vuelvas a tener conexión, podrás sincronizarlas.',
			serverUnreachable:
				'El servidor no responde ahora mismo. Tus acciones guardadas en el dispositivo se conservan; inténtalo de nuevo más tarde.',
			unauthenticated: 'Las acciones sin conexión y los pisos recordados pertenecen a tu cuenta.',
			readyWithFlat: 'Tu conexión ha vuelto. Sincroniza las acciones en espera o vuelve a tu piso.',
			readyWithoutFlat: 'Tu conexión ha vuelto. Ya puedes sincronizar las acciones en espera.',
		},
		recheckLabel: 'Comprobar de nuevo el estado sin conexión',
		recheck: 'Comprobar',
		backTo: 'Volver a {name}',
		signIn: 'Iniciar sesión',
		syncingLabel: 'Sincronizando acciones sin conexión',
		syncNowLabel: 'Sincronizar ahora las acciones sin conexión',
		syncNow: 'Sincronizar ahora',
		syncTitle: 'Sincronizar',
		otherAccount: 'Aquí no se muestran las acciones de otra cuenta en este dispositivo.',
		signInFirst: 'Inicia sesión antes de sincronizar las acciones sin conexión.',
		noMatchingFlat: 'El piso de estas acciones no está en tu cuenta. Siguen guardadas.',
		stays: 'Guardado en este dispositivo: {modules}.',
		reloadOnline: 'Vuelve a cargar la página cuando tengas conexión.',
		flats: {
			titleNone: 'Tus pisos',
			titleSome: 'Volver a tu piso',
			openLater:
				'{count, plural, one {Tu piso se abrirá cuando vuelvas a tener conexión.} other {Tus pisos se abrirán cuando vuelvas a tener conexión.}}',
			looking: 'Buscando pisos recordados…',
			codeMissing:
				'Has iniciado sesión en este dispositivo, pero tu piso no está guardado aquí. Abre la página de inicio de sesión y elígelo entre tus pisos.',
			codeMissingOffline:
				'Has iniciado sesión en un piso en este dispositivo, pero no está guardado aquí. Cuando vuelvas a tener conexión, recarga la página y podrás abrir tu piso de nuevo.',
			noneRemembered:
				'Todavía no hay ningún piso recordado en este dispositivo. Abre la página de inicio de sesión para unirte con un enlace de invitación.',
			noneRememberedOffline:
				'Todavía no hay ningún piso recordado en este dispositivo. Cuando vuelvas a tener conexión, podrás unirte de nuevo con un enlace de invitación.',
			listLabel: 'Pisos conocidos',
			open: 'Abrir {name}',
			checkActions: 'Revisar acciones',
			signIn: 'Ir al inicio de sesión',
		},
	},
	queue: {
		title: 'Cola sin conexión',
		retry: 'Reintentar',
		syncingLabel: 'Sincronizando la cola sin conexión',
		retryLabel: 'Volver a sincronizar la cola sin conexión',
		storageBlockedDiscard:
			'El almacenamiento sin conexión está bloqueado. No se pudo descartar la acción.',
		storageBlockedAttachment:
			'El almacenamiento sin conexión está bloqueado. No se pudo quitar el adjunto.',
		storageBlockedDraft:
			'El almacenamiento sin conexión está bloqueado. No se pudo abrir el borrador para editarlo.',
		attachmentRemoved: 'Adjunto quitado. La acción sin conexión ya puede sincronizarse.',
		draftExists:
			'Ya existe otro borrador sin guardar de un formulario para esta sección. Abre el formulario, guárdalo o descártalo y luego edita la entrada en la cola.',
		compareFailed:
			'No se pudo cargar la comparación con el servidor. Inténtalo de nuevo antes de enviar esta acción.',
		compareReady:
			'Comparación con el servidor lista. Edita el borrador si el contenido o el reparto han cambiado.',
		discardTitle: '¿Descartar la acción sin conexión?',
		discardBody: '“{summary}” todavía no se ha enviado y no se puede recuperar una vez descartada.',
		keep: 'Conservar',
		discard: 'Descartar',
		attempts: '{count}×',
		inspect: 'Revisar entrada del piso',
		inspectLabel: 'Revisar entrada del piso: {action}',
		compare: 'Comparar con el servidor',
		comparing: 'Comparando…',
		compareLabel: 'Comparar con el servidor: {action}',
		edit: 'Editar',
		editLabel: 'Editar acción sin conexión: {action}',
		removeAttachment: 'Quitar adjunto',
		removeAttachmentLabel: 'Quitar adjunto: {action}',
		discardLabel: 'Descartar acción sin conexión: {action}',
	},
} satisfies Catalog<typeof de>;
