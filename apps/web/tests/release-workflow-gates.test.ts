import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertExactRevision,
	assertMainCiEvidence,
	assertMatchingTree,
	assertPreviewEvent,
	assertPreviewEvidence,
	assertPreviewOrigin,
	assertProductionDispatch,
	assertRequiredEnv,
	previewGateVerdict,
	selectDeployHook,
	selectPreviewGate,
} from '../scripts/release-workflow-gates.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
process.env.VERCEL_PROJECT_NAME = 'manawg';
process.env.VERCEL_TEAM_SLUG = 'example-team';
const ORIGIN = 'https://manawg-abc123-example-team.vercel.app';

const goodRun = {
	id: 42,
	name: 'CI',
	path: '.github/workflows/ci.yml',
	event: 'push',
	head_branch: 'main',
	status: 'completed',
	conclusion: 'success',
	head_sha: SHA,
};
const passedJobs = (names: string[]) =>
	names.map((name) => ({ name, status: 'completed', conclusion: 'success' }));

test('preview origin accepts only the exact project origin', () => {
	assert.equal(assertPreviewOrigin(ORIGIN), ORIGIN);
	for (const bad of [
		'not a url',
		'http://manawg-abc-example-team.vercel.app',
		'https://app.manawg.com',
		'https://manawg-abc-example-team.vercel.app.evil.com',
		`${ORIGIN}/path`,
		`${ORIGIN}?x=1`,
		`${ORIGIN}:8443`,
		'https://user:pw@manawg-abc-example-team.vercel.app',
	]) {
		assert.throws(() => assertPreviewOrigin(bad), bad);
	}
	assert.throws(() => assertPreviewOrigin(ORIGIN, {}));
});

test('preview event must be a successful Vercel Preview deployment of main or an exact SHA', () => {
	const event = {
		state: 'success',
		deploymentRef: 'main',
		deploymentSha: SHA,
		environment: 'Preview',
		deploymentCreator: 'vercel[bot]',
		statusCreator: 'vercel[bot]',
		targetUrl: ORIGIN,
	};
	assert.equal(assertPreviewEvent(event), ORIGIN);
	assert.equal(assertPreviewEvent({ ...event, deploymentRef: SHA }), ORIGIN);
	assert.throws(() => assertPreviewEvent({ ...event, deploymentRef: 'feature' }));
	assert.throws(() => assertPreviewEvent({ ...event, deploymentRef: OTHER_SHA }));
	assert.throws(() => assertPreviewEvent({ ...event, state: 'failure' }));
	assert.throws(() => assertPreviewEvent({ ...event, environment: 'Production' }));
	assert.throws(() => assertPreviewEvent({ ...event, deploymentCreator: 'someone' }));
	assert.throws(() => assertPreviewEvent(undefined));
});

test('required env rejects missing and blank values', () => {
	assertRequiredEnv({ A: 'x', B: 'y' }, ['A', 'B'], 'Preview');
	assert.throws(() => assertRequiredEnv({ A: 'x', B: '  ' }, ['A', 'B'], 'Preview'), /B/);
	assert.throws(() => assertRequiredEnv(undefined, ['A'], 'Preview'), /A/);
});

test('revision and tree must be full SHAs that match', () => {
	assertExactRevision(SHA, SHA.toUpperCase());
	assert.throws(() => assertExactRevision('abc', SHA));
	assert.throws(() => assertExactRevision(SHA, OTHER_SHA));
	assertMatchingTree(SHA, SHA);
	assert.throws(() => assertMatchingTree(SHA, OTHER_SHA));
	assert.throws(() => assertMatchingTree('short', SHA));
});

test('production dispatch needs main, the exact confirmation and the exact revision', () => {
	const input = {
		workflowRef: 'refs/heads/main',
		candidateSha: SHA,
		checkedOutSha: SHA,
		confirmation: 'MIGRATE_PRODUCTION',
	};
	assertProductionDispatch(input);
	assert.throws(() => assertProductionDispatch({ ...input, workflowRef: 'refs/heads/feature' }));
	assert.throws(() => assertProductionDispatch({ ...input, confirmation: 'migrate_production' }));
	assert.throws(() => assertProductionDispatch({ ...input, checkedOutSha: OTHER_SHA }));
});

test('main CI evidence needs a green push run on main with both required jobs', () => {
	const jobs = passedJobs(['validate', 'e2e-fixtures']);
	assert.deepEqual(assertMainCiEvidence({ candidateSha: SHA, run: goodRun, jobs }), {
		ciRunId: 42,
		sourceRevision: SHA,
	});
	assert.throws(() =>
		assertMainCiEvidence({ candidateSha: SHA, run: { ...goodRun, event: 'pull_request' }, jobs }),
	);
	assert.throws(() =>
		assertMainCiEvidence({ candidateSha: SHA, run: { ...goodRun, head_branch: 'x' }, jobs }),
	);
	assert.throws(() =>
		assertMainCiEvidence({ candidateSha: SHA, run: { ...goodRun, head_sha: OTHER_SHA }, jobs }),
	);
	assert.throws(() =>
		assertMainCiEvidence({ candidateSha: SHA, run: goodRun, jobs: passedJobs(['validate']) }),
	);
	assert.throws(() =>
		assertMainCiEvidence({
			candidateSha: SHA,
			run: goodRun,
			jobs: [
				{ name: 'validate', status: 'completed', conclusion: 'success' },
				{ name: 'e2e-fixtures', status: 'completed', conclusion: 'failure' },
			],
		}),
	);
});

