import type { Catalog } from '../catalog';
import type de from '../de/expenses-import';

export default {
	title: 'Importar gastos',
	back: 'Volver a los gastos',
	stepOf: 'Paso {step} de 5',
	progressAria: 'Importación: paso {step} de 5',
	boundary: {
		title: 'No se pudo cargar el asistente de importación',
		body: 'Algo salió mal al cargar el asistente de importación. Inténtalo de nuevo o vuelve al resumen del piso.',
	},
	actions: {
		back: 'Atrás',
		createPreview: 'Crear vista previa',
		continueToPreview: 'Continuar a la vista previa',
		import: 'Importar ({count})',
		toExpenses: 'Ir a los gastos',
	},
	source: {
		heading: 'Elige una fuente de importación',
		splitwise: { title: 'CSV de Splitwise', hint: 'Archivo de Splitwise' },
		splid: { title: 'CSV de Splid', hint: 'Archivo de Splid' },
		tricount: { title: 'CSV de Tricount', hint: 'Archivo de Tricount (guardado como CSV)' },
		settleup: { title: 'CSV de Settle Up', hint: 'Archivo de Settle Up' },
		screenshot: { title: 'Captura de pantalla', hint: 'Foto o captura de pantalla' },
	},
	input: {
		headingImage: 'Añade una imagen',
		headingFile: 'Elige el archivo de exportación',
		screenshot: {
			ariaLabel: 'Elegir captura de pantalla',
			fallback: 'Elegir imagen',
			hint: 'Foto o captura de pantalla de hasta 10 MB. Solo se reconocen importes en euros (EUR).',
			running: 'Leyendo la imagen. Puede tardar hasta 30 segundos.',
			summary: 'Revisa o corrige el resultado',
			label: 'Datos reconocidos',
			placeholder: 'Revisa y corrige aquí el resultado',
		},
		csv: {
			ariaLabel: 'Elegir archivo CSV',
			fallback: 'Elegir archivo',
			hint: 'Archivo de exportación de hasta 5 MB.',
			summary: 'O pega el contenido',
			label: 'Contenido de la exportación',
			placeholder: 'Pega aquí el contenido de tu exportación',
		},
		errors: {
			imageTooLarge: 'La imagen es demasiado grande (máx. 10 MB).',
			csvTooLarge: 'El archivo CSV es demasiado grande (máx. 5 MB).',
			fileUnreadable: 'No se pudo leer el archivo. Vuelve a elegirlo.',
			ocrNeedsReload:
				'No se pudo cargar el reconocimiento de texto. Comprueba tu conexión a internet y recarga la página antes de volver a intentarlo.',
			ocrInit:
				'No se pudo iniciar el reconocimiento de texto. Comprueba tu conexión a internet e inténtalo de nuevo.',
			ocrFailed: 'Falló el reconocimiento de texto. Prueba con una imagen más nítida.',
		},
	},
	mapping: {
		heading: 'Asocia los nombres con tus compañeros de piso',
		open: 'Asocia los nombres que aún faltan.',
		fuzzy: 'Algunos nombres se asociaron solo por parecido. Revísalos.',
		allRecognised: 'Todos los nombres se reconocieron automáticamente. Revísalos.',
		noNames: 'No se encontró ningún nombre.',
		suggestion: 'Sugerido, revísalo',
		selectAria: 'Elegir compañero de piso para {name}',
		unassigned: 'Aún sin asociar',
		skip: 'Omitir (saltar filas)',
		skipHint: 'Los gastos con {name} no se importan, por ejemplo porque se ha ido del piso.',
		required: 'Elige un compañero de piso.',
	},
	preview: {
		heading: 'Vista previa',
		selected: '{count} seleccionados',
		hint: 'Revisa los importes y las partes. Desmarca las entradas que no quieras.',
		skipDuplicates: 'Omitir duplicados',
		skipDuplicatesHint: 'Misma fecha, descripción, importe y pagador.',
		empty: 'No se encontraron gastos',
		listAria: 'Vista previa de la importación',
		entryAria: 'Entrada de importación {number}',
		paidBy: 'pagado por {name}',
		willSkip: 'se omitirá',
		unmatched: '{name} (sin asociar)',
		splitAria: 'Reparto',
		rejectedTitle:
			'{count, plural, one {No se pudo leer # fila} other {No se pudieron leer # filas}}',
		rejectedDetails: 'Mostrar detalles',
		rejectedRow: 'Fila {line}: {description} ({reason})',
	},
	result: {
		heading: 'Importación terminada',
		warningTitle: 'Aviso de notificación',
		warningFailed:
			'La importación se guardó, pero la notificación al piso no se pudo entregar a todos.',
		warningUnknown:
			'La importación se guardó, pero no se pudo confirmar la entrega de la notificación al piso.',
		rejectedTitle: 'Entradas no importadas',
		rejectedEntry: 'Entrada {number}: {reason}',
		rejectedEntryWithRow: 'Entrada {number} ({description}, {date}, {amount}): {reason}',
	},
	progress: {
		aria: 'Importación en curso',
		pending: 'Importando…',
		failed: 'Falló la importación',
		withErrors: 'Terminada con errores',
		withoutErrors: 'Terminada sin errores',
		retry: 'Inténtalo de nuevo.',
		summary:
			'{inserted} importados · {skipped} omitidos · {errors, plural, one {# error} other {# errores}}',
	},
	leave: {
		title: '¿Descartar los datos de la importación?',
		description:
			'Se pierden los datos y las asociaciones introducidos hasta ahora. No se importa ningún gasto nuevo.',
		keep: 'Seguir editando',
		discard: 'Descartar',
	},
	history: {
		title: 'Importaciones anteriores',
		loadFailed: 'No se pudieron cargar las importaciones anteriores.',
		splitwise: 'Splitwise',
		splid: 'Splid',
		tricount: 'Tricount',
		settleup: 'Settle Up',
		screenshot: 'Captura de pantalla',
		other: 'Importación',
		description: '{source} del {date}',
		entry: '{description}: {count, plural, one {# gasto} other {# gastos}}',
		entryBy: '{description}: {count, plural, one {# gasto} other {# gastos}}, de {author}',
	},
	undo: {
		button: 'Deshacer importación',
		confirm: 'Eliminar todos los gastos importados',
		buttonAria: 'Deshacer importación: {description}',
		confirmAria: 'Eliminar todos los gastos importados: {description}',
		cancel: 'Cancelar',
		doneUnknown: 'Importación deshecha.',
		done: 'Importación deshecha: {count, plural, one {# gasto eliminado} other {# gastos eliminados}}.',
		errors: {
			settled:
				'Algunas partes de esta importación ya están pagadas. Si son incorrectas, elimina los gastos uno por uno.',
			notOwner: 'Solo quien hizo la importación, o un admin, puede deshacerla.',
			notFound: 'Esta importación ya no existe.',
			fallback: 'No se pudo deshacer la importación.',
		},
	},
	errors: {
		failedPreview: 'Falló la vista previa',
		failedImport: 'Falló la importación',
		keyUnavailable: 'No se pudo enviar la importación de forma fiable. Inténtalo de nuevo.',
		rateLimited: 'Demasiados intentos de importación. Espera un momento e inténtalo de nuevo.',
		retryLater: 'No se pudo procesar la importación ahora mismo. Inténtalo de nuevo en breve.',
		sessionExpired: 'Abre el piso otra vez para que se cargue tu acceso como miembro.',
		wgUnavailable: 'No se encontró el piso. Abre de nuevo el enlace actual del piso.',
		invalidShareCode: 'El enlace del piso no es válido. Abre el piso otra vez.',
		authInvalidated: 'Ya no eres miembro de este piso. Vuelve a unirte al piso.',
		memberDeactivated: 'Tu cuenta de miembro ya no está activa. Vuelve a unirte al piso.',
		memberNotInWg: 'Al menos una asociación ya no pertenece a este piso. Revisa las asociaciones.',
		mappingIncomplete: 'Asocia cada nombre con un compañero de piso.',
		payloadChanged:
			'Los datos cambiaron después de la vista previa. Vuelve a crear la vista previa.',
		payloadTooLarge:
			'El archivo es demasiado grande. Elige uno más pequeño (CSV de hasta 5 MB, imagen de hasta 10 MB).',
		tooManyRows:
			'El archivo tiene demasiadas filas (máx. 2000). Divide la exportación en varios archivos.',
		unsupportedCurrency:
			'Este archivo no contiene ninguna moneda compatible. Usa una exportación en euros (EUR).',
		emptyPayload: 'No se encontraron gastos. Revisa el archivo e inténtalo de nuevo.',
		rowsUnreadable:
			'No se pudo leer ninguna fila del archivo. Revisa la fecha, el importe y quién pagó en el archivo.',
		invalidSkipIndexes: 'La selección está desactualizada. Abre de nuevo la vista previa.',
		previewHashRequired: 'Falta la vista previa. Vuelve a crearla.',
		invalidBody:
			'No se pudieron leer los datos de la importación. Revisa la exportación e inténtalo de nuevo.',
		payerUnmapped: 'No se pudo asociar a quien pagó. Revisa las asociaciones.',
		noValidSplits: 'No se encontró ningún reparto válido. Revisa las partes.',
		splitSumMismatch: 'Las partes no suman el total. Revisa el archivo.',
		paidByMustIncludeCaller:
			'Solo puedes importar gastos que hayas pagado tú o en los que participes. El admin importa el historial completo del piso.',
		insertFailed: 'No se pudo guardar esta entrada. Inténtalo de nuevo.',
		importInsertFailed:
			'No se pudo guardar la importación ahora mismo. Inténtalo de nuevo en breve.',
		fallback: 'No se pudo completar la importación. Inténtalo de nuevo.',
	},
	recovery: {
		mapping: 'Revisar asociaciones',
		preview: 'Abrir vista previa',
		input: 'Corregir los datos',
		retry: 'Reintentar',
	},
	rejected: {
		dateInvalid: 'Fecha ilegible',
		amountInvalid: 'Importe ilegible',
		noParticipants: 'Sin personas implicadas',
		payerMissing: 'Falta quien pagó',
		multiplePayers: 'Varios pagadores – introdúcelo a mano',
		incomeUnsupported: 'Ingreso – introdúcelo a mano',
		currencyUnsupported: 'Moneda extranjera – solo se importa EUR',
		fallback: 'La fila no se puede importar',
	},
	warnings: {
		quoted: '“{name}”',
		list: '{head}, {tail}',
		unknownColumns:
			'{count, plural, one {La columna {columns} no se reconoció y se ignoró.} other {Las columnas {columns} no se reconocieron y se ignoraron.}}',
		splitsDrift: 'El reparto difería ligeramente del total y se ajustó automáticamente.',
		splitsDiscarded:
			'El reparto personalizado difería demasiado del total y se descartó. En su lugar, el importe se reparte a partes iguales.',
		paymentRow: 'Reembolso, no un gasto. Omite esta fila si no quieres que figure en las cuentas.',
		ocr: 'Leído de la imagen: revisa la fecha, el importe y quién pagó. El gasto se asigna solo a quien pagó, así que no se genera ningún importe pendiente.',
		fallback: 'Revisa esta fila.',
	},
} satisfies Catalog<typeof de>;
