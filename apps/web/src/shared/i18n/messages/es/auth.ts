import type { Catalog } from '../catalog';
import type de from '../de/auth';

export default {
	tabs: { code: 'Código por correo', password: 'Contraseña' },
	sections: {
		signUp: 'Regístrate con tu correo',
		code: 'Inicia sesión con un código por correo',
		password: 'Inicia sesión con tu contraseña',
	},
	fields: {
		email: 'Correo electrónico',
		password: 'Contraseña',
		name: 'Tu nombre',
		code: 'Código de {length, number} dígitos',
		newPassword: 'Contraseña nueva',
		confirmPassword: 'Confirmar contraseña',
	},
	failure: {
		credentials:
			'El correo o la contraseña no son correctos. Revisa lo que has escrito o restablece tu contraseña.',
		unconfirmed:
			'Aún no has confirmado tu correo. Abre el enlace del correo de confirmación e inicia sesión.',
		rateLimit: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
		network:
			'No hay conexión con el servicio de inicio de sesión. Comprueba tu conexión e inténtalo de nuevo.',
		weakPassword: 'Elige una contraseña más larga o distinta que no uses en ningún otro sitio.',
		signIn: 'No se pudo iniciar sesión ahora mismo. Inténtalo de nuevo.',
		mail: 'No se pudo enviar el correo ahora mismo. Inténtalo de nuevo.',
	},
	validEmail: 'Escribe un correo electrónico válido.',
	mismatch: 'Las contraseñas no coinciden.',
	otherEmail: 'Usar otro correo electrónico',
	resendIn: 'Reenviar en {seconds, number} s',
	signIn: {
		invalid: 'Escribe un correo electrónico válido y tu contraseña.',
		incomplete: 'El inicio de sesión aún no está completo. Revisa tu correo e inténtalo de nuevo.',
		confirmationResent:
			'Si esta dirección está pendiente de confirmación, te hemos vuelto a enviar el correo. Mira también en la carpeta de spam.',
		resetSent:
			'Si existe una cuenta con este correo, en breve recibirás un enlace para restablecer tu contraseña.',
		forgot: '¿Has olvidado tu contraseña?',
		requestingLink: 'Solicitando enlace…',
		resend: 'Reenviar correo de confirmación',
		submit: 'Iniciar sesión',
	},
	code: {
		invalid: 'Escribe el código de {length, number} dígitos del correo.',
		wrong: 'El código es incorrecto o ha caducado. Solicita uno nuevo.',
		rateLimit: 'Demasiados intentos. Espera un momento.',
		send: 'Enviar código por correo',
		sent: 'Si existe una cuenta para {email}, te hemos enviado un código. Mira también en la carpeta de spam. ¿Aún no tienes cuenta? {create}',
		createLink: 'Crea una ahora.',
		hint: 'El código solo es válido durante un tiempo breve.',
		resent: 'Te hemos vuelto a enviar el código.',
		resendIn: 'Reenviar código en {seconds, number} s',
		resend: 'Reenviar código',
		submit: 'Iniciar sesión',
	},
	signUp: {
		name: 'Escribe tu nombre.',
		codeHint: 'Te enviamos un código por correo. No necesitas contraseña.',
		sent: 'Hemos enviado un código a {email}. Introdúcelo para crear tu cuenta. Si ya tienes una, el código inicia tu sesión. Mira también en la carpeta de spam.',
		submit: 'Continuar',
		confirm: 'Crear cuenta',
	},
	reset: {
		tooShort: 'La contraseña debe tener al menos {min, number} caracteres.',
		saved: 'Contraseña guardada.',
		same: 'La contraseña nueva debe ser distinta de la actual.',
		failed: 'No se pudo cambiar la contraseña ahora mismo. Solicita un enlace nuevo.',
		invalidLink: 'Este enlace no es válido o ha caducado. Solicita un enlace nuevo.',
		back: 'Atrás',
		hint: 'Al menos {min, number} caracteres.',
		saving: 'Guardando contraseña…',
		save: 'Guardar contraseña',
		sendLink: 'Enviar enlace',
	},
	social: {
		signIn: 'Iniciar sesión con {provider}',
		signUp: 'Registrarse con {provider}',
		link: 'Vincular {provider}',
		pendingSignIn: 'Iniciando sesión con {provider}…',
		pendingLink: 'Vinculando {provider}…',
		linkFailed: 'No se pudo vincular la cuenta. Inténtalo más tarde.',
		unreachable:
			'El inicio de sesión no está disponible ahora mismo. Comprueba tu conexión e inténtalo de nuevo.',
	},
	prompt: { noAccount: '¿Aún no tienes cuenta?', create: 'Crear cuenta' },
} satisfies Catalog<typeof de>;