test('preview evidence needs the matching revision, tree, run id and both preview jobs', () => {
	const run = {
		...goodRun,
		name: 'Preview',
		path: '.github/workflows/preview.yml',
		event: 'deployment_status',
	};
	const base = {
		candidateSha: SHA,
		candidateTree: SHA,
		run,
		runTree: SHA,
		jobs: passedJobs(['db-supabase-preview', 'e2e-preview']),
		expectedRunId: undefined as number | undefined,
	};
	assert.deepEqual(assertPreviewEvidence({ ...base, expectedRunId: 42 }), {
		deploymentRunId: 42,
		sourceRevision: SHA,
	});
	assert.throws(() => assertPreviewEvidence({ ...base, expectedRunId: 7 }));
	assert.throws(() => assertPreviewEvidence({ ...base, runTree: OTHER_SHA }));
	assert.throws(() => assertPreviewEvidence({ ...base, candidateSha: OTHER_SHA }));
	assert.throws(() => assertPreviewEvidence({ ...base, run: { ...run, event: 'push' } }));
	// A run of the CI workflow is no Preview evidence, even with jobs of the same names.
	assert.throws(() => assertPreviewEvidence({ ...base, run: { ...run, name: 'CI' } }));
	assert.throws(() =>
		assertPreviewEvidence({ ...base, run: { ...run, path: '.github/workflows/ci.yml' } }),
	);
	assert.throws(() =>
		assertPreviewEvidence({ ...base, jobs: passedJobs(['db-supabase-preview']) }),
	);
});

test('preview evidence from the database gate is a green workflow_run migration check only', () => {
	const run = {
		...goodRun,
		name: 'Preview',
		path: '.github/workflows/preview.yml',
		event: 'workflow_run',
	};
	const base = {
		candidateSha: SHA,
		candidateTree: SHA,
		run,
		runTree: SHA,
		jobs: passedJobs(['db-supabase-preview']),
		expectedRunId: 42,
	};
	assert.deepEqual(assertPreviewEvidence({ ...base, gate: 'database' }), {
		deploymentRunId: 42,
		sourceRevision: SHA,
	});
	// The Vercel gate (the default) never accepts a run without a Preview deployment.
	assert.throws(() => assertPreviewEvidence(base));
	assert.throws(() => assertPreviewEvidence({ ...base, gate: 'vercel' }));
	assert.throws(() =>
		assertPreviewEvidence({ ...base, gate: 'database', run: { ...run, event: 'push' } }),
	);
	assert.throws(() => assertPreviewEvidence({ ...base, gate: 'database', jobs: [] }));
	assert.throws(() =>
		assertPreviewEvidence({ ...base, gate: 'database', candidateSha: OTHER_SHA }),
	);
	assert.throws(() => assertPreviewEvidence({ ...base, gate: 'pending' }));
});

test('preview gate is chosen explicitly by PREVIEW_GATE and fails closed', () => {
	const vercel = { VERCEL_PROJECT_NAME: 'manawg', VERCEL_TEAM_SLUG: 'example-team' };
	assert.equal(selectPreviewGate({ PREVIEW_GATE: 'on', ...vercel }), 'vercel');
	// A self-hosted instance opts in; set Vercel variables do not switch it back.
	assert.equal(selectPreviewGate({ PREVIEW_GATE: 'database' }), 'database');
	assert.equal(selectPreviewGate({ PREVIEW_GATE: 'database', ...vercel }), 'database');
	// `on` without the Vercel variables, or any other value, has no gate.
	assert.throws(() => selectPreviewGate({ PREVIEW_GATE: 'on' }), /PREVIEW_GATE/);
	assert.throws(() => selectPreviewGate({ PREVIEW_GATE: 'on', VERCEL_PROJECT_NAME: 'manawg' }));
	assert.throws(() => selectPreviewGate({ PREVIEW_GATE: 'off', ...vercel }));
	assert.throws(() => selectPreviewGate({}));
});

test('a misconfigured PREVIEW_GATE names the value it got and how to fix it', () => {
	// The error is all a failed release run shows, so it names the value and the fix.
	assert.throws(
		() => selectPreviewGate({ PREVIEW_GATE: 'on' }),
		/PREVIEW_GATE=on needs .*VERCEL_PROJECT_NAME.*VERCEL_TEAM_SLUG.*PREVIEW_GATE=database/,
	);
	// Case and stray spaces are not guessed at: a near miss fails and shows the exact value.
	for (const value of ['Database', ' database', 'database ', 'off', 'true']) {
		assert.throws(
			() => selectPreviewGate({ PREVIEW_GATE: value }),
			new RegExp(`PREVIEW_GATE is "${value}".*on.*database`),
		);
	}
	assert.throws(() => selectPreviewGate({}), /PREVIEW_GATE is not set.*on.*database/);
});

