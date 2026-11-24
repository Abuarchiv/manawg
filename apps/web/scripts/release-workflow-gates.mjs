const SLUG = /^[a-z0-9-]+$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const CI_WORKFLOW_PATH = /^\.github\/workflows\/ci\.yml(?:@main)?$/;
const PREVIEW_WORKFLOW_PATH = /^\.github\/workflows\/preview\.yml(?:@main)?$/;

export const PREVIEW_AUTH_ENV_NAMES = Object.freeze([
	'SUPABASE_AUTH_TEST_EMAIL',
	'SUPABASE_AUTH_TEST_PASSWORD',
	'SUPABASE_AUTH_TEST_MEMBER_WG_CODE',
	'SUPABASE_AUTH_TEST_MEMBER_NAME',
]);

/** Vercel Preview hosts look like <project>-<hash>-<team>.vercel.app. */
function previewHost(env) {
	const project = env.VERCEL_PROJECT_NAME ?? '';
	const team = env.VERCEL_TEAM_SLUG ?? '';
	if (!SLUG.test(project) || !SLUG.test(team)) {
		throw new Error('Set VERCEL_PROJECT_NAME and VERCEL_TEAM_SLUG to check Preview origins.');
	}
	return new RegExp(`^${project}-[a-z0-9-]+-${team}\\.vercel\\.app$`, 'i');
}

/**
 * @param {string} value
 * @param {Record<string, string | undefined>} [env]
 */
export function assertPreviewOrigin(value, env = process.env) {
	const host = previewHost(env);
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Preview target must be a valid URL.');
	}

	if (
		url.protocol !== 'https:' ||
		!host.test(url.hostname) ||
		url.username ||
		url.password ||
		url.port ||
		url.pathname !== '/' ||
		url.search ||
		url.hash ||
		url.origin !== value
	) {
		throw new Error("Preview target must exactly match this project's canonical Vercel origin.");
	}

	return url.origin;
}

export function assertPreviewEvent(event) {
	const deploymentRef = event?.deploymentRef;
	const deploymentSha = event?.deploymentSha;
	const deploymentRefIsTrusted =
		deploymentRef === 'main' ||
		(typeof deploymentRef === 'string' &&
			typeof deploymentSha === 'string' &&
			FULL_SHA.test(deploymentRef) &&
			deploymentRef.toLowerCase() === deploymentSha.toLowerCase());
	if (
		event?.state !== 'success' ||
		!deploymentRefIsTrusted ||
		event.environment !== 'Preview' ||
		event.deploymentCreator !== 'vercel[bot]' ||
		event.statusCreator !== 'vercel[bot]'
	) {
		throw new Error(
			'Preview deployment event is not a trusted successful Vercel Preview deployment.',
		);
	}

	return assertPreviewOrigin(event.targetUrl);
}

export function assertRequiredEnv(values, names, label) {
	const missing = names.filter(
		(name) => typeof values?.[name] !== 'string' || values[name].trim().length === 0,
	);
	if (missing.length > 0) {
		throw new Error(`${label} requires ${missing.join(', ')}.`);
	}
}

export function assertExactRevision(candidateSha, checkedOutSha) {
	if (typeof candidateSha !== 'string' || !FULL_SHA.test(candidateSha)) {
		throw new Error('Candidate SHA must be a full 40-character commit SHA.');
	}
	if (typeof checkedOutSha !== 'string' || !FULL_SHA.test(checkedOutSha)) {
		throw new Error('Checked-out revision must be a full 40-character commit SHA.');
	}
	if (candidateSha.toLowerCase() !== checkedOutSha.toLowerCase()) {
		throw new Error('Candidate SHA does not match the checked-out main revision.');
	}
}

export function assertMatchingTree(candidateTree, checkedOutTree) {
	if (typeof candidateTree !== 'string' || !FULL_SHA.test(candidateTree)) {
		throw new Error('Candidate tree must be full 40-character tree SHA.');
	}
	if (typeof checkedOutTree !== 'string' || !FULL_SHA.test(checkedOutTree)) {
		throw new Error('Checked-out tree must be full 40-character tree SHA.');
	}
	if (candidateTree.toLowerCase() !== checkedOutTree.toLowerCase()) {
		throw new Error('Preview deployment tree does not match checked-out trusted main tree.');
	}
}

