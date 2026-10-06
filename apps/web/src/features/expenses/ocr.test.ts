import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

type OcrRuntime = NonNullable<Parameters<typeof import('./ocr').runOcrOnImage>[2]>;
type TesseractModule = Awaited<ReturnType<NonNullable<OcrRuntime['loadTesseract']>>>;
type CreateWorker = TesseractModule['createWorker'];

const tesseract: TesseractModule = {
	createWorker: () => new Promise(() => {}),
};

mock.module('tesseract.js', {
	namedExports: {
		createWorker: (...args: Parameters<CreateWorker>) => tesseract.createWorker(...args),
	},
});

const { OcrInitializationError, parseOcrText, runOcrOnImage } = await import('./ocr');
const contextDate = '2026-09-27T00:00:00.000Z';
const reloadRequired = (error: unknown) =>
	error instanceof OcrInitializationError && error.requiresReload;

// Resolves in a microtask, so createWorker runs before any init timer. The default loader's
// dynamic import can take longer than a 10 ms timeout on a busy machine.
const loadTesseract = async () => tesseract;

function setTesseractMock(createWorker: CreateWorker): void {
	tesseract.createWorker = createWorker;
}

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

async function assertRejectsWithin(
	promise: Promise<unknown>,
	timeoutMs: number,
	errorPattern: RegExp | ((error: unknown) => boolean),
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await assert.rejects(
			Promise.race([
				promise,
				new Promise((_, reject) => {
					timer = setTimeout(() => reject(new Error('Test deadline expired')), timeoutMs);
				}),
			]),
			errorPattern,
		);
	} finally {
		clearTimeout(timer);
	}
}

test('dot, comma, and correctly grouped decimal amounts become euro cents', () => {
	const amounts = [
		'Brot 12.34 EUR',
		'Brot 12,34 EUR',
		'Brot 12.34EUR',
		'Brot 12345.67 EUR',
		'Brot 12345,67 EUR',
		'Brot 1.234,56 EUR',
		'Brot 1,234.56 EUR',
	];
	assert.deepEqual(
		amounts.map((text) =>
			parseOcrText(text, contextDate).expenses.map((expense) => expense.amountCents),
		),
		[[1234], [1234], [1234], [1_234_567], [1_234_567], [123_456], [123_456]],
	);
});

test('dates are not imported as amounts and a real amount after a date remains parseable', () => {
	assert.deepEqual(parseOcrText('Datum 27.09.2026', contextDate).expenses, []);
	const [expense] = parseOcrText('Datum 27.09.2026 Brot 12.34 EUR', contextDate).expenses;
	assert.ok(expense);
	assert.equal(expense.amountCents, 1234);
	assert.equal(expense.date, '2026-09-27T00:00:00.000Z');
});

test('partial, malformed-grouping, over-precision, and over-limit tokens are rejected whole', () => {
	for (const text of [
		'Brot 12,345 EUR',
		'Brot 12.345 EUR',
		'Brot 1234.567 EUR',
		'Brot 1.23.4,56 EUR',
		'Brot 1,23,4.56 EUR',
		'Brot 1\u00a0234,56 EUR',
		'Brot 1\u202f234.56 EUR',
		"Brot 1'234.56 EUR",
		'Brot 1 234,56 EUR',
		'Brot 1  234,56 EUR',
		'Brot 1\u00a0\u00a0234,56 EUR',
		'Brot 12 34,56 EUR',
		'Brot 1234 567,89 EUR',
		'Brot 1000000.01 EUR',
		'Brot123,45 EUR',
		'Brot 123,45X EUR',
	]) {
		assert.deepEqual(parseOcrText(text, contextDate).expenses, [], text);
	}
});

test('signed, foreign-currency, and percentage tokens are not treated as EUR amounts', () => {
	for (const text of [
		'Brot -12,34 EUR',
		'Brot - 12,34 EUR',
		'Brot 12,34- EUR',
		'Brot 12,34 - EUR',
		'Brot −12,34 EUR',
		'Brot − 12,34 EUR',
		'Brot 12,34+ EUR',
		'Brot 12.34 USD',
		'Brot USD 12.34',
		'Brot CHF 12,34',
		'Brot GBP 12,34',
		'Brot $12.34',
		'Brot 12.34 $',
		'Rabatt 12,34%',
		'Rabatt 12,34 %',
	]) {
		assert.deepEqual(parseOcrText(text, contextDate).expenses, [], text);
	}
});