test('deploy hook: the database gate needs PRODUCTION_DEPLOY_HOOK, Vercel may fall back', () => {
	const both = { PRODUCTION_DEPLOY_HOOK: 'https://a', VERCEL_PRODUCTION_DEPLOY_HOOK: 'https://b' };
	assert.equal(selectDeployHook('database', both), 'PRODUCTION_DEPLOY_HOOK');
	assert.equal(selectDeployHook('vercel', both), 'PRODUCTION_DEPLOY_HOOK');
	assert.equal(
		selectDeployHook('vercel', { VERCEL_PRODUCTION_DEPLOY_HOOK: 'https://b' }),
		'VERCEL_PRODUCTION_DEPLOY_HOOK',
	);
	// Without Vercel Previews the Vercel hook is never used, so the release stops before migrating.
	assert.throws(
		() => selectDeployHook('database', { VERCEL_PRODUCTION_DEPLOY_HOOK: 'https://b' }),
		/PRODUCTION_DEPLOY_HOOK/,
	);
	assert.throws(() => selectDeployHook('database', { PRODUCTION_DEPLOY_HOOK: '  ' }));
	assert.throws(() => selectDeployHook('vercel', {}));
	assert.throws(() => selectDeployHook('pending', both));
});

// Preview runs as release-production.yml reads them: newest first, jobs of the latest attempt.
const dbJob = (status: string, conclusion: string | null, run_attempt = 1) => ({
	name: 'db-supabase-preview',
	status,
	conclusion,
	run_attempt,
});

test('preview gate decides on the newest Preview run only', () => {
	const olderFailed = { id: 101, jobs: [dbJob('completed', 'failure')] };
	assert.deepEqual(
		previewGateVerdict('database', [{ id: 202, jobs: [dbJob('in_progress', null)] }, olderFailed]),
		{ state: 'pending', runId: 202 },
	);
	assert.deepEqual(previewGateVerdict('database', [{ id: 202, jobs: [] }, olderFailed]), {
		state: 'pending',
		runId: 202,
	});
	assert.deepEqual(
		previewGateVerdict('database', [
			olderFailed,
			{ id: 202, jobs: [dbJob('completed', 'success')] },
		]),
		{ state: 'passed', runId: 202 },
	);
	assert.deepEqual(
		previewGateVerdict('database', [
			{ id: 202, jobs: [dbJob('completed', 'failure')] },
			{ id: 101, jobs: [dbJob('completed', 'success')] },
		]),
		{ state: 'failed', runId: 202 },
	);
	assert.deepEqual(previewGateVerdict('database', []), { state: 'pending' });
	assert.throws(() => previewGateVerdict('none' as 'database', []));
});

test('preview gate counts the latest attempt of a re-run', () => {
	const rerun = (status: string, conclusion: string | null) => [
		{ id: 202, jobs: [dbJob('completed', 'failure', 1), dbJob(status, conclusion, 2)] },
	];
	assert.deepEqual(previewGateVerdict('database', rerun('queued', null)), {
		state: 'pending',
		runId: 202,
	});
	assert.deepEqual(previewGateVerdict('database', rerun('completed', 'success')), {
		state: 'passed',
		runId: 202,
	});
});

test('vercel preview gate skips runs for non-success deployment statuses', () => {
	const job = (name: string, conclusion: string) => ({ name, status: 'completed', conclusion });
	const skipped = {
		id: 303,
		jobs: [job('db-supabase-preview', 'skipped'), job('e2e-preview', 'skipped')],
	};
	assert.deepEqual(
		previewGateVerdict('vercel', [
			skipped,
			{ id: 202, jobs: [job('db-supabase-preview', 'success'), job('e2e-preview', 'success')] },
		]),
		{ state: 'passed', runId: 202 },
	);
	assert.deepEqual(
		previewGateVerdict('vercel', [
			{ id: 202, jobs: [job('db-supabase-preview', 'success'), job('e2e-preview', 'skipped')] },
		]),
		{ state: 'failed', runId: 202 },
	);
	assert.deepEqual(
		previewGateVerdict('vercel', [{ id: 202, jobs: [job('db-supabase-preview', 'success')] }]),
		{ state: 'pending', runId: 202 },
	);
});

test('preview gate fails when the newest run failed before its required jobs', () => {
	const job = (name: string, conclusion: string) => ({ name, status: 'completed', conclusion });
	for (const gate of ['database', 'vercel'] as const) {
		assert.deepEqual(
			previewGateVerdict(gate, [
				{
					id: 202,
					jobs: [
						job('preview-source', 'failure'),
						job('db-supabase-preview', 'skipped'),
						job('e2e-preview', 'skipped'),
					],
				},
				{ id: 101, jobs: [job('db-supabase-preview', 'success'), job('e2e-preview', 'success')] },
			]),
			{ state: 'failed', runId: 202 },
		);
	}
});
