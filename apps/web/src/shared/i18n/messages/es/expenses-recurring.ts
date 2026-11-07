import type { Catalog } from '../catalog';
import type de from '../de/expenses-recurring';

export default {
	page: {
		title: 'Gastos fijos',
		counter: '{active, number} activos · {total, number} en total',
		perMonth: 'Al mes',
		yourShare: 'Tu parte',
		add: 'Añadir gasto fijo',
		skeletonLabel: 'Cargando gastos fijos',
		loadError: {
			lead: 'No se han podido cargar los gastos fijos',
			retry: 'Recargar gastos fijos',
		},
		boundary: {
			title: 'No se han podido cargar los gastos fijos ahora mismo',
			body: 'Algo ha salido mal en la página de gastos fijos. Inténtalo de nuevo o vuelve al resumen del piso.',
		},
	},
	deleteDialog: {
		title: '¿Eliminar el gasto fijo?',
		description: 'Se eliminará “{description}”. Los gastos ya registrados se mantienen.',
		cancel: 'Cancelar',
		confirm: 'Eliminar',
	},
	notice: {
		created: 'Gasto fijo añadido.',
		updated: 'Gasto fijo actualizado.',
		resumed: 'Gasto fijo reanudado.',
		paused: 'Gasto fijo pausado.',
		deleted: 'Gasto fijo eliminado.',
		keyUnavailable:
			'No se ha podido guardar la plantilla de gasto fijo de forma fiable. Inténtalo de nuevo.',
	},
	list: {
		filterLabel: 'Filtrar gastos fijos',
		visibleCount: '{count, plural, one {# gasto fijo mostrado} other {# gastos fijos mostrados}}',
		filter: { active: 'Activos', paused: 'Pausados', all: 'Todos' },
		emptyTitle: 'Aún no hay gastos fijos',
		emptyActiveTitle: 'No hay gastos fijos activos',
		emptyPausedTitle: 'No hay gastos fijos pausados',
		emptyHint:
			'Añade el alquiler, la luz o Netflix y ManaWG los registrará como gastos automáticamente.',
		nonePaused: 'No hay gastos fijos pausados.',
		allPaused: 'Todos los gastos fijos están pausados. Los encontrarás en “Pausados”.',
	},
	row: {
		openDetails: 'Abrir detalles:',
		unknownPayer: 'desconocido',
		status: {
			pausedMovedOut: 'pausado, alguien se ha mudado',
			paused: 'pausado',
			notBooked: 'no se está registrando',
			overdue: 'vencido desde el {date}',
			next: 'próximo el {date}',
		},
		paidBy: 'pagado por',
		you: 'tú',
		youSpoken: 'ti',
		youShare: 'Tú',
		ownShare: '{name} · parte propia',
		movedOutPaused:
			'Pausado porque se ha mudado un miembro que comparte estos gastos. Ajusta las partes y reanúdalo.',
		movedOutBlocked:
			'No se está registrando porque se ha mudado un miembro que comparte estos gastos. Ajusta las partes o pausa el gasto.',
		nextBookings:
			'{count, plural, one {Próximo registro: {dates}} other {Próximos # registros: {dates}}}',
		resume: 'Reanudar',
		pause: 'Pausar',
		resumeLabel: 'Reanudar: {description}',
		pauseLabel: 'Pausar: {description}',
		editLabel: 'Editar {description}',
		deleteLabel: 'Eliminar {description}',
		notAllowed:
			'Solo quien creó este gasto fijo o un administrador del piso puede modificarlo, pausarlo o eliminarlo.',
	},
	modal: {
		createTitle: 'Nuevo gasto fijo',
		editTitle: 'Editar gasto fijo',
		closeLabel: 'Cerrar el editor de gastos fijos',
		discardTitle: '¿Descartar los cambios?',
		discardBody:
			'Los cambios sin guardar de este gasto fijo se perderán al cerrar. No se guarda nada.',
		keepEditing: 'Seguir editando',
		discard: 'Descartar',
	},
	form: {
		description: 'Descripción',
		descriptionPlaceholder: 'p. ej. Netflix',
		amount: 'Importe',
		amountPlaceholder: '0,00',
		paidBy: 'Pagado por',
		interval: 'Periodicidad',
		firstDue: 'Primer vencimiento',
		nextDue: 'Próximo vencimiento',
		missedBookings:
			'Esta fecha ya ha pasado. En la próxima ejecución diaria se {count, plural, one {añadirá # registro} other {añadirán # registros}} con efecto retroactivo y se avisará al piso.',
		create: 'Añadir gasto fijo',
		save: 'Guardar',
		cancel: 'Cancelar',
		intervalOption: {
			m1: '1 mes',
			m2: '2 meses',
			m3: '3 meses',
			m6: '6 meses',
			m12: '12 meses',
			custom: '{count, number} meses',
		},
		error: {
			description: 'Escribe una descripción breve.',
			dueMissing: 'Falta la fecha de vencimiento.',
			dueOutOfRange: 'Elige una fecha como mucho un año atrás y como mucho diez años adelante.',
			amountPositive: 'Introduce un importe superior a 0 €, por ejemplo 12,50.',
			amountDecimals: 'Como máximo dos decimales.',
			amountMax: 'El importe no puede superar 1.000.000 €.',
			noMembers: 'No hay miembros.',
			invalidShare:
				'Al menos una parte no es válida. Introduce un importe válido o deja el campo vacío.',
			splitsEmpty: 'El reparto está vacío. Introduce al menos un importe.',
		},
	},
	split: {
		legend: 'Personas implicadas y reparto',
		modeLabel: 'Reparto de este gasto fijo',
		equal: 'A partes iguales',
		manual: 'Manual',
		shareLabel: 'Parte de {name} en euros',
		sharePlaceholder: '0,00',
		sumHintNoTotal: 'Las partes deben sumar el importe total.',
		sumHint:
			'Asignado {sum} de {total} · {state, select, match {coincide} short {{amount} sin asignar} other {{amount} de más}}',
		equalHint: 'Introduce un importe y se repartirá a partes iguales.',
	},
	interval: {
		monthly: 'mensual',
		quarterly: 'trimestral',
		halfYearly: 'cada seis meses',
		yearly: 'anual',
		everyMonths: 'cada {count} meses',
	},
	errors: {
		saveCreated: 'No se ha podido añadir el gasto fijo',
		saveUpdated: 'No se ha podido actualizar el gasto fijo',
		action: 'No se ha podido guardar el cambio de este gasto fijo',
		delete: 'No se ha podido eliminar el gasto fijo',
		withPeriod: '{subject}.',
		actionFallback: '{subject}. Inténtalo de nuevo en un momento.',
		notOwner: 'Solo quien creó este gasto fijo o un administrador del piso puede hacerlo.',
		gone: 'Este gasto fijo ya no existe. Recarga la lista.',
		euroOnly: 'Por ahora los gastos fijos solo se admiten en euros.',
		invalidRequest: 'La solicitud no era válida.',
		memberNotInWg: 'Al menos un miembro ya no está en este piso.',
		paidByMustIncludeCaller:
			'Para cambiar el importe, quien paga o las partes, tienes que ser quien paga o tener una parte superior a 0 €.',
		changedSave:
			'Este gasto fijo se ha registrado como gasto o se ha modificado entretanto. Se ha recargado la lista. Vuelve a editarlo.',
		changedAction:
			'Este gasto fijo se acaba de registrar como gasto o se ha modificado. Se ha recargado la lista. Inténtalo de nuevo.',
		amountInvalid: 'Revisa el importe.',
		descriptionInvalid: 'Escribe una descripción.',
		intervalInvalid: 'Elige una periodicidad válida.',
		dueDateInvalid: 'Revisa el próximo vencimiento.',
		splitsMismatch: 'Los importes no coinciden: las partes deben sumar exactamente el total.',
		idInvalid: 'No se ha podido identificar la entrada.',
		deleteFailed: 'Recarga la lista y comprueba si la entrada todavía existe.',
	},
} satisfies Catalog<typeof de>;
