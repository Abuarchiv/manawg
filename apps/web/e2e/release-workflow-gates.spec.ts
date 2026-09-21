import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
	PREVIEW_AUTH_ENV_NAMES,
	assertExactRevision,
	assertPreviewEvent,
	assertPreviewEvidence,
	assertProductionDispatch,
	assertRequiredEnv,
} from '../scripts/release-workflow-gates.mjs';
import { isShareCodeLookup } from '../src/middleware';

const SHA = 'a'.repeat(40);
const RUN_SHA = 'b'.repeat(40);
const TREE_SHA = 'c'.repeat(40);
const CI_WORKFLOW = readFileSync(
	path.resolve(__dirname, '../../../.github/workflows/ci.yml'),
	'utf8',
);
const PRODUCTION_WORKFLOW = readFileSync(
	path.resolve(__dirname, '../../../.github/workflows/migrate-production.yml'),
	'utf8',
);
const ENV_EXAMPLE = readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8');
const ANALYTICS_SOURCE = readFileSync(
	path.resolve(__dirname, '../src/instrumentation-client.ts'),
	'utf8',
);

const validPreviewEvent = {
	state: 'success',
	deploymentRef: SHA,
	deploymentSha: SHA,
	environment: 'Preview',
	deploymentCreator: 'vercel[bot]',
	statusCreator: 'vercel[bot]',
	targetUrl: 'https://manawg-feature-applications-projects.vercel.app',
};

const validPreviewRun = {
	id: 123,
	name: 'CI',
	path: '.github/workflows/ci.yml',
	event: 'deployment_status',
	status: 'completed',
	conclusion: 'success',
	head_sha: RUN_SHA,
};

const validPreviewJobs = [
	{ name: 'db-supabase-preview', status: 'completed', conclusion: 'success' },
	{ name: 'e2e-preview', status: 'completed', conclusion: 'success' },
];

function workflowJob(source: string, name: string): string {
	const start = source.indexOf(`  ${name}:`);
	const remainder = source.slice(start + 3);
	const nextJob = remainder.search(/\n {2}[a-z0-9-]+:/);
	return source.slice(start, nextJob === -1 ? source.length : start + 3 + nextJob);
}

