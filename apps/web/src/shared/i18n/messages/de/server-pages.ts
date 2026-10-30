export default {
	unsubscribe: {
		statement: {
			title: 'Monatsabrechnung abbestellen',
			question: 'Monatsabrechnung abbestellen?',
			explain:
				'Du bekommst die Abrechnung am Monatsanfang dann nicht mehr per E-Mail. In der App bleibt sie abrufbar.',
			done: 'Du bekommst keine Monatsabrechnung mehr per E-Mail. Unter Einstellungen in der App kannst du sie wieder einschalten.',
		},
		reminders: {
			title: 'Erinnerungen abbestellen',
			question: 'Erinnerungen an offene Beträge abbestellen?',
			explain:
				'Mitbewohner können dich dann nicht mehr per E-Mail oder Push an offene Beträge erinnern. Deine Salden bleiben in der App sichtbar.',
			done: 'Du bekommst keine Erinnerungen mehr. Unter Einstellungen in der App kannst du sie wieder einschalten.',
		},
		submit: 'Abbestellen',
		hint: 'Du kannst es jederzeit unter Einstellungen wieder einschalten.',
		doneTitle: 'Abbestellt',
		doneHeading: 'Abbestellt.',
		invalidTitle: 'Link ungültig',
		invalidBody:
			'Dieser Link ist ungültig oder abgelaufen. Ändere die Einstellung in der App unter Einstellungen.',
	},
} as const;
