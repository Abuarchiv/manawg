// Module-level API checks, part 2: crons, pinnwand, absences, chores, members, notifications,
// activity, export, WG deletion, account deletion. Runs standalone or after modules.mjs.
import { BASE, CRON, DAY, call, expect, finish, iso, setup, sql } from './modules-lib.mjs';

const { A, B, code, annaId, benId } = await setup();

// ---- Other crons
for (const name of ['maintenance', 'chore-reminders', 'event-reminders', 'monthly-statements']) {
	const r = await fetch(`${BASE}/api/cron/${name}`, {
		headers: { authorization: `Bearer ${CRON}` },
	});
	const t = await r.text();
	expect(r.status === 200, `Cron ${name}`, `${r.status} ${t.slice(0, 200)}`);
}

// ---- Pinnwand
const an = await call(A, 'POST', `/api/wg/${code}/announcements`, {
	content: 'Bitte Flaschen wegbringen',
	kind: 'request',
});
expect(an.status < 300, 'Pinnwand: Beitrag', JSON.stringify(an.body));
const post = an.body.announcement ?? an.body;
const cm = await call(B, 'POST', `/api/wg/${code}/announcements/${post.id}/comments`, {
	content: 'Mach ich',
});
expect(cm.status < 300, 'Pinnwand: Kommentar', JSON.stringify(cm.body));
const rx = await call(B, 'POST', `/api/wg/${code}/announcements/${post.id}/reactions`, {
	reaction: 'ok',
});
expect(rx.status < 300, 'Pinnwand: Reaktion', JSON.stringify(rx.body));
const anList = await call(B, 'GET', `/api/wg/${code}/announcements`);
expect(JSON.stringify(anList.body).includes('Flaschen'), 'Pinnwand: Liste zeigt Beitrag');
const resB = await call(B, 'PATCH', `/api/wg/${code}/announcements/${post.id}`, {
	status: 'resolved',
});
expect(resB.status === 403, 'Pinnwand: Fremder schließt nicht', JSON.stringify(resB));
const res = await call(A, 'PATCH', `/api/wg/${code}/announcements/${post.id}`, {
	status: 'resolved',
});
expect(res.status < 300, 'Pinnwand: Autor schließt', JSON.stringify(res.body));
const anEmpty = await call(A, 'PATCH', `/api/wg/${code}/announcements/${post.id}`, {});
expect(anEmpty.status === 400, 'Pinnwand: leerer Patch = 400', JSON.stringify(anEmpty));
const anDel = await call(B, 'DELETE', `/api/wg/${code}/announcements/${post.id}`);
expect(anDel.status >= 400, 'Pinnwand: Fremder löscht nicht', JSON.stringify(anDel));
const anDelOwn = await call(A, 'DELETE', `/api/wg/${code}/announcements/${post.id}`);
expect(anDelOwn.status < 300, 'Pinnwand: Autor löscht', JSON.stringify(anDelOwn.body));

// ---- Absences + chores
const ab = await call(B, 'POST', `/api/wg/${code}/absences`, {
	memberId: benId,
	startDate: iso(DAY),
	endDate: iso(3 * DAY),
	reason: 'Heimfahrt',
});
expect(ab.status < 300, 'Abwesenheit: anlegen', JSON.stringify(ab.body));
const abId = (ab.body.absence ?? ab.body).id;
const abOther = await call(B, 'POST', `/api/wg/${code}/absences`, {
	memberId: annaId,
	startDate: iso(DAY),
	endDate: iso(2 * DAY),
});
expect(abOther.status >= 400, 'Abwesenheit: nicht für andere', JSON.stringify(abOther));
const ch = await call(A, 'POST', `/api/wg/${code}/chores`, {
	title: 'Küche',
	intervalDays: 1,
	assignedMemberId: benId,
});
expect(ch.status < 300, 'Putzplan: Aufgabe für Ben', JSON.stringify(ch.body));
const chores = await call(A, 'GET', `/api/wg/${code}/chores`);
expect(chores.status === 200, 'Putzplan: Liste', JSON.stringify(chores.body).slice(0, 200));
const abDel = await call(B, 'DELETE', `/api/wg/${code}/absences/${abId}`);
expect(abDel.status < 300, 'Abwesenheit: löschen', JSON.stringify(abDel.body));

