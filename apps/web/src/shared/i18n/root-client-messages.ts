type Tree = { [key: string]: string | Tree };

/**
 * Message paths the root client provider carries for the public pages (landing, login, signup,
 * invite, offline, auth) and the shared chrome. The /wg segment brings its own full provider.
 */
export const ROOT_CLIENT_NAMESPACES = [
	'common',
	'entry',
	'auth',
	'offline',
	'shell',
	'settings.profile',
	'settings.accountDelete',
	'settings.actions',
] as const;

/** Copies the given dotted paths out of `messages`; a nested path keeps only that branch of its parent. */
export function pickMessages(messages: Tree, paths: readonly string[]): Tree {
	const picked: Tree = {};
	for (const path of paths) {
		const keys = path.split('.');
		const leaf = keys.pop() as string;
		let from = messages;
		let to = picked;
		for (const key of keys) {
			from = from[key] as Tree;
			to[key] ??= {};
			to = to[key] as Tree;
		}
		to[leaf] = from[leaf] as string | Tree;
	}
	return picked;
}
