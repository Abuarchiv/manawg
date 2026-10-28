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
	const run = { ...goodRun, event: 'deployment_status' };
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
	assert.throws(() =>
		assertPreviewEvidence({ ...base, jobs: passedJobs(['db-supabase-preview']) }),
	);
});
