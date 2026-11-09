import type { Catalog } from '../catalog';
import type de from '../de/expenses-form';

export default {
	title: {
		editTemplate: 'Editar plantilla de gasto fijo',
		editQueuedTemplate: 'Editar plantilla de gasto fijo en cola',
		editQueuedExpense: 'Editar gasto en cola',
		edit: 'Editar gasto',
		add: 'Añadir gasto',
	},
	submit: {
		saveTemplate: 'Guardar plantilla',
		saveTemplateAria: 'Guardar plantilla de gasto fijo',
		saveAsExpense: 'Guardar como gasto',
		save: 'Guardar',
		saveAria: 'Guardar gasto',
	},
	fields: {
		description: 'Descripción',
		descriptionPlaceholder: 'p. ej. Compra semanal',
		amount: 'Importe',
		amountPlaceholder: '0,00',
		category: 'Categoría',
		date: 'Fecha',
		paidBy: 'Pagado por',
		payerYou: '{name} (tú)',
		payerLocked: 'No se puede cambiar quién pagó un gasto ya existente.',
	},
	actions: {
		cancelAria: 'Cerrar el formulario de gasto',
		cancel: 'Cancelar',
		loadServer: 'Cargar la versión del servidor',
		keepDraft: 'Conservar mi borrador',
	},
	draft: {
		replaceTitle: '¿Descartar el borrador?',
		replaceBody:
			'Lo que no has guardado se sustituirá por “{description}”. Los gastos ya guardados se mantienen.',
		replaceKeep: 'Conservar borrador',
		replaceDiscard: 'Descartar borrador',
		closeTitle: '¿Conservar el borrador?',
		closeBody: 'No se guarda ningún gasto. Puedes seguir con tu borrador más tarde o descartarlo.',
		closeContinue: 'Seguir editando',
		closeDiscard: 'Descartar borrador',
		closeKeep: 'Conservar borrador',
		existingKept: 'Se conserva tu borrador existente.',
		replaceWith: 'Descartar el borrador y usar “{description}”',
		notSynced: 'Aún sin sincronizar. El cambio se enviará cuando tengas conexión.',
	},
	split: {
		legend: 'Personas implicadas y reparto',
		toggleAria: 'Reparto',
		equal: 'A partes iguales',
		equalAria: 'Reparto: a partes iguales',
		manual: 'Manual',
		manualAria: 'Reparto: manual',
		lockedHint:
			'Las partes de quienes se han ido del piso no cambian; solo los miembros activos asumen el resto.',
		movedOut: '(se ha ido)',
		shareAria: 'Parte de {name} en {currency, select, EUR {euros} other {{currency}}}',
		shareAriaMovedOut:
			'Parte de {name} en {currency, select, EUR {euros} other {{currency}}}, se ha ido del piso. La parte no cambia.',
		zeroHint: 'Déjalo vacío o escribe {zero} si no tiene parte.',
		settledShareLocked:
			'La parte de {name} ({previous}) ya está marcada como pagada y no se puede cambiar{removed, select, yes { ni quitar.} other { (pasaría a ser {next}).}} Reabre primero el pago y después podrás ajustarla.',
		participantsAria: 'Personas implicadas',
		reviewAria: 'Partes antes de guardar',
		noShare: 'Sin parte',
		ownShare: 'Parte propia · ya pagada',
		sum: 'Total:',
		balanced: 'Cuadra',
		tooMuch: 'Demasiado',
		open: 'Pendiente',
		distribute: 'Repartir el resto',
	},
	extras: {
		addReceipt: 'Añadir ticket',
		attached: 'Adjunto',
		receipt: 'Ticket',
		template: 'Plantilla de gasto fijo',
		repeat: 'Repetir',
		templateHint: 'La plantilla recuerda el importe, quién pagó y este reparto.',
		saveAsTemplate: 'Guardar como plantilla',
		templateSaved: 'Guardado como plantilla. La encontrarás en Gastos fijos.',
	},
	intervals: {
		optionMonths: '{count, plural, one {# mes} other {# meses}}',
		optionQuarter: '3 meses',
		optionYear: '12 meses',
		monthly: 'mensual',
		quarterly: 'trimestral',
		halfYearly: 'cada seis meses',
		yearly: 'anual',
		everyMonths: 'cada {count} meses',
	},
	validation: {
		description: 'Escribe una descripción breve.',
		date: 'Elige una fecha que no sea futura.',
		amountDecimals: 'Como máximo dos decimales.',
		amountTooLarge: 'El importe puede ser como máximo 1.000.000 €.',
		amountInvalid: 'Introduce un importe superior a 0 €, p. ej. 12,50.',
	},
	notices: {
		receiptUploadFailed: 'No se pudo subir el ticket. Inténtalo de nuevo o quítalo.',
		draftBroken:
			'Este borrador ya no se puede asociar a su gasto. Abre de nuevo el gasto original o descarta el borrador.',
		draftBrokenKept:
			'Este borrador ya no se puede asociar a su gasto. Tus datos se conservan; abre de nuevo el gasto original o descarta el borrador.',
		reloadFailed: 'No se pudo recargar la lista. Inténtalo de nuevo en un momento.',
		conflict:
			'Este gasto ha cambiado mientras tanto. Recarga la lista y decide qué versión es la correcta.',
		templateUnavailable:
			'La plantilla de gasto fijo no está disponible. Actualiza la página e inténtalo de nuevo.',
		saved: 'Gasto guardado.',
		updated: 'Gasto actualizado.',
		savedLent:
			'{count, plural, one {Guardado. Te devuelven {amount} ({name}).} other {Guardado. Te devuelven {amount} de {count} personas.}}',
		savedOwe: 'Guardado. Debes {amount} a {payer}.',
		savedOwn: 'Guardado. Solo para ti, nada que repartir.',
		noMoneyMoved: 'Aquí no se transfiere dinero.',
		keyUnavailableExpense: 'No se pudo enviar el gasto de forma fiable. Inténtalo de nuevo.',
		keyUnavailableRecurring: 'No se pudo enviar el gasto fijo de forma fiable. Inténtalo de nuevo.',
		keyUnavailableTemplate:
			'No se pudo guardar la plantilla de gasto fijo de forma fiable. Inténtalo de nuevo.',
		recurringQueued:
			'Gasto fijo en cola sin conexión. La plantilla no cambia hasta que se sincronice.',
		recurringQueueBlocked:
			'El almacenamiento sin conexión está bloqueado. No se pudo poner el gasto fijo en cola y se deshizo.',
		recurringBooked: 'Gasto fijo registrado.',
		templateAlreadyQueued:
			'La plantilla de gasto fijo ya está en cola sin conexión. Sincroniza o resuelve primero la acción existente.',
		templateSavedOffline: 'Plantilla de gasto fijo guardada sin conexión.',
		templateGoneRemoved: 'Esta plantilla de gasto fijo ya no existe y se ha quitado de la lista.',
		templateUpdated: 'Plantilla de gasto fijo actualizada.',
		templateSaved: 'Guardado como plantilla ({interval}).',
		offlineSaved: 'Guardado sin conexión. Se sincronizará cuando vuelvas a tener conexión.',
		queueBlockedDraft:
			'El almacenamiento sin conexión está bloqueado. Deja abierto el borrador e inténtalo más tarde.',
		offlineDraftCleanupFailed:
			'Guardado sin conexión, pero no se pudo quitar el borrador antiguo. Revisa la cola sin conexión.',
		draftCleanupFailed: 'Guardado, pero no se pudo quitar el borrador antiguo sin conexión.',
		queueEditAlreadySent: 'La entrada ya se ha enviado. Revisa la lista.',
	},
	errors: {
		withPeriod: '{subject}.',
		invalidRequest: 'La solicitud no era válida.',
		splitSumMismatch: 'Los importes no cuadran. Las partes deben sumar exactamente el total.',
		paidByMustIncludeCaller:
			'Si añades un gasto en nombre de otra persona, tu propia parte debe ser superior a 0 €.',
		notTemplateOwner:
			'Solo quien creó este gasto fijo o un admin del piso puede cambiarlo o eliminarlo.',
		recurringNotFound: 'Esta plantilla de gasto fijo ya no existe. Recarga los gastos.',
		editedExpenseDeleted:
			'El gasto original se eliminó. Tus cambios sin guardar siguen en el borrador; puedes copiarlos o descartar el borrador.',
		save: {
			subject: 'No se pudo guardar el gasto',
			amountInvalid: 'El importe no es válido.',
			descriptionInvalid: 'La descripción debe tener entre 1 y {max} caracteres.',
			currencyInvalid: 'La moneda no es válida.',
			imageInvalid: 'El adjunto no es válido.',
			imageRemoved: 'Se quitó el adjunto. Súbelo de nuevo.',
			expectedUpdatedAtInvalid: 'Recarga la lista e inténtalo de nuevo.',
			occurredAtInvalid: 'Revisa la fecha del gasto.',
			splitsDuplicateDebtor:
				'El reparto incluye a una persona dos veces. Cada persona solo puede aparecer una vez.',
			notPayer: 'Solo quien pagó puede editar este gasto.',
			hasSettledShares:
				'Una parte ya está saldada, así que el importe y el reparto no cambian; aún puedes cambiar la descripción, la fecha y la categoría.',
			recurringPaused: 'Este gasto fijo está en pausa. Reanúdalo en Gastos fijos.',
			recurringAdvanced:
				'Este gasto fijo ya se registró para este vencimiento. Recarga los gastos y revisa la lista.',
			recurringChanged:
				'Este gasto fijo ha cambiado mientras tanto. Se ha recargado la lista: revisa el importe y el reparto y vuelve a registrarlo.',
			memberNotInWg: 'Al menos un miembro ya no está en este piso.',
			insertFailed: 'Revisa la lista de gastos e inténtalo de nuevo.',
			splitInsertFailed:
				'No se pudo guardar el gasto por completo: recarga los gastos y revisa el reparto.',
			fetchFailed: 'Puede que el gasto se haya guardado: recarga los gastos y revisa la entrada.',
		},
		template: {
			subject: 'No se pudo guardar la plantilla',
			memberNotInWg: 'Al menos un miembro de la plantilla de gasto fijo ya no está en este piso.',
			insertFailed: 'Revisa la lista e inténtalo de nuevo.',
			updateFailed: 'No se pudo actualizar la plantilla: recarga los gastos y revisa la plantilla.',
			amountInvalid: 'Revisa el importe.',
			descriptionInvalid: 'Escribe una descripción.',
			intervalInvalid: 'Elige un intervalo válido.',
			dueDateInvalid: 'Revisa el próximo vencimiento.',
			changed:
				'La plantilla acaba de usarse o modificarse. Recarga los gastos y vuelve a editarla.',
		},
		templateDelete: {
			subject: 'No se pudo eliminar la plantilla',
			idInvalid: 'No se pudo identificar esta plantilla.',
			deleteFailed: 'Recarga los gastos y comprueba si todavía existe.',
		},
		advance: {
			alreadyAdvanced:
				'El gasto se registró, pero la plantilla ya había pasado al siguiente vencimiento. Comprueba si este gasto fijo se registró dos veces.',
			updateFailed:
				'El gasto se registró, pero no se pudo pasar la plantilla de gasto fijo al siguiente vencimiento. Recarga los gastos y revisa el próximo vencimiento.',
			generic:
				'El gasto se registró, pero no se pudo pasar la plantilla de gasto fijo al siguiente vencimiento. Vuelve a revisarlo más tarde.',
		},
		split: {
			invalidShare:
				'Al menos una parte no es válida. Introduce un importe válido o deja el campo vacío.',
			empty: 'El reparto está vacío. Introduce al menos un importe.',
			noMembers: 'Elige al menos una persona implicada.',
		},
	},
} satisfies Catalog<typeof de>;
