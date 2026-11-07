import type { Catalog } from '../catalog';
import type de from '../de/offline-failure';

export default {
	noConnection: {
		title: 'Todavía sin conexión',
		detail: 'La acción sigue guardada y se reintentará cuando vuelvas a tener conexión.',
	},
	rateLimited: {
		title: 'Demasiadas solicitudes',
		detail: 'La acción sigue en la cola y se enviará de nuevo automáticamente en un momento.',
	},
	tooLarge: {
		title: 'La imagen o la entrada es demasiado grande',
		detail: 'Quita el adjunto o elige una imagen más pequeña y vuelve a intentarlo.',
	},
	accessMissing: {
		title: 'Falta acceso',
		detail: 'Abre el piso otra vez o comprueba que tu cuenta de miembro siga teniendo acceso.',
	},
	sessionExpired: {
		title: 'Sesión caducada',
		detail: 'Inicia sesión de nuevo y reintenta la acción.',
	},
	targetGone: {
		title: 'Entrada no encontrada',
		detail:
			'La entrada o el piso han cambiado mientras tanto. Revisa la acción antes de volver a intentarlo.',
	},
	serverNotReady: {
		title: 'Servidor no disponible',
		detail: 'La acción sigue en la cola. Inténtalo de nuevo en un momento.',
	},
	syncFailed: {
		title: 'Error al sincronizar',
		detail: 'La acción sigue en la cola. Inténtalo de nuevo más tarde.',
	},
	rejected: {
		title: 'Rechazada por el servidor',
		detail: 'La acción no se enviará de nuevo. Edítala o descártala aquí.',
	},
	maintenance: {
		title: 'App en mantenimiento',
		detail: 'La acción sigue en la cola y se enviará cuando termine el mantenimiento.',
	},
	memberInvalid: {
		title: 'Tu acceso como miembro ya no es válido',
		detail:
			'Abre el piso otra vez o únete con un enlace de invitación actual antes de enviar esta acción.',
	},
	movedOut: {
		title: 'Te has ido del piso',
		detail:
			'Figuras como baja en este piso. Volver a iniciar sesión no lo soluciona. Pide a un admin que te reactive antes de enviar esta acción.',
	},
	memberInAction: {
		title: 'Revisa a las personas implicadas',
		detail:
			'Un miembro implicado ya no está en el piso. Edita la asignación o el reparto antes de volver a enviar.',
	},
	flatLinkInvalid: {
		title: 'El enlace del piso ya no es válido',
		detail: 'Revisa el enlace de invitación o pide uno nuevo antes de enviar esta acción.',
	},
	templateMissing: {
		title: 'Falta la plantilla de gasto fijo',
		detail:
			'La plantilla ya no existe. Quita esta acción sin conexión o vuelve a crear el gasto fijo.',
	},
	recurringPaused: {
		title: 'Gasto fijo en pausa',
		detail:
			'El gasto fijo se ha pausado mientras tanto. Quita esta acción sin conexión o reanuda el gasto fijo.',
	},
	shoppingMissing: {
		title: 'Falta el artículo de la compra',
		detail:
			'El artículo ya no existe. Quita esta acción sin conexión o vuelve a añadir el artículo.',
	},
	templateChanged: {
		title: 'Plantilla de gasto fijo modificada',
		detail:
			'Alguien ha cambiado la plantilla mientras tanto. Quita esta acción sin conexión y registra el gasto fijo con los valores actuales.',
	},
	shoppingChanged: {
		title: 'Estado de la compra modificado',
		detail:
			'Alguien ha cambiado el artículo mientras tanto. Revisa el estado actual antes de volver a poner la acción en cola.',
	},
	choreChanged: {
		title: 'Tarea de limpieza modificada',
		detail:
			'La tarea se ha completado o reasignado mientras tanto. Revisa el plan actual antes de volver a poner la acción en cola.',
	},
	choreMissing: {
		title: 'Falta la tarea del plan de limpieza',
		detail: 'La tarea ya no existe. Quita esta acción sin conexión o vuelve a añadir la tarea.',
	},
	expenseChanged: {
		title: 'Gasto modificado',
		detail:
			'Alguien ha cambiado el gasto mientras tanto. Revisa los valores actuales antes de volver a poner el cambio en cola.',
	},
	expenseSettled: {
		title: 'Parte ya saldada',
		detail:
			'Una parte se ha saldado mientras tanto. Descarta el cambio y vuelve a editar el gasto.',
	},
	recurringAdvanced: {
		title: 'Gasto fijo ya registrado',
		detail:
			'Este gasto fijo ya se registró para este vencimiento. Quita esta acción sin conexión y revisa los gastos.',
	},
	expenseMissing: {
		title: 'Falta el gasto',
		detail: 'El gasto ya no existe. Quita esta acción sin conexión o vuelve a registrar el gasto.',
	},
	splitMissing: {
		title: 'Falta la parte del gasto',
		detail: 'La parte ya no existe. Quita esta acción sin conexión o revisa de nuevo el gasto.',
	},
	imageInvalid: {
		title: 'Revisa el adjunto',
		detail: 'Quita el adjunto o elige una imagen válida antes de volver a enviar.',
	},
	amountInvalid: {
		title: 'Revisa el importe',
		detail: 'Edita el importe y el reparto antes de volver a enviar esta acción.',
	},
	currencyInvalid: {
		title: 'Revisa la moneda',
		detail: 'Vuelve a registrar el gasto en euros.',
	},
	splitsInvalid: {
		title: 'Revisa el reparto',
		detail: 'Edita el importe y el reparto antes de volver a enviar esta acción.',
	},
	entryInvalid: {
		title: 'Revisa la entrada',
		detail: 'Edita los campos resaltados antes de volver a enviar esta acción.',
	},
	kindInvalid: {
		title: 'Revisa la categoría',
		detail: 'Elige una categoría actual del tablón antes de volver a enviar la publicación.',
	},
	sourceInvalid: {
		title: 'Revisa el enlace de origen',
		detail: 'Quita el enlace de origen antiguo o vuelve a escribir la publicación del tablón.',
	},
	quantityInvalid: {
		title: 'Revisa la cantidad',
		detail: 'Acorta o quita la cantidad antes de volver a enviar este artículo de la compra.',
	},
	dateInvalid: {
		title: 'Revisa la fecha',
		detail: 'Edita la fecha o el período antes de volver a enviar esta acción.',
	},
	absenceOverlaps: {
		title: 'La ausencia se solapa',
		detail:
			'Esta persona ya está ausente en ese período. Quita esta acción sin conexión o ajusta el período.',
	},
	actionInvalid: {
		title: 'Revisa la acción sin conexión',
		detail:
			'La acción guardada ya no coincide con la versión actual de la app. Quítala y vuelve a registrar la entrada.',
	},
	targetInvalid: {
		title: 'Revisa la entrada',
		detail:
			'La referencia guardada de la entrada no es válida. Quita esta acción sin conexión y abre la entrada de nuevo.',
	},
	statusInvalid: {
		title: 'Revisa el estado',
		detail: 'Revisa el estado de la compra antes de volver a enviar esta acción.',
	},
	intervalInvalid: {
		title: 'Revisa el intervalo',
		detail: 'Edita el intervalo antes de volver a enviar esta acción.',
	},
	reasonInvalid: {
		title: 'Revisa el motivo',
		detail: 'Acorta o quita el motivo de la ausencia antes de volver a enviar esta acción.',
	},
	choreIncomplete: {
		title: 'Plan de limpieza guardado solo en parte',
		detail:
			'Puede que la tarea haya rotado pero no se registró en el historial. Recarga el plan de limpieza y revisa el historial antes de volver a enviar.',
	},
	expenseIncomplete: {
		title: 'Gasto guardado solo en parte',
		detail:
			'El gasto o su reparto no se guardó por completo. Recarga los gastos y revisa la entrada antes de volver a enviar.',
	},
	saveUnconfirmed: {
		title: 'Guardado sin confirmar',
		detail:
			'El servidor no confirmó la entrada. Recarga el piso y comprueba si la acción ya llegó.',
	},
	removeUnconfirmed: {
		title: 'Eliminación sin confirmar',
		detail:
			'El servidor no confirmó la eliminación. Recarga el piso y revisa la entrada antes de volver a enviar.',
	},
	updateUnconfirmed: {
		title: 'Actualización sin confirmar',
		detail:
			'El servidor no confirmó el cambio. Recarga el piso y revisa el estado actual antes de volver a enviar.',
	},
} satisfies Catalog<typeof de>;
