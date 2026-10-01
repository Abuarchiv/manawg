export interface ShoppingItem {
	id: string;
	addedByMemberId: string;
	name: string;
	quantity: string | null;
	boughtAt: string | null;
	boughtByMemberId: string | null;
	createdAt: string;
	updatedAt?: string;
}
