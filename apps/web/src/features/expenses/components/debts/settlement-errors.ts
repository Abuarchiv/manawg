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

const VOID_SUBJECT = 'Barzahlung konnte nicht storniert werden';
const VOID_ERRORS: Record<string, string> = {
	not_party_to_debt: `${VOID_SUBJECT}: Du bist an dieser Zahlung nicht beteiligt.`,
	payment_not_found: ERRORS.payment_not_found as string,
	payment_voided: ERRORS.payment_voided as string,
	paypal_payment_pending: ERRORS.paypal_payment_pending as string,
};

/** Copy for a failed void (`DELETE /payments/manual/[id]`). */
export function cashVoidErrorMessage(error: string): string {
	return mutationErrorMessage(VOID_SUBJECT, error, VOID_ERRORS, `${VOID_SUBJECT}.`);
}
