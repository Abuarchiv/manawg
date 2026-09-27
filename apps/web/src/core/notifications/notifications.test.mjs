import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const { ModuleKind, ScriptTarget, transpileModule } = requireFromWeb('typescript');
const source = readFileSync(
	path.join(process.cwd(), 'src/core/notifications/notifications.ts'),
	'utf8',
);
const compiled = transpileModule(source, {
	compilerOptions: {
		module: ModuleKind.CommonJS,
		target: ScriptTarget.ES2022,
		esModuleInterop: true,
	},
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
	(name) => (name === '@/core/utils/money' ? { formatEuroCents: () => '' } : requireFromWeb(name)),
	module,
	module.exports,
);
const { formatNotificationMessage } = module.exports;

test('event notification times use Europe/Berlin in summer and winter', () => {
	const previousTimezone = process.env.TZ;
	process.env.TZ = 'UTC';
	try {
		const summer = formatNotificationMessage('event.upcoming', {
			wgName: 'WG',
			title: 'Treffen',
			startsAt: '2026-07-01T18:00:00.000Z',
		});
		const winter = formatNotificationMessage('event.created', {
			wgName: 'WG',
			title: 'Treffen',
			startsAt: '2026-01-01T18:00:00.000Z',
		});
		const today = formatNotificationMessage('event.today', {
			wgName: 'WG',
			title: 'Treffen',
			startsAt: '2026-01-01T18:00:00.000Z',
		});
		const allDay = formatNotificationMessage('event.today', {
			wgName: 'WG',
			title: 'Feiertag',
			startsAt: '2026-01-01T23:00:00.000Z',
			allDay: true,
		});
		const ongoing = formatNotificationMessage('event.today', {
			wgName: 'WG',
			title: 'Nachtfahrt',
			startsAt: '2026-01-01T23:00:00.000Z',
			ongoing: true,
		});

		assert.match(summer.body, /01\.07\., 20:00/);
		assert.match(winter.body, /01\.01\., 19:00/);
		assert.equal(today.title, 'Termin heute');
		assert.match(today.body, /^Heute in WG:/);
		assert.match(allDay.body, /ist ganztägig/);
		assert.doesNotMatch(allDay.body, /23:00|00:00/);
		assert.match(ongoing.body, /läuft noch/);
	} finally {
		if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
		else process.env.TZ = previousTimezone;
	}
});
