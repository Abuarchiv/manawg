/**
 * Pure normalizers that make catalog output (`pg_get_constraintdef`, `pg_get_indexdef`,
 * `format_type`, ...) comparable with the SQL fragments stored in drizzle-kit snapshots.
 */

export const normalizeSql = (value) =>
	String(value ?? '')
		.toLowerCase()
		.replace(/"([^"\n]+)"/g, '$1')
		// Casts end at the type name; multi-word types are spelled out, so a following AND/OR survives.
		.replace(/::[a-z_]+(?: with(?:out)? time zone| varying| precision)?(?:\[\])?/g, '')
		.replace(/\s+/g, '');

export const normalizeType = (type) => normalizeSql(type).replace('charactervarying', 'varchar');
export const normalizeDefault = (value) => normalizeSql(value).replace(/^\((.*)\)$/, '$1');
export const normalizeCheck = (value, tableName) =>
	normalizeSql(value)
		.replace(/notvalid/g, '')
		.replace(/^check\((.*)\)$/, '$1')
		.replaceAll(`${tableName}.`, '')
		.replace(/(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)in\(([^)]*)\)/g, '$1=any(array[$2])')
		.replace(/[()]/g, '');
export const sameColumns = (actual, expected) => actual?.join('\u0000') === expected.join('\u0000');
export const foreignKeyAction = {
	a: 'no action',
	r: 'restrict',
	c: 'cascade',
	n: 'set null',
	d: 'set default',
};
export const normalizeIndexPart = (value) =>
	String(value ?? '')
		.toLowerCase()
		.replace(/"([^"\n]+)"/g, '$1')
		.replace(/(?:public\.)?[a-z_][a-z0-9_]*\./g, '')
		.replace(/[()]/g, '')
		.replace(/\s+/g, '')
		.replace(/nullslast/g, '');
export const expectedIndexKeys = (index) =>
	index.columns.map(({ expression, asc, nulls }) =>
		normalizeIndexPart(
			`${expression}${asc ? '' : ' DESC'}${nulls === 'first' ? ' NULLS FIRST' : ''}`,
		),
	);