test('accepts a trusted successful Preview event and returns its origin', () => {
	expect(assertPreviewEvent(validPreviewEvent)).toBe(validPreviewEvent.targetUrl);
	expect(assertPreviewEvent({ ...validPreviewEvent, deploymentRef: 'main' })).toBe(
		validPreviewEvent.targetUrl,
	);
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
			targetUrl: 'https://user:password@manawg-feature-applications-projects.vercel.app',
		},
		{
			...validPreviewEvent,
			targetUrl: 'https://manawg-feature-applications-projects.vercel.app:443',
		},
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

test('uses the current PostHog defaults release', () => {
	expect(ANALYTICS_SOURCE).toContain("defaults: '2026-08-30'");
	expect(ANALYTICS_SOURCE).not.toContain("defaults: '2026-05-30'");
});

test('documents the release and QA environment names used by the app', () => {
	for (const name of [
		'E2E_SUPABASE_URL',
		'E2E_SUPABASE_PUBLISHABLE_KEY',
		'E2E_SUPABASE_TEST_EMAIL',
		'E2E_SUPABASE_TEST_PASSWORD',
		'SUPABASE_AUTH_TEST_EMAIL',
		'SUPABASE_AUTH_TEST_PASSWORD',
		'SUPABASE_AUTH_TEST_MEMBER_WG_CODE',
		'SUPABASE_AUTH_TEST_MEMBER_NAME',
		'VERCEL_AUTOMATION_BYPASS_SECRET',
		'POSTGRES_URL_NON_POOLING',
		'DATABASE_URL_UNPOOLED',
	]) {
		expect(ENV_EXAMPLE).toMatch(new RegExp(`^${name}=`, 'm'));
	}
});

test('keeps account membership out of the share-code rate-limit bucket', () => {
	expect(isShareCodeLookup('/api/wg/mine', 'GET')).toBe(false);
	expect(isShareCodeLookup('/api/wg/ABCDEFGH', 'GET')).toBe(true);
	expect(isShareCodeLookup('/api/wg/INVALID', 'GET')).toBe(true);
	expect(isShareCodeLookup('/api/wg/ABCDEFGH', 'POST')).toBe(false);
});

test('filters trusted Preview statuses before protected environments and keeps push rehearsal', () => {
	for (const jobName of ['db-supabase-preview', 'e2e-preview']) {
		const job = workflowJob(CI_WORKFLOW, jobName);
		expect(job).toContain("github.event.deployment.creator.login == 'vercel[bot]'");
		expect(job).toContain("github.event.deployment_status.creator.login == 'vercel[bot]'");
		expect(job).toContain("github.event.deployment.ref == 'main'");
		expect(job).toContain('github.event.deployment.ref == github.event.deployment.sha');
		expect(job).toContain(
			"startsWith(github.event.deployment_status.target_url, 'https://manawg-')",
		);
		expect(job).toContain(
			"endsWith(github.event.deployment_status.target_url, '-abditubes-projects.vercel.app')",
		);
		expect(job.indexOf('endsWith(')).toBeLessThan(job.indexOf('environment: Preview'));
	}
	expect(CI_WORKFLOW).toContain("github.event_name == 'push'");
	expect(CI_WORKFLOW).toContain("github.ref == 'refs/heads/main'");
});

test('rechecks current main immediately before the production connection', () => {
	const recheck = PRODUCTION_WORKFLOW.indexOf(
		'name: Recheck current main before production connection',
	);
	const directConnection = PRODUCTION_WORKFLOW.indexOf(
		'name: Verify direct Supabase migration connection',
	);
	expect(recheck).toBeGreaterThan(-1);
	expect(directConnection).toBeGreaterThan(recheck);
	const cutoverBlock = PRODUCTION_WORKFLOW.slice(recheck, directConnection);
	expect(cutoverBlock).toContain('git ls-remote --exit-code origin refs/heads/main');
	expect(cutoverBlock).toContain('assertExactRevision');
	expect(cutoverBlock.match(/\n\s*-\s+name:/g) ?? []).toHaveLength(0);
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

test('accepts successful Preview evidence when distinct commits share the candidate tree', () => {
	expect(
		assertPreviewEvidence({
			candidateSha: SHA,
			candidateTree: TREE_SHA,
			expectedRunId: 123,
			run: validPreviewRun,
			runTree: TREE_SHA,
			jobs: validPreviewJobs,
		}),
	).toEqual({ deploymentRunId: 123, sourceRevision: RUN_SHA });

	for (const jobs of [
		[
			{ name: 'db-supabase-preview', status: 'completed', conclusion: 'failure' },
			...validPreviewJobs.slice(1),
		],
		[validPreviewJobs[0]],
	]) {
		expect(() =>
			assertPreviewEvidence({
				candidateSha: SHA,
				candidateTree: TREE_SHA,
				run: validPreviewRun,
				runTree: TREE_SHA,
				jobs,
			}),
		).toThrow();
	}

	expect(() =>
		assertPreviewEvidence({
			candidateSha: SHA,
			candidateTree: TREE_SHA,
			run: validPreviewRun,
			runTree: 'd'.repeat(40),
			jobs: validPreviewJobs,
		}),
	).toThrow('Preview deployment tree does not match');
	expect(() =>
		assertPreviewEvidence({
			candidateSha: SHA,
			candidateTree: TREE_SHA,
			run: { ...validPreviewRun, head_sha: 'not-a-sha' },
			runTree: TREE_SHA,
			jobs: validPreviewJobs,
		}),
	).toThrow();
	expect(() =>
		assertPreviewEvidence({
			candidateSha: SHA,
			candidateTree: TREE_SHA,
			run: { ...validPreviewRun, path: '.github/workflows/other.yml' },
			runTree: TREE_SHA,
			jobs: validPreviewJobs,
		}),
	).toThrow();
	expect(() =>
		assertPreviewEvidence({
			candidateSha: SHA,
			candidateTree: TREE_SHA,
			expectedRunId: 124,
			run: validPreviewRun,
			runTree: TREE_SHA,
			jobs: validPreviewJobs,
		}),
	).toThrow();
});
