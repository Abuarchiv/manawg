/**
 * Stored receipt photo links are absolute URLs on the origin that was configured when they were
 * written. After APP_URL changes, the strict origin check on edits rejects them, so setup moves
 * them onto the current origin. Links to other hosts and links already on the origin stay as they
 * are.
 */

// Fixed list of tables with an image_url column, never built from input.
const IMAGE_TABLES = ['expenses', 'announcements', 'wg_chat_messages'];

/** Returns the number of rewritten rows per table. */
export async function rewriteImageOrigins(client, origin) {
	/** @type {Record<string, number>} */
	const counts = {};
	await client.query('begin');
	try {
		for (const table of IMAGE_TABLES) {
			const result = await client.query(
				`update ${table}
				 set image_url = $1::text || substring(image_url from '/api/upload/read\\?key=.*$')
				 where image_url ~ '^https?://[^/]+/api/upload/read\\?key='
				   and not starts_with(image_url, $1::text || '/')`,
				[origin],
			);
			counts[table] = result.rowCount ?? 0;
		}
		await client.query('commit');
	} catch (err) {
		await client.query('rollback');
		throw err;
	}
	return counts;
}
