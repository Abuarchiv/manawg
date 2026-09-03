#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSnapshot } from './index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'tools/growth-lab/inputs/mana-wg.json');
const DEFAULT_OUT = path.join(REPO_ROOT, 'tools/growth-lab/runs');
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const SOURCE_ALLOWLIST = [
	{
		id: 'destatis-students',
		url: 'https://www.destatis.de/DE/Presse/Pressemitteilungen/2025/11/PD25_426_21.html',
		kind: 'student-count',
		observedAt: '2025-11-28',
	},
	{
		id: 'student-survey',
		url: 'https://www.studierendenwerke.de/fileadmin/user_upload/SE22_Hauptbericht_barrierefrei.pdf',
		kind: 'health-only',
	},
	{
		id: 'destatis-api',
		url: 'https://www.destatis.de/EN/Service/OpenData/api-webservice.html',
		kind: 'health-only',
	},
	{
		id: 'search-console',
		url: 'https://developers.google.com/webmaster-tools/v1/searchanalytics/query',
		kind: 'health-only',
	},
	{
		id: 'reddit-terms',
		url: 'https://redditinc.com/policies/data-api-terms',
		kind: 'health-only',
	},
	{
		id: 'instagram-api',
		url: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing',
		kind: 'health-only',
	},
	{
		id: 'vercel-analytics',
		url: 'https://vercel.com/docs/analytics/limits-and-pricing',
		kind: 'health-only',
	},
];
const SOURCE_BY_URL = new Map(SOURCE_ALLOWLIST.map((source) => [source.url, source]));

class RefreshError extends Error {
	constructor(code, message, details = []) {
		super(message);
		this.name = 'RefreshError';
		this.code = code;
		this.details = details;
	}
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function validDate(value) {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeHtml(value) {
	return value
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/\s+/g, ' ');
}

function parseStudentCount(body) {
	const text = normalizeHtml(body.toString('utf8'));
	const values = [...text.matchAll(/insgesamt\s+([\d\s.]+)\s+Studierende/giu)].map((match) =>
		Number(match[1].replace(/[^\d]/g, '')),
	);
	const unique = [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
	if (unique.length !== 1)
		throw new RefreshError('SOURCE_UNPARSED', 'unique Destatis student count was not found', [
			`found ${unique.length} candidate values`,
		]);
	return unique[0];
}

function sourceUrls(snapshot) {
	const urls = new Set();
	const visit = (value) => {
		if (Array.isArray(value)) {
			value.forEach(visit);
			return;
		}
		if (!value || typeof value !== 'object') return;
		if (typeof value.source === 'string') urls.add(value.source);
		Object.values(value).forEach(visit);
	};
	visit(snapshot);
	return [...urls].sort();
}

function assertAllowlisted(snapshot) {
	const unknown = sourceUrls(snapshot).filter((url) => !SOURCE_BY_URL.has(url));
	if (unknown.length)
		throw new RefreshError(
			'SOURCE_NOT_ALLOWLISTED',
			'snapshot contains non-allowlisted sources',
			unknown,
		);
}

async function fetchSource(source, timeoutMs, fetchedAt) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const origin = new URL(source.url).origin;
		let method = source.kind === 'health-only' ? 'HEAD' : 'GET';
		let currentUrl = source.url;
		let response;
		for (let redirects = 0; redirects <= 3; redirects += 1) {
			response = await fetch(currentUrl, {
				method,
				signal: controller.signal,
				redirect: 'manual',
				headers: { accept: 'text/html,application/pdf,*/*;q=0.1' },
			});
			if (response.status < 300 || response.status >= 400) break;
			const location = response.headers.get('location');
			const nextUrl = location ? new URL(location, currentUrl) : null;
			if (!nextUrl || nextUrl.protocol !== 'https:' || nextUrl.origin !== origin)
				throw new RefreshError(
					'SOURCE_REDIRECT',
					`${source.id} redirected outside its allowlisted origin`,
				);
			if (redirects === 3)
				throw new RefreshError('SOURCE_REDIRECT', `${source.id} exceeded redirect limit`);
			currentUrl = nextUrl.href;
		}
		if (method === 'HEAD' && [405, 501].includes(response.status)) {
			method = 'GET';
			response = await fetch(currentUrl, {
				method,
				signal: controller.signal,
				redirect: 'error',
				headers: { accept: 'text/html,application/pdf,*/*;q=0.1' },
			});
		}
		const contentLength = Number(response.headers.get('content-length'));
		if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES)
			throw new RefreshError('SOURCE_TOO_LARGE', `${source.id} response exceeds 8 MiB`);
		if (!response.ok)
			throw new RefreshError('SOURCE_HTTP', `${source.id} returned HTTP ${response.status}`);
		const body = method === 'GET' ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
		if (body.length > MAX_RESPONSE_BYTES)
			throw new RefreshError('SOURCE_TOO_LARGE', `${source.id} response exceeds 8 MiB`);
		const result = {
			id: source.id,
			url: source.url,
			finalUrl: response.url || currentUrl,
			kind: source.kind,
			method,
			status: 'ok',
			httpStatus: response.status,
			contentType: response.headers.get('content-type') ?? null,
			responseBytes: body.length,
			declaredResponseBytes: Number.isFinite(contentLength) ? contentLength : null,
			responseSha256: sha256(
				method === 'GET'
					? body
					: `${source.url}|${response.status}|${response.headers.get('content-type') ?? ''}|${contentLength || ''}`,
			),
			fetchedAt,
		};
		if (source.kind === 'student-count')
			result.extracted = { studentCount: parseStudentCount(body) };
		return result;
	} catch (error) {
		if (error instanceof RefreshError) throw error;
		if (error.name === 'AbortError')
			throw new RefreshError('SOURCE_TIMEOUT', `${source.id} exceeded ${timeoutMs}ms`);
		throw new RefreshError('SOURCE_FETCH', `${source.id} fetch failed: ${error.message}`);
	} finally {
		clearTimeout(timeout);
	}
}

