/**
 * Checks that the Supabase API roles (anon, authenticated) cannot reach application data: RLS on
 * every table, no effective grants, no policies, views or callable functions in `public`, and the
 * member/WG invariant functions and triggers bound exactly as catalog-contract.mjs describes.
 */

import {
	ALLOWED_SECURITY_DEFINER_FUNCTIONS,
	MEMBER_WG_INVARIANT_FUNCTIONS,
	MEMBER_WG_INVARIANT_TRIGGERS,
	PUBLIC_ROLES,
	PUBLIC_SCHEMA,
} from './catalog-contract.mjs';

export async function assertCatalogSecurity(client, expectedTables) {
	const roleResult = await client.query(
		'select rolname from pg_roles where rolname = any($1::name[])',
		[PUBLIC_ROLES],
	);
	const presentRoles = new Set(roleResult.rows.map(({ rolname }) => rolname));
	const missingRoles = PUBLIC_ROLES.filter((role) => !presentRoles.has(role));
	if (missingRoles.length) {
		throw new Error(
			`Database check failed: required Supabase roles are missing: ${missingRoles.join(', ')}.`,
		);
	}
	const { rows: schemaCreatePrivileges } = await client.query(
		// has_schema_privilege includes effective grants inherited from PUBLIC and role memberships.
		`select grantee.rolname as role_name
		 from pg_roles grantee cross join pg_namespace ns
		 where grantee.rolname = any($1::name[])
		   and ns.nspname = $2
		   and has_schema_privilege(grantee.oid, ns.oid, 'CREATE')`,
		[PUBLIC_ROLES, PUBLIC_SCHEMA],
	);
	const schemaCreateRoles = PUBLIC_ROLES.filter((role) =>
		schemaCreatePrivileges.some(({ role_name }) => role_name === role),
	);
	if (schemaCreateRoles.length) {
		throw new Error(
			`Database check failed: public schema CREATE privilege must be empty for anon/authenticated roles; granted effectively to ${schemaCreateRoles.join(', ')}.`,
		);
	}

	const expectedTableNames = expectedTables.map(({ table }) => table);
	const { rows: rlsRows } = await client.query(
		`select rel.relname as table_name, rel.relrowsecurity as rls_enabled
		 from pg_class rel
		 join pg_namespace ns on ns.oid = rel.relnamespace
		 where ns.nspname = $1 and rel.relname = any($2::name[]) and rel.relkind in ('r', 'p')`,
		[PUBLIC_SCHEMA, expectedTableNames],
	);
	const rlsByTable = new Map(rlsRows.map((row) => [row.table_name, row.rls_enabled]));
	const rlsMismatches = expectedTableNames
		.filter((table) => rlsByTable.get(table) !== true)
		.map((table) => `public.${table}${rlsByTable.has(table) ? ' RLS disabled' : ' table missing'}`);
	if (rlsMismatches.length) {
		throw new Error(
			`Database check failed: RLS requirements not met: ${rlsMismatches.join(', ')}.`,
		);
	}

	const { rows: tablePrivileges } = await client.query(
		`select role_name, object_name, privileges
		 from (
			select grantee.rolname as role_name, rel.relname as object_name,
				array(
					select privilege_values.privilege_name
					from unnest($2::text[]) as privilege_values(privilege_name)
					where has_table_privilege(grantee.rolname, rel.oid, privilege_values.privilege_name)
				) as privileges
			from pg_roles grantee
			cross join pg_class rel
			join pg_namespace ns on ns.oid = rel.relnamespace
			where grantee.rolname = any($1::name[]) and ns.nspname = $3 and rel.relkind in ('r', 'p')
		 ) grants
		 where cardinality(privileges) > 0`,
		[
			PUBLIC_ROLES,
			['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
			PUBLIC_SCHEMA,
		],
	);
	const { rows: sequencePrivileges } = await client.query(
		`select role_name, object_name, privileges
		 from (
			select grantee.rolname as role_name, rel.relname as object_name,
				array(
					select privilege_values.privilege_name
					from unnest($2::text[]) as privilege_values(privilege_name)
					where has_sequence_privilege(grantee.rolname, rel.oid, privilege_values.privilege_name)
				) as privileges
			from pg_roles grantee
			cross join pg_class rel
			join pg_namespace ns on ns.oid = rel.relnamespace
			where grantee.rolname = any($1::name[]) and ns.nspname = $3 and rel.relkind = 'S'
		 ) grants
		 where cardinality(privileges) > 0`,
		[PUBLIC_ROLES, ['USAGE', 'SELECT', 'UPDATE'], PUBLIC_SCHEMA],
	);
	const { rows: functionPrivileges } = await client.query(
		`select role_name, object_name, privileges
		 from (
			select grantee.rolname as role_name,
				format('%s(%s)', proc.proname, pg_get_function_identity_arguments(proc.oid)) as object_name,
				array(
					select privilege_values.privilege_name
					from unnest($2::text[]) as privilege_values(privilege_name)
					where has_function_privilege(grantee.rolname, proc.oid, privilege_values.privilege_name)
				) as privileges
			from pg_roles grantee
			cross join pg_proc proc
			join pg_namespace ns on ns.oid = proc.pronamespace
			where grantee.rolname = any($1::name[]) and ns.nspname = $3
		 ) grants
		 where cardinality(privileges) > 0`,
		[PUBLIC_ROLES, ['EXECUTE'], PUBLIC_SCHEMA],
	);
	const privilegeMismatches = [
		...tablePrivileges.map(
			({ role_name, object_name, privileges }) =>
				`${role_name} has ${privileges.join(', ')} on public table ${object_name}`,
		),
		...sequencePrivileges.map(
			({ role_name, object_name, privileges }) =>
				`${role_name} has ${privileges.join(', ')} on public sequence ${object_name}`,
		),
		...functionPrivileges.map(
			({ role_name, object_name, privileges }) =>
				`${role_name} has ${privileges.join(', ')} on public function ${object_name}`,
		),
	];
	if (privilegeMismatches.length) {
		throw new Error(
			`Database check failed: public role privileges must be empty: ${privilegeMismatches.join('; ')}.`,
		);
	}

	const { rows: policies } = await client.query(
		'select policyname, tablename from pg_policies where schemaname = $1',
		[PUBLIC_SCHEMA],
	);
	const { rows: views } = await client.query(
		`select relname as object_name, case relkind when 'v' then 'view' when 'm' then 'materialized view' end as object_type
		 from pg_class rel join pg_namespace ns on ns.oid = rel.relnamespace
		 where ns.nspname = $1 and rel.relkind in ('v', 'm')`,
		[PUBLIC_SCHEMA],
	);
	const { rows: securityDefiners } = await client.query(
		`select proc.proname as object_name, pg_get_function_identity_arguments(proc.oid) as arguments
		 from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
		 where ns.nspname = $1 and proc.prosecdef`,
		[PUBLIC_SCHEMA],
	);
	const { rows: executablePublicFunctions } = await client.query(
		`select proc.proname as object_name, pg_get_function_identity_arguments(proc.oid) as arguments
		 from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
		 where ns.nspname = $1
		   and (proc.proacl is null or exists (
			 select 1 from aclexplode(proc.proacl) privilege
			 where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
		   ))`,
		[PUBLIC_SCHEMA],
	);
	const { rows: invariantFunctions } = await client.query(
		`select proc.proname as object_name,
				proc.prosecdef as security_definer,
				coalesce(proc.proconfig, array[]::text[]) as config
		 from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
		 where ns.nspname = $1 and proc.proname = any($2::name[])`,
		[PUBLIC_SCHEMA, MEMBER_WG_INVARIANT_FUNCTIONS],
	);
	const invariantByName = new Map(
		invariantFunctions.map((functionRow) => [functionRow.object_name, functionRow]),
	);
	const invariantMismatches = MEMBER_WG_INVARIANT_FUNCTIONS.flatMap((name) => {
		const functionRow = invariantByName.get(name);
		if (!functionRow) return [`missing public invariant function ${name}()`];
		const mismatches = [];
		if (functionRow.security_definer !== true) {
			mismatches.push(`public invariant function ${name}() is not SECURITY DEFINER`);
		}
		if (!functionRow.config.includes('search_path=public')) {
			mismatches.push(`public invariant function ${name}() has an unsafe search_path`);
		}
		return mismatches;
	});
	const { rows: invariantTriggers } = await client.query(
		`select rel.relname as table_name, trg.tgname as trigger_name,
			function_ns.nspname as function_schema, proc.proname as function_name,
			trg.tgenabled as trigger_enabled, trg.tgtype as trigger_type,
			trg.tgqual is not null as has_when, trg.tgattr::text as update_columns,
			encode(trg.tgargs, 'hex') as arguments_hex
		 from pg_trigger trg
		 join pg_class rel on rel.oid = trg.tgrelid
		 join pg_namespace table_ns on table_ns.oid = rel.relnamespace
		 join pg_proc proc on proc.oid = trg.tgfoid
		 join pg_namespace function_ns on function_ns.oid = proc.pronamespace
		 where table_ns.nspname = $1
		   and trg.tgname = any($2::name[])
		   and not trg.tgisinternal`,
		[PUBLIC_SCHEMA, MEMBER_WG_INVARIANT_TRIGGERS.map(({ trigger_name }) => trigger_name)],
	);
	const triggersByName = new Map();
	for (const trigger of invariantTriggers) {
		const matches = triggersByName.get(trigger.trigger_name) ?? [];
		matches.push(trigger);
		triggersByName.set(trigger.trigger_name, matches);
	}
	const triggerMismatches = MEMBER_WG_INVARIANT_TRIGGERS.flatMap((expected) => {
		const actual = triggersByName.get(expected.trigger_name) ?? [];
		if (actual.length === 0) {
			return [`missing public.${expected.table_name}.${expected.trigger_name} trigger`];
		}
		if (actual.length > 1) {
			return [`public trigger ${expected.trigger_name} has multiple catalog bindings`];
		}
		const [trigger] = actual;
		const mismatches = [];
		if (
			trigger.table_name !== expected.table_name ||
			trigger.function_schema !== PUBLIC_SCHEMA ||
			trigger.function_name !== expected.function_name
		) {
			mismatches.push(
				`public trigger ${expected.trigger_name} is bound to ${trigger.function_schema}.${trigger.table_name} -> ${trigger.function_name}; expected public.${expected.table_name} -> public.${expected.function_name}`,
			);
		}
		// O fires in normal origin sessions; A fires in every session. R and D do not.
		if (!['O', 'A'].includes(trigger.trigger_enabled)) {
			mismatches.push(
				`public trigger ${expected.trigger_name} is not enabled for normal sessions (state ${trigger.trigger_enabled})`,
			);
		}
		const expectedArguments = Buffer.from(expected.args.map((arg) => `${arg}\0`).join('')).toString(
			'hex',
		);
		if (
			trigger.trigger_type !== 23 || // ROW + BEFORE + INSERT + UPDATE
			trigger.has_when !== false ||
			trigger.update_columns !== '' ||
			trigger.arguments_hex !== expectedArguments
		) {
			mismatches.push(
				`public trigger ${expected.trigger_name} does not cover every inserted or updated row with the expected member columns`,
			);
		}
		return mismatches;
	});
	if (triggerMismatches.length) {
		throw new Error(
			`Database check failed: member/WG invariant trigger requirements not met: ${triggerMismatches.join('; ')}.`,
		);
	}
	const catalogMismatches = [
		...invariantMismatches,
		...policies.map(({ policyname, tablename }) => `public policy ${policyname} on ${tablename}`),
		...views.map(({ object_name, object_type }) => `public ${object_type} ${object_name}`),
		...securityDefiners
			.filter(({ object_name }) => !ALLOWED_SECURITY_DEFINER_FUNCTIONS.has(object_name))
			.map(
				({ object_name, arguments: args }) =>
					`public SECURITY DEFINER function ${object_name}(${args})`,
			),
		...executablePublicFunctions.map(
			({ object_name, arguments: args }) => `executable public function ${object_name}(${args})`,
		),
	];
	if (catalogMismatches.length) {
		throw new Error(
			`Database check failed: forbidden public catalog objects: ${catalogMismatches.join('; ')}.`,
		);
	}
}
