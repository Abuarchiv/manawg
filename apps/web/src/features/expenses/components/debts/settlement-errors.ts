/** Copy for a failed manual settlement (`POST /expenses/settle-batch`). */
export function settlementErrorMessage(error: string): string {
	if (error === 'settlement_changed')
		return 'Die offenen Beträge haben sich geändert. Prüfe die Zahlung erneut, bevor du sie einträgst.';
	if (error === 'settlement_review_required')
		return 'Prüfe zuerst die betroffenen Ausgaben und den Betrag.';
	if (error === 'unexpected_error' || error === 'server_error' || error === 'db_error') {
		return 'Ausgleich konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Ausgleich konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Ausgleich konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Ausgleich konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (error === 'not_a_member' || error === 'member_id_required' || error === 'member_id_invalid') {
		return 'Ausgleich konnte nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (error === 'member_not_in_wg') {
		return 'Ausgleich konnte nicht gespeichert werden: Mindestens ein Mitglied ist nicht mehr in dieser WG.';
	}
	if (error === 'not_party_to_debt') {
		return 'Ausgleich konnte nicht gespeichert werden: Du bist an dieser Schuld nicht beteiligt.';
	}
	if (error === 'same_member' || error === 'member_ids_invalid' || error === 'invalid_json') {
		return 'Ausgleich konnte nicht gespeichert werden: Die Anfrage war ungültig.';
	}
	if (error === 'paypal_payment_pending')
		return 'Eine PayPal-Zahlung läuft noch. Warte auf deren Abschluss.';
	return 'Ausgleich konnte nicht gespeichert werden.';
}