// ---- Members: rename, admin handover, move out and back
const rn = await call(B, 'PATCH', `/api/wg/${code}/members/${benId}`, {
	name: 'Benjamin',
	expectedName: 'Ben',
});
expect(rn.status < 300, 'Mitglied: umbenennen', JSON.stringify(rn.body));
const rnStale = await call(B, 'PATCH', `/api/wg/${code}/members/${benId}`, {
	name: 'Benny',
	expectedName: 'Ben',
});
expect(rnStale.status === 409, 'Mitglied: veralteter Name = 409', JSON.stringify(rnStale));
const rnOther = await call(B, 'PATCH', `/api/wg/${code}/members/${annaId}`, { name: 'X' });
expect(rnOther.status === 403, 'Mitglied: Fremder benennt nicht um', JSON.stringify(rnOther));
const adminB = await call(B, 'POST', `/api/wg/${code}/members/${benId}/admin`, {});
expect(adminB.status === 400, 'Admin: Selbstübergabe = 400', JSON.stringify(adminB));
const adminB2 = await call(B, 'POST', `/api/wg/${code}/members/${annaId}/admin`, {});
expect(adminB2.status === 403, 'Admin: nur Admin vergibt', JSON.stringify(adminB2));
const wgRenameB = await call(B, 'PATCH', `/api/wg/${code}`, { name: 'Gehackt' });
expect(wgRenameB.status === 403, 'WG: Nicht-Admin benennt nicht um', JSON.stringify(wgRenameB));
const wgRename = await call(A, 'PATCH', `/api/wg/${code}`, { name: 'Modulwohnung 2' });
expect(wgRename.status < 300, 'WG: Admin benennt um', JSON.stringify(wgRename.body));
const out = await call(A, 'PATCH', `/api/wg/${code}/members/${benId}`, { active: false });
expect(out.status < 300, 'Mitglied: Auszug', JSON.stringify(out.body));
const outRead = await call(B, 'GET', `/api/wg/${code}/dashboard`);
expect(outRead.status === 401, 'Ausgezogener hat keinen Zugriff', JSON.stringify(outRead));
const back = await call(A, 'PATCH', `/api/wg/${code}/members/${benId}`, { active: true });
expect(back.status < 300, 'Mitglied: Rückkehr', JSON.stringify(back.body));
expect(
	(await call(B, 'GET', `/api/wg/${code}/dashboard`)).status === 200,
	'Rückkehrer hat Zugriff',
);
const handover = await call(A, 'POST', `/api/wg/${code}/members/${benId}/admin`, {});
expect(handover.status < 300, 'Admin: Übergabe an Ben', JSON.stringify(handover.body));
expect(
	sql(`select role from wg_members where id='${benId}'`) === 'admin' &&
		sql(`select role from wg_members where id='${annaId}'`) === 'member',
	'Admin: genau ein Admin in DB',
);

// ---- Notifications, activity, export, mine
const nf = await call(A, 'GET', `/api/wg/${code}/notifications`);
expect(nf.status === 200, 'Benachrichtigungen: lesen', JSON.stringify(nf.body).slice(0, 200));
const nfp = await call(A, 'PATCH', `/api/wg/${code}/notifications`, { notifyChat: false });
expect(nfp.status < 300, 'Benachrichtigungen: ändern', JSON.stringify(nfp.body));
const act = await call(A, 'GET', `/api/wg/${code}/activity`);
expect(act.status === 200, 'Aktivität', JSON.stringify(act.body).slice(0, 200));
const exp = await call(A, 'GET', `/api/wg/${code}/export`);
expect(exp.status === 200, 'Export', JSON.stringify(exp.body).slice(0, 200));
const mine = await call(A, 'GET', '/api/wg/mine');
expect(
	mine.status === 200 && JSON.stringify(mine.body).includes(code),
	'Meine WGs',
	JSON.stringify(mine.body).slice(0, 200),
);

// ---- Delete WG (admin is Ben now), delete account
const delA = await call(A, 'DELETE', `/api/wg/${code}`);
expect(delA.status === 403, 'WG löschen: Nicht-Admin = 403', JSON.stringify(delA));
const delB = await call(B, 'DELETE', `/api/wg/${code}`);
expect(delB.status < 300, 'WG löschen: Admin', JSON.stringify(delB.body));
expect(+sql(`select count(*) from wgs where share_code='${code}'`) === 0, 'WG in DB weg');
expect(
	+sql('select count(*) from expenses where wg_id is null') === 0,
	'keine verwaisten Ausgaben',
);
const w2 = await call(A, 'POST', '/api/wg', { name: 'Zweite', creatorName: 'Anna' });
const code2 = w2.body.wg?.shareCode;
const inv2 = await call(A, 'POST', `/api/wg/${code2}/invites`, {});
await call(B, 'POST', `/api/wg/${code2}/members`, {
	name: 'Ben',
	inviteToken: inv2.body.url?.split('/').pop(),
});
const accDel = await call(A, 'DELETE', '/api/account', {});
expect(accDel.status < 300, 'Konto löschen (Admin mit Nachfolger)', JSON.stringify(accDel.body));
expect(
	sql(
		`select role from wg_members where wg_id=(select id from wgs where share_code='${code2}') and auth_user_id='${B.id}'`,
	) === 'admin',
	'Konto löschen: Ben wird Admin',
);
expect(
	+sql(`select count(*) from auth.users where id='${A.id}'`) === 0,
	'Konto löschen: Auth-User weg',
);
const afterDel = await call(A, 'GET', '/api/wg/mine');
expect(afterDel.status === 401, 'Konto löschen: Sitzung ungültig', JSON.stringify(afterDel));

finish();
