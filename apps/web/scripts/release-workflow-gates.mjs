const PREVIEW_HOST = /^manawg-[a-z0-9-]+-applications-projects\.vercel\.app$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const CI_WORKFLOW_PATH = /^\.github\/workflows\/ci\.yml(?:@main)?$/;

export const PREVIEW_AUTH_ENV_NAMES = Object.freeze([
	'SUPABASE_AUTH_TEST_EMAIL',
	'SUPABASE_AUTH_TEST_PASSWORD',
	'SUPABASE_AUTH_TEST_MEMBER_WG_CODE',
	'SUPABASE_AUTH_TEST_MEMBER_NAME',
]);

export function assertPreviewOrigin(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Preview target must be a valid URL.');
	}

	if (
		url.protocol !== 'https:' ||
		!PREVIEW_HOST.test(url.hostname) ||
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
		!event ||
		event.state !== 'success' ||
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

export function assertPreviewEvidence({
	candidateSha,
	candidateTree,
	run,
	runTree,
	jobs,
	expectedRunId,
}) {
	if (
		!run ||
		run.name !== 'CI' ||
		!CI_WORKFLOW_PATH.test(run.path ?? '') ||
		run.event !== 'deployment_status' ||
		run.status !== 'completed' ||
		run.conclusion !== 'success' ||
		!Number.isInteger(run.id) ||
		run.id <= 0
	) {
		throw new Error('Preview evidence must be a completed successful CI deployment-status run.');
	}
	if (expectedRunId !== undefined && run.id !== expectedRunId) {
		throw new Error('Preview evidence run ID does not match the requested run.');
	}
	assertExactRevision(candidateSha, candidateSha);
	assertExactRevision(run.head_sha, run.head_sha);
	assertMatchingTree(candidateTree, runTree);

	for (const requiredJob of ['db-supabase-preview', 'e2e-preview']) {
		const job = jobs?.find((candidate) => candidate?.name === requiredJob);
		if (!job || job.status !== 'completed' || job.conclusion !== 'success') {
			throw new Error(`Preview evidence is missing a successful ${requiredJob} job.`);
		}
	}

	return { deploymentRunId: run.id, sourceRevision: run.head_sha };
}
