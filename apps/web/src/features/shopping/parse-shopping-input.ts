import { QUANTITY_MAX } from './components/constants';

// "2 Hafermilch", "1,5 L Milch", "3x Brot": leading amount (optional unit) then the name.
// Names that merely start with a digit ("7Up") stay whole because a space must follow.
const QUANTITY_PREFIX =
	/^(\d+(?:[.,]\d+)?\s*(?:x|×|stk\.?|stück|l|liter|ml|g|kg|packungen|packung|pck\.?|dosen|dose|flaschen|flasche|rollen|rolle)?)\s+(\S.*)$/i;

export function parseShoppingInput(text: string): { name: string; quantity: string | null } {
	const value = text.trim();
	const match = QUANTITY_PREFIX.exec(value);
	if (!match?.[1] || !match[2]) return { name: value, quantity: null };
	const quantity = match[1].replace(/\s+/g, ' ').trim();
	// A digit run longer than the server limit is a name, not an amount (else 400 quantity_invalid).
	if (quantity.length > QUANTITY_MAX) return { name: value, quantity: null };
	return { name: match[2].trim(), quantity };
}