function refreshSnapshot(baseline, checks, asOf, fetchedAt) {
	if (!validDate(asOf)) throw new RefreshError('INPUT_INVALID', 'as-of must be YYYY-MM-DD');
	const snapshot = clone(baseline);
	const studentSource = SOURCE_ALLOWLIST.find((source) => source.kind === 'student-count');
	const studentCheck = checks.find((check) => check.id === studentSource.id);
	if (!studentCheck?.extracted?.studentCount)
		throw new RefreshError('SOURCE_UNPARSED', 'required student-count extraction is missing');
	const student = snapshot.market.students;
	const value = studentCheck.extracted.studentCount;
	student.min = Math.min(student.min, value);
	student.max = Math.max(student.max, value);
	student.mode = value;
	student.evidence = 'observed';
	student.source = studentSource.url;
	student.observedAt = studentSource.observedAt;
	snapshot.snapshotDate = asOf;
	snapshot.sourceRefresh = {
		fetchedAt,
		asOf,
		maxResponseBytes: MAX_RESPONSE_BYTES,
		updatedParameters: ['market.students.mode'],
		sources: checks,
	};
	const errors = validateSnapshot(snapshot, asOf);
	if (errors.length)
		throw new RefreshError('INPUT_INVALID', 'refreshed snapshot failed validation', errors);
	return snapshot;
}

function writeAtomic(file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	const fd = fs.openSync(temporary, 'w');
	try {
		fs.writeFileSync(fd, content);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(temporary, file);
}

function parseArgs(argv) {
	const options = { input: DEFAULT_INPUT, out: DEFAULT_OUT, timeoutMs: 15_000 };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--') continue;
		if (argument === '--help' || argument === '-h') options.help = true;
		else if (argument.startsWith('--input=')) options.input = argument.slice(8);
		else if (argument === '--input') options.input = argv[++index];
		else if (argument.startsWith('--out=')) options.out = argument.slice(6);
		else if (argument === '--out') options.out = argv[++index];
		else if (argument.startsWith('--as-of=')) options.asOf = argument.slice(8);
		else if (argument === '--as-of') options.asOf = argv[++index];
		else if (argument.startsWith('--timeout-ms=')) options.timeoutMs = Number(argument.slice(13));
		else if (argument === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
		else throw new RefreshError('CLI_INVALID', `unknown argument ${argument}`);
	}
	if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 60_000)
		throw new RefreshError('CLI_INVALID', 'timeout-ms must be between 100 and 60000');
	return options;
}

async function runRefresh(options) {
	const baseline = JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8'));
	const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
	const baselineErrors = validateSnapshot(baseline, asOf);
	if (baselineErrors.length)
		throw new RefreshError('INPUT_INVALID', 'baseline snapshot validation failed', baselineErrors);
	assertAllowlisted(baseline);
	const fetchedAt = new Date().toISOString();
	const sources = sourceUrls(baseline).map((url) => SOURCE_BY_URL.get(url));
	const checks = [];
	for (const source of sources)
		checks.push(await fetchSource(source, options.timeoutMs, fetchedAt));
	const snapshot = refreshSnapshot(baseline, checks, asOf, fetchedAt);
	const outDir = path.resolve(options.out);
	fs.mkdirSync(outDir, { recursive: true });
	const dateInput = path.join(outDir, `live-input-${asOf}.json`);
	const sourceStatus = path.join(outDir, `source-status-${asOf}.json`);
	writeAtomic(
		sourceStatus,
		`${JSON.stringify({ schemaVersion: 1, fetchedAt, asOf, sources: checks }, null, 2)}\n`,
	);
	writeAtomic(dateInput, `${JSON.stringify(snapshot, null, 2)}\n`);
	return {
		input: dateInput,
		sourceStatus,
		fetchedAt,
		updatedParameters: snapshot.sourceRefresh.updatedParameters,
	};
}

async function main() {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (options.help) {
			process.stdout.write(
				'ManaWG Growth Lab source refresh\n\nUsage: node tools/growth-lab/refresh.mjs [options]\n\nOptions:\n  --input <file>       Baseline JSON snapshot\n  --out <directory>    Generated output directory\n  --as-of <date>       UTC snapshot date (default: today)\n  --timeout-ms <n>     Per-source timeout (default: 15000)\n  --help               Show this help\n',
			);
			return;
		}
		process.stdout.write(
			`${JSON.stringify({ status: 'success', ...(await runRefresh(options)) })}\n`,
		);
	} catch (error) {
		process.stderr.write(
			`${JSON.stringify({ status: 'failure', code: error.code ?? 'ERROR', message: error.message, details: error.details ?? [] })}\n`,
		);
		process.exitCode = 1;
	}
}

export { MAX_RESPONSE_BYTES, SOURCE_ALLOWLIST, parseStudentCount, refreshSnapshot, runRefresh };

if (import.meta.url === `file://${process.argv[1]}`) await main();
