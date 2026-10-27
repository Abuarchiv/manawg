import { mutationErrorMessage } from '@/core/http/error-codes';

const SUBJECT = 'Ausgleich konnte nicht gespeichert werden';
const ERRORS: Record<string, string> = {
	settlement_changed:
		'Die offenen Beträge haben sich geändert. Prüfe die Zahlung erneut, bevor du sie einträgst.',
	settlement_review_required: 'Prüfe zuerst die betroffenen Ausgaben und den Betrag.',
	member_not_in_wg: `${SUBJECT}: Mindestens ein Mitglied ist nicht mehr in dieser WG.`,
	not_party_to_debt: `${SUBJECT}: Du bist an dieser Schuld nicht beteiligt.`,
	same_member: `${SUBJECT}: Die Anfrage war ungültig.`,
	member_ids_invalid: `${SUBJECT}: Die Anfrage war ungültig.`,
	invalid_json: `${SUBJECT}: Die Anfrage war ungültig.`,
	invalid_body: `${SUBJECT}: Die Anfrage war ungültig.`,
	amount_invalid: 'Barzahlung konnte nicht gespeichert werden: Der Betrag ist ungültig.',
	currency_invalid: 'Barzahlung konnte nicht gespeichert werden: Der Betrag ist ungültig.',
	payment_not_found: 'Diese Barzahlung gibt es nicht mehr.',
	payment_voided: 'Diese Barzahlung ist schon storniert.',
	paypal_payment_pending: 'Eine PayPal-Zahlung läuft noch. Warte auf deren Abschluss.',
};

/** Copy for a failed manual settlement (`POST /expenses/settle-batch`). */
export function settlementErrorMessage(error: string): string {
	return mutationErrorMessage(SUBJECT, error, ERRORS, `${SUBJECT}.`);
}