export function assertProductionDispatch({
	workflowRef,
	candidateSha,
	checkedOutSha,
	confirmation,
}) {
	if (workflowRef !== 'refs/heads/main') {
		throw new Error('Production migration must be dispatched from main.');
	}
	if (confirmation !== 'MIGRATE_PRODUCTION') {
		throw new Error('Production migration requires the exact MIGRATE_PRODUCTION confirmation.');
	}
	assertExactRevision(candidateSha, checkedOutSha);
}

export function assertMainCiEvidence({ candidateSha, run, jobs }) {
	assertExactRevision(candidateSha, candidateSha);
	if (
		run?.name !== 'CI' ||
		!CI_WORKFLOW_PATH.test(run.path ?? '') ||
		run.event !== 'push' ||
		run.head_branch !== 'main' ||
		run.status !== 'completed' ||
		run.conclusion !== 'success' ||
		!Number.isInteger(run.id) ||
		run.id <= 0 ||
		typeof run.head_sha !== 'string' ||
		!FULL_SHA.test(run.head_sha) ||
		run.head_sha.toLowerCase() !== candidateSha.toLowerCase()
	) {
		throw new Error(
			'Main CI evidence must be a completed successful push run for the exact candidate SHA on main.',
		);
	}

	if (!Array.isArray(jobs)) {
		throw new Error('Main CI evidence must include the required successful workflow jobs.');
	}
	for (const requiredJob of ['validate', 'e2e-fixtures']) {
		const job = jobs.find((candidate) => candidate?.name === requiredJob);
		if (job?.status !== 'completed' || job.conclusion !== 'success') {
			throw new Error(`Main CI evidence is missing a successful ${requiredJob} job.`);
		}
	}

	return { ciRunId: run.id, sourceRevision: run.head_sha };
}

/**
 * Which Preview gate a release candidate must pass, set by the repository variable PREVIEW_GATE:
 * - `on` → `vercel`: Vercel deploys a Preview of the commit, and the `deployment_status` run of
 *   preview.yml (migration check and end-to-end tests) is the gate. Needs VERCEL_PROJECT_NAME and
 *   VERCEL_TEAM_SLUG.
 * - `database` → `database`: no Vercel Preview (self-hosted production). The gate is the Preview
 *   database migration check that preview.yml runs after main CI (`workflow_run`).
 * Anything else has no gate and throws, so a misconfiguration stops the release.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {'vercel' | 'database'}
 */
export function selectPreviewGate(env) {
	const value = env?.PREVIEW_GATE;
	if (value === 'database') return 'database';
	if (value === 'on') {
		if (env.VERCEL_PROJECT_NAME && env.VERCEL_TEAM_SLUG) return 'vercel';
		throw new Error(
			'PREVIEW_GATE=on needs the repository variables VERCEL_PROJECT_NAME and VERCEL_TEAM_SLUG. Without a Vercel Preview, set PREVIEW_GATE=database.',
		);
	}
	const got = value ? `is "${value}"` : 'is not set';
	throw new Error(
		`The repository variable PREVIEW_GATE ${got}. Set it to on (Vercel Preview) or database (no Vercel Preview, self-hosted production).`,
	);
}

/**
 * Name of the secret whose URL deploys production. PRODUCTION_DEPLOY_HOOK always wins. The
 * Vercel hook is only a fallback for the Vercel gate: without Vercel Previews, Vercel does not
 * serve production either, so a release must not migrate and then call it.
 *
 * @param {string} gate result of selectPreviewGate
 * @param {Record<string, string | undefined>} secrets
 * @returns {'PRODUCTION_DEPLOY_HOOK' | 'VERCEL_PRODUCTION_DEPLOY_HOOK'}
 */
export function selectDeployHook(gate, secrets) {
	const set = (name) => typeof secrets?.[name] === 'string' && secrets[name].trim() !== '';
	if (gate !== 'vercel' && gate !== 'database') {
		throw new Error(`Unknown Preview gate: ${gate}.`);
	}
	if (set('PRODUCTION_DEPLOY_HOOK')) return 'PRODUCTION_DEPLOY_HOOK';
	if (gate === 'vercel' && set('VERCEL_PRODUCTION_DEPLOY_HOOK')) {
		return 'VERCEL_PRODUCTION_DEPLOY_HOOK';
	}
	throw new Error(
		gate === 'database'
			? 'PREVIEW_GATE=database needs the Production secret PRODUCTION_DEPLOY_HOOK.'
			: 'Production secret PRODUCTION_DEPLOY_HOOK or VERCEL_PRODUCTION_DEPLOY_HOOK is missing.',
	);
}