test('a nonbreaking space between label and amount remains a valid boundary', () => {
	const [expense] = parseOcrText('Brot\u00a012,34 EUR', contextDate).expenses;
	assert.equal(expense?.amountCents, 1234);
});

test('separate amounts on one line still select the final amount', () => {
	const [expense] = parseOcrText('Brot 12,34 56,78 EUR', contextDate).expenses;
	assert.equal(expense?.amountCents, 5678);
});

test('a timed-out module load does not start a worker when it resolves late', async () => {
	const moduleLoad = deferred<TesseractModule>();
	let workerStarts = 0;
	setTesseractMock(() => {
		workerStarts += 1;
		return Promise.resolve({
			recognize: async () => ({ data: { text: '' } }),
			terminate: async () => {},
		});
	});
	await assertRejectsWithin(
		runOcrOnImage(new Blob(), undefined, {
			loadTesseract: () => moduleLoad.promise,
			initTimeoutMs: 10,
		}),
		250,
		reloadRequired,
	);
	moduleLoad.resolve(tesseract);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(workerStarts, 0);
});

test('a late worker is terminated if createWorker resolves after the init timeout', async () => {
	const workerInit = deferred<Awaited<ReturnType<CreateWorker>>>();
	const terminated = deferred<void>();
	let terminateCount = 0;
	const worker = {
		recognize: async () => ({ data: { text: 'unused' } }),
		terminate: async () => {
			terminateCount += 1;
			terminated.resolve();
		},
	};
	setTesseractMock(() => workerInit.promise);
	await assertRejectsWithin(
		runOcrOnImage(new Blob(), undefined, { loadTesseract, initTimeoutMs: 10 }),
		250,
		reloadRequired,
	);
	workerInit.resolve(worker);
	await terminated.promise;
	assert.equal(terminateCount, 1);
});

test('recognition timeout terminates an initialized worker', async () => {
	let terminateCount = 0;
	setTesseractMock(async () => ({
		recognize: () => new Promise(() => {}),
		terminate: async () => {
			terminateCount += 1;
		},
	}));
	await assertRejectsWithin(
		runOcrOnImage(new Blob(), undefined, { loadTesseract, recognitionTimeoutMs: 10 }),
		250,
		/recognition timed out/i,
	);
	assert.equal(terminateCount, 1);
});

test('worker errors during recognition reject and terminate the initialized worker', async () => {
	let terminateCount = 0;
	setTesseractMock(async (_langs, _oem, options) => ({
		recognize: () => {
			queueMicrotask(() => options?.errorHandler?.('recognition failed'));
			return new Promise(() => {});
		},
		terminate: async () => {
			terminateCount += 1;
		},
	}));
	await assertRejectsWithin(
		runOcrOnImage(new Blob(), undefined, { loadTesseract, recognitionTimeoutMs: 100 }),
		250,
		/recognition failed/,
	);
	assert.equal(terminateCount, 1);
});

test('optional runner seam still bypasses Tesseract', async () => {
	let createCalls = 0;
	setTesseractMock(() => {
		createCalls += 1;
		return new Promise(() => {});
	});
	assert.equal(
		await runOcrOnImage(new Blob(), { recognize: async () => 'runner text' }),
		'runner text',
	);
	assert.equal(createCalls, 0);
});

test('SDK init errors reject promptly and repeated attempts do not spawn another pending worker', async () => {
	let createCalls = 0;
	setTesseractMock((_langs, _oem, options) => {
		createCalls += 1;
		queueMicrotask(() => options?.errorHandler?.('TypeError: Failed to fetch language data'));
		return new Promise(() => {});
	});
	const runtime = { loadTesseract, initTimeoutMs: 100 };
	await assertRejectsWithin(runOcrOnImage(new Blob(), undefined, runtime), 250, reloadRequired);
	await assert.rejects(runOcrOnImage(new Blob(), undefined, runtime), reloadRequired);
	assert.equal(createCalls, 1);
});
