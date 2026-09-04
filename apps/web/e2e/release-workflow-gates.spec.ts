import { expect, test } from '@playwright/test';
import {
	PREVIEW_AUTH_ENV_NAMES,
	assertExactRevision,
	assertPreviewEvent,
	assertPreviewEvidence,
	assertProductionDispatch,
	assertRequiredEnv,
} from '../scripts/release-workflow-gates.mjs';

const SHA = 'a'.repeat(40);

const validPreviewEvent = {
	state: 'success',
	deploymentRef: SHA,
	deploymentSha: SHA,
	environment: 'Preview',
	deploymentCreator: 'vercel[bot]',
	statusCreator: 'vercel[bot]',
	targetUrl: 'https://manawg-feature-abditubes-projects.vercel.app',
};

const validPreviewRun = {
	id: 123,
	name: 'CI',
	path: '.github/workflows/ci.yml',
	event: 'deployment_status',
	status: 'completed',
	conclusion: 'success',
	head_sha: SHA,
};

const validPreviewJobs = [
	{ name: 'db-supabase-preview', status: 'completed', conclusion: 'success' },
	{ name: 'e2e-preview', status: 'completed', conclusion: 'success' },
];

test('accepts a trusted successful Preview event and returns its origin', () => {
	expect(assertPreviewEvent(validPreviewEvent)).toBe(validPreviewEvent.targetUrl);
});

test('rejects untrusted Preview actors, refs, and URL shapes', () => {
	for (const invalid of [
		{ ...validPreviewEvent, deploymentCreator: 'someone-else' },
		{ ...validPreviewEvent, deploymentRef: 'main', deploymentCreator: 'Abuarchiv' },
		{ ...validPreviewEvent, deploymentRef: 'feature' },
		{ ...validPreviewEvent, deploymentRef: 'b'.repeat(40) },
		{ ...validPreviewEvent, targetUrl: `${validPreviewEvent.targetUrl}/private` },
		{ ...validPreviewEvent, targetUrl: `${validPreviewEvent.targetUrl}?token=hidden` },
		{ ...validPreviewEvent, targetUrl: `${validPreviewEvent.targetUrl}#fragment` },
		{
			...validPreviewEvent,
			targetUrl: 'https://user:password@manawg-feature-abditubes-projects.vercel.app',
		},
		{ ...validPreviewEvent, targetUrl: 'https://manawg-feature-abditubes-projects.vercel.app:443' },
		{ ...validPreviewEvent, targetUrl: 'https://evil.example.test' },
	]) {
		expect(() => assertPreviewEvent(invalid)).toThrow();
	}
});

test('requires every protected Preview auth variable without exposing values', () => {
	expect(PREVIEW_AUTH_ENV_NAMES).toEqual([
		'SUPABASE_AUTH_TEST_EMAIL',
		'SUPABASE_AUTH_TEST_PASSWORD',
		'SUPABASE_AUTH_TEST_MEMBER_WG_CODE',
		'SUPABASE_AUTH_TEST_MEMBER_NAME',
	]);

	const values = Object.fromEntries(PREVIEW_AUTH_ENV_NAMES.map((name) => [name, 'present']));
	expect(() => assertRequiredEnv(values, PREVIEW_AUTH_ENV_NAMES, 'Preview auth')).not.toThrow();
	expect(() =>
		assertRequiredEnv(
			{ ...values, SUPABASE_AUTH_TEST_MEMBER_NAME: '' },
			PREVIEW_AUTH_ENV_NAMES,
			'Preview auth',
		),
	).toThrow('SUPABASE_AUTH_TEST_MEMBER_NAME');
});

test('requires the exact main revision and production confirmation', () => {
	expect(assertExactRevision(SHA, SHA)).toBeUndefined();
	expect(() => assertExactRevision(SHA, 'b'.repeat(40))).toThrow();

	expect(
		assertProductionDispatch({
			workflowRef: 'refs/heads/main',
			candidateSha: SHA,
			checkedOutSha: SHA,
			confirmation: 'MIGRATE_PRODUCTION',
		}),
	).toBeUndefined();
	expect(() =>
		assertProductionDispatch({
			workflowRef: 'refs/heads/release',
			candidateSha: SHA,
			checkedOutSha: SHA,
			confirmation: 'MIGRATE_PRODUCTION',
		}),
	).toThrow();
});

test('accepts only successful same-SHA Preview migration and browser evidence', () => {
	expect(
		assertPreviewEvidence({
			candidateSha: SHA,
			expectedRunId: 123,
			run: validPreviewRun,
			jobs: validPreviewJobs,
		}),
	).toEqual({ deploymentRunId: 123, sourceRevision: SHA });

	for (const jobs of [
		[
			{ name: 'db-supabase-preview', status: 'completed', conclusion: 'failure' },
			...validPreviewJobs.slice(1),
		],
		[validPreviewJobs[0]],
	]) {
		expect(() =>
			assertPreviewEvidence({ candidateSha: SHA, run: validPreviewRun, jobs }),
		).toThrow();
	}

	expect(() =>
		assertPreviewEvidence({
			candidateSha: SHA,
			run: { ...validPreviewRun, head_sha: 'b'.repeat(40) },
			jobs: validPreviewJobs,
		}),
	).toThrow();
	expect(() =>
		assertPreviewEvidence({
			candidateSha: SHA,
			run: { ...validPreviewRun, path: '.github/workflows/other.yml' },
			jobs: validPreviewJobs,
		}),
	).toThrow();
	expect(() =>
		assertPreviewEvidence({
			candidateSha: SHA,
			expectedRunId: 124,
			run: validPreviewRun,
			jobs: validPreviewJobs,
		}),
	).toThrow();
});