/** Required Preview workflow event and jobs per gate. */
const PREVIEW_GATES = {
	vercel: { event: 'deployment_status', jobs: ['db-supabase-preview', 'e2e-preview'] },
	database: { event: 'workflow_run', jobs: ['db-supabase-preview'] },
};

export function assertPreviewEvidence({
	candidateSha,
	candidateTree,
	run,
	runTree,
	jobs,
	expectedRunId,
	gate = 'vercel',
}) {
	const required = Object.hasOwn(PREVIEW_GATES, gate) ? PREVIEW_GATES[gate] : undefined;
	if (!required) {
		throw new Error(`Unknown Preview gate: ${gate}.`);
	}
	if (
		run?.name !== 'Preview' ||
		!PREVIEW_WORKFLOW_PATH.test(run.path ?? '') ||
		run.event !== required.event ||
		run.status !== 'completed' ||
		run.conclusion !== 'success' ||
		!Number.isInteger(run.id) ||
		run.id <= 0
	) {
		throw new Error(
			`Preview evidence must be a completed successful ${required.event} run of the Preview workflow.`,
		);
	}
	if (expectedRunId !== undefined && run.id !== expectedRunId) {
		throw new Error('Preview evidence run ID does not match the requested run.');
	}
	assertExactRevision(candidateSha, run.head_sha);
	assertMatchingTree(candidateTree, runTree);

	for (const requiredJob of required.jobs) {
		const job = jobs?.find((candidate) => candidate?.name === requiredJob);
		if (job?.status !== 'completed' || job.conclusion !== 'success') {
			throw new Error(`Preview evidence is missing a successful ${requiredJob} job.`);
		}
	}

	return { deploymentRunId: run.id, sourceRevision: run.head_sha };
}

/**
 * Verdict of the release Preview gate from the Preview workflow runs for the candidate SHA. Only
 * the newest run (highest run ID) whose required jobs did not all skip decides, and only its
 * latest attempt: an older failed run never aborts the release while a newer run is pending, and
 * an older success never passes it after a newer run failed. Runs for non-success Vercel
 * deployment statuses skip every required job and are ignored, unless a job of that run failed
 * (such as preview-source), which fails the gate.
 *
 * @param {string} gate result of selectPreviewGate
 * @param {{ id: number, jobs: { name: string, status: string, conclusion: string | null, run_attempt?: number }[] }[]} runs
 * @returns {{ state: 'passed' | 'failed' | 'pending', runId?: number }}
 */
export function previewGateVerdict(gate, runs) {
	const required = Object.hasOwn(PREVIEW_GATES, gate) ? PREVIEW_GATES[gate] : undefined;
	if (!required) {
		throw new Error(`Unknown Preview gate: ${gate}.`);
	}
	const failed = (job) =>
		job.status === 'completed' && !['success', 'skipped'].includes(job.conclusion);
	for (const run of [...runs].sort((a, b) => b.id - a.id)) {
		const attempt = Math.max(0, ...run.jobs.map((job) => job.run_attempt ?? 0));
		const latest = run.jobs.filter((job) => (job.run_attempt ?? 0) === attempt);
		const jobs = latest.filter((job) => required.jobs.includes(job.name));
		const done = (name) => jobs.find((job) => job.name === name && job.status === 'completed');
		if (required.jobs.every((name) => done(name)?.conclusion === 'success')) {
			return { state: 'passed', runId: run.id };
		}
		// A failed job (preview-source too) decides even when it made the required jobs skip.
		if (latest.some(failed)) return { state: 'failed', runId: run.id };
		if (jobs.length > 0 && jobs.every((job) => job.conclusion === 'skipped')) continue;
		if (required.jobs.every(done)) return { state: 'failed', runId: run.id };
		return { state: 'pending', runId: run.id };
	}
	return { state: 'pending' };
}
