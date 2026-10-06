import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../../../tests/support/db-mock';
import { mockDrizzle } from '../../../../../../../tests/support/drizzle-mock';
import {
	SHARE_CODE as code,
	importUnmocked,
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../tests/support/route-harness';

type Onboarding = typeof import('@/core/infra/paypal-onboarding');
type ConnectionState = import('@/core/infra/paypal-onboarding').PayPalConnectionState;

const wgId = '1bc67a5a-5c08-4c0d-8eaf-520def98021a';
const memberId = '2bc67a5a-5c08-4c0d-8eaf-520def98021a';
const authUserId = '3bc67a5a-5c08-4c0d-8eaf-520def98021a';
const merchantId = '2B23456789ABC';
const cookieName = 'manawg_paypal_connection';
const stableTrackingId = 'stable-opaque-customer-tracking-id';
const callbackNonce = '9f3e7a22-11ab-4b13-9d1e-d3a42fd7b6c0';

// The provider calls are stand-ins; the signed-cookie helpers are the real ones.
const realOnboarding = (await importUnmocked('core/infra/paypal-onboarding.ts')) as Onboarding;

interface Options {
	savedMerchantId?: string | null;
	cookieExpectedPreviousMerchantId?: string | null;
	providerReady?: boolean;
	inactive?: boolean;
	activePayment?: boolean;
	cookieTrackingId?: string;
	lookupMerchantId?: string | null;
	onReadiness?: (state: HarnessState) => void;
	realCookie?: boolean;
}

interface HarnessState {
	updates: { paypalMerchantId: string }[];
	referral: { trackingId: string; nonce: string; returnUrl: string } | null;
	readinessCalls: { id: string; trackingId: string | undefined }[];
	lookupCalls: string[];
	cookieState: ConnectionState | null;
	/** The member's saved PayPal merchant id. */
	memberId: string | null;
	expectedPreviousMerchantId: string | null;
}

interface Harness {
	options: Required<Omit<Options, 'onReadiness'>> & {
		onReadiness: Options['onReadiness'] | undefined;
	};
	state: HarnessState;
}

/** The harness whose request runs right now; every stand-in reads its scenario from here. */
let active: Harness;

function harness(options: Options = {}) {
	const savedMerchantId = options.savedMerchantId ?? null;
	const self: Harness = {
		options: {
			savedMerchantId,
			cookieExpectedPreviousMerchantId:
				options.cookieExpectedPreviousMerchantId === undefined
					? savedMerchantId
					: options.cookieExpectedPreviousMerchantId,
			providerReady: options.providerReady ?? true,
			inactive: options.inactive ?? false,
			activePayment: options.activePayment ?? false,
			cookieTrackingId: options.cookieTrackingId ?? stableTrackingId,
			lookupMerchantId:
				options.lookupMerchantId === undefined ? merchantId : options.lookupMerchantId,
			onReadiness: options.onReadiness,
			realCookie: options.realCookie ?? false,
		},
		state: {
			updates: [],
			referral: null,
			readinessCalls: [],
			lookupCalls: [],
			cookieState: null,
			memberId: savedMerchantId,
			expectedPreviousMerchantId: null,
		},
	};
	self.state.expectedPreviousMerchantId = self.options.cookieExpectedPreviousMerchantId;
	const run = <T>(handler: () => T): T => {
		active = self;
		return handler();
	};
	return {
		state: self.state,
		GET: (req: Request) => run(() => GET(req as never, routeCtx())),
		POST: (req: Request) => run(() => POST(req as never, routeCtx())),
	};
}

const member = () => ({ id: memberId, paypalMerchantId: active.state.memberId });
const tx = {
	select: () => {
		const query = { from: () => query, where: () => query, for: async () => [member()] };
		return query;
	},
	update: () => ({
		set: (values: { paypalMerchantId: string }) => ({
			where: async () => {
				active.state.updates.push(values);
				active.state.memberId = values.paypalMerchantId ?? active.state.memberId;
			},
		}),
	}),
};

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: wgId }, member: { memberId, name: 'Abu' } }).authUserId = authUserId;
mockDb({
	wgMembers: { id: 'id', wgId: 'wgId', paypalMerchantId: 'paypalMerchantId' },
	db: {
		select: () => {
			const query = { from: () => query, where: () => query, limit: async () => [member()] };
			return query;
		},
	},
});
mock.module('@/core/db/account-deletion', {
	namedExports: {
		lockActiveAccountMember: async () => (active.options.inactive ? null : { id: memberId }),
	},
});
mock.module('@/features/expenses/expense-payments', {
	namedExports: {
		hasActiveExpensePayment: async () => active.options.activePayment,
		withExpensePaymentLock: async (_wgId: string, operation: (handle: typeof tx) => unknown) =>
			operation(tx),
	},
});
mock.module('@/core/infra/paypal-onboarding', {
	namedExports: {
		PAYPAL_CONNECTION_COOKIE_NAME: cookieName,
		getPayPalOnboardingConfig: () => ({
			environment: 'sandbox',
			clientId: 'client',
			partnerMerchantId: 'partner',
			appOrigin: 'https://manawg.example',
		}),
		getPayPalEnvironment: () => 'sandbox',
		getTrustedPayPalAppOrigin: () => 'https://manawg.example',
		getPayPalTrackingId: () => stableTrackingId,
		isPayPalMerchantId: (value: unknown) => value === merchantId,
		createPayPalPartnerReferral: async (input: HarnessState['referral']) => {
			active.state.referral = input;
			return 'https://www.sandbox.paypal.com/partnerexp/appEntry?referralToken=generated';
		},
		getPayPalMerchantIdByTracking: async (trackingId: string) => {
			active.state.lookupCalls.push(trackingId);
			return active.options.lookupMerchantId;
		},
		isPayPalMerchantReady: async (id: string, trackingId?: string) => {
			active.state.readinessCalls.push({ id, trackingId });
			active.options.onReadiness?.(active.state);
			return active.options.providerReady;
		},
		createPayPalConnectionCookie: (value: ConnectionState) => {
			active.state.cookieState = value;
			return 'signed-cookie';
		},
		readPayPalConnectionCookie: realOnboarding.readPayPalConnectionCookie,
		verifyPayPalConnectionCookie: (
			value: string | undefined,
			expected: Parameters<Onboarding['verifyPayPalConnectionCookie']>[1],
		) => {
			if (active.options.realCookie) {
				return realOnboarding.verifyPayPalConnectionCookie(value, expected);
			}
			return value === 'signed-cookie' || value === 'valid-cookie'
				? {
						trackingId: active.options.cookieTrackingId,
						nonce: callbackNonce,
						wgId,
						memberId,
						authUserId,
						code,
						environment: expected.environment,
						expiresAt: 2_000_000_000,
						expectedPreviousMerchantId: active.state.expectedPreviousMerchantId,
					}
				: null;
		},
	},
});

const { GET, POST } = await import('./route');

function connectRequest(body: unknown, cookie?: string): Request {
	return request('/api/connect', {
		method: 'POST',
		headers: cookie === undefined ? {} : { cookie: `${cookieName}=${cookie}` },
		body,
	});
}

const completionRequest = (body: unknown = { action: 'complete' }, cookie = 'valid-cookie') =>
	connectRequest(body, cookie);

test('GET exposes only provider readiness and returns no-store', async () => {
	const connect = harness({ savedMerchantId: merchantId });
	const response = await connect.GET(request('/api/connect'));
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { available: true, connected: true });
	assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('start requires affirmative consent and fixes the callback to the configured generic URL', async () => {
	const connect = harness({ savedMerchantId: merchantId });
	const { state } = connect;
	const invalid = await connect.POST(
		connectRequest({ action: 'start', consent: false, returnUrl: 'https://attacker.test' }),
	);
	assert.equal(invalid.status, 400);
	assert.equal(state.referral, null);

	const response = await connect.POST(connectRequest({ action: 'start', consent: true }));
	assert.equal(response.status, 200);
	const cookieState = state.cookieState as ConnectionState;
	assert.deepEqual(state.referral, {
		trackingId: stableTrackingId,
		nonce: cookieState.nonce,
		returnUrl: `https://manawg.example/api/paypal/return?state=${cookieState.nonce}`,
	});
	assert.equal(cookieState.code, code);
	assert.equal(cookieState.trackingId, stableTrackingId);
	assert.equal(cookieState.expectedPreviousMerchantId, merchantId);
	const setCookie = response.headers.get('set-cookie') ?? '';
	assert.match(
		setCookie,
		new RegExp(`${cookieName}=signed-cookie; Path=/api; Max-Age=1800; HttpOnly; SameSite=Lax`),
	);
	assert.match(setCookie, /; Secure$/);
	const firstNonce = cookieState.nonce;
	const secondStart = await connect.POST(connectRequest({ action: 'start', consent: true }));
	assert.equal(secondStart.status, 200);
	// Read again: the earlier null check narrowed `state.referral`.
	const secondReferral = connect.state.referral as HarnessState['referral'];
	assert.equal(secondReferral?.trackingId, stableTrackingId);
	assert.notEqual(secondReferral?.nonce, firstNonce);
});

test('unready or forged provider return never writes a recipient ID', async () => {
	const connect = harness({ providerReady: false });
	const response = await connect.POST(
		connectRequest({ action: 'confirm', merchantId }, 'valid-cookie'),
	);
	assert.equal(response.status, 409);
	assert.equal((await response.json()).error, 'paypal_onboarding_pending');
	assert.deepEqual(connect.state.readinessCalls, [
		{ id: merchantId, trackingId: stableTrackingId },
	]);
	assert.deepEqual(connect.state.updates, []);
});

test('verified onboarding can replace the signed previous recipient and rejects concurrent account changes', async () => {
	const confirm = () => connectRequest({ action: 'confirm', merchantId }, 'valid-cookie');
	const first = harness();
	const connected = await first.POST(confirm());
	assert.equal(connected.status, 200);
	assert.deepEqual(await connected.json(), { connected: true });
	assert.deepEqual(first.state.updates, [{ paypalMerchantId: merchantId }]);
	assert.match(connected.headers.get('set-cookie') ?? '', /Max-Age=0/);

	const second = harness({ savedMerchantId: '2C23456789ABC' });
	const correctedLegacyId = await second.POST(confirm());
	assert.equal(correctedLegacyId.status, 200);
	assert.deepEqual(second.state.updates, [{ paypalMerchantId: merchantId }]);

	const changed = harness({
		savedMerchantId: '2C23456789ABC',
		cookieExpectedPreviousMerchantId: null,
	});
	const repeatedConfirmation = await second.POST(confirm());
	assert.equal(repeatedConfirmation.status, 200);
	assert.deepEqual(second.state.updates, [{ paypalMerchantId: merchantId }]);

	const conflict = await changed.POST(confirm());
	assert.equal(conflict.status, 409);
	assert.equal((await conflict.json()).error, 'paypal_account_already_connected');
	assert.deepEqual(changed.state.updates, []);
});

test('replacement waits until every active WG payment has settled or expired', async () => {
	const connect = harness({ savedMerchantId: '2C23456789ABC', activePayment: true });
	const response = await connect.POST(
		connectRequest({ action: 'confirm', merchantId }, 'valid-cookie'),
	);
	assert.equal(response.status, 409);
	assert.equal((await response.json()).error, 'paypal_payment_pending');
	assert.deepEqual(connect.state.updates, []);
});

test('completion discovers only the signed tracking recipient and reuses canonical readiness', async () => {
	const connect = harness();
	const response = await connect.POST(completionRequest());
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { connected: true });
	assert.deepEqual(connect.state.lookupCalls, [stableTrackingId]);
	assert.deepEqual(connect.state.readinessCalls, [
		{ id: merchantId, trackingId: stableTrackingId },
	]);
	assert.deepEqual(connect.state.updates, [{ paypalMerchantId: merchantId }]);
	assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/);
	assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('completion rejects missing state, changed client tracking, stale recipient, and caller hints before provider calls', async () => {
	const cases: [Options, string, unknown, string][] = [
		[{}, '', { action: 'complete' }, 'paypal_connection_expired'],
		[
			{ cookieTrackingId: 'another-client-tracking' },
			'valid-cookie',
			{ action: 'complete' },
			'paypal_connection_expired',
		],
		[
			{ savedMerchantId: '2C23456789ABC', cookieExpectedPreviousMerchantId: null },
			'valid-cookie',
			{ action: 'complete' },
			'paypal_account_already_connected',
		],
		[{}, 'valid-cookie', { action: 'complete', merchantId }, 'paypal_request_invalid'],
		[
			{},
			'valid-cookie',
			{ action: 'complete', trackingId: stableTrackingId },
			'paypal_request_invalid',
		],
	];
	for (const [options, cookie, body, expected] of cases) {
		const connect = harness(options);
		const response = await connect.POST(completionRequest(body, cookie));
		assert.equal((await response.json()).error, expected);
		assert.deepEqual(connect.state.lookupCalls, []);
		assert.deepEqual(connect.state.readinessCalls, []);
		assert.deepEqual(connect.state.updates, []);
		assert.equal(response.headers.get('set-cookie'), null);
	}
});

test('completion preserves pending state and previous recipient until canonical readiness and payment locks permit saving', async () => {
	for (const options of [
		{ lookupMerchantId: null },
		{ providerReady: false },
		{ activePayment: true },
		{ inactive: true },
	]) {
		const connect = harness({ savedMerchantId: '2C23456789ABC', ...options });
		const response = await connect.POST(completionRequest());
		assert.ok(response.status >= 400);
		assert.equal(connect.state.memberId, '2C23456789ABC');
		assert.deepEqual(connect.state.updates, []);
		assert.equal(response.headers.get('set-cookie'), null);
	}
});

test('completion followed by an overlapping callback cannot overwrite or duplicate the connected recipient', async () => {
	const connect = harness();
	assert.equal((await connect.POST(completionRequest())).status, 200);
	assert.equal((await connect.POST(completionRequest())).status, 409);
	const confirmation = await connect.POST(completionRequest({ action: 'confirm', merchantId }));
	assert.equal(confirmation.status, 200);
	assert.deepEqual(connect.state.updates, [{ paypalMerchantId: merchantId }]);
});

test('completion validates real signed-cookie expiry and every current session binding before provider access', async () => {
	process.env.PAYPAL_CLIENT_SECRET = 'fixture-signing-secret';
	const cookieState: ConnectionState = {
		trackingId: stableTrackingId,
		nonce: callbackNonce,
		wgId,
		memberId,
		authUserId,
		code,
		environment: 'sandbox',
		expiresAt: Math.floor(Date.now() / 1000) + 600,
		expectedPreviousMerchantId: null,
	};
	const bindings: Partial<ConnectionState>[] = [
		{ wgId: 'other-wg' },
		{ memberId: 'other-member' },
		{ authUserId: 'other-user' },
		{ code: 'OTHER123' },
		{ environment: 'live' },
		{ expiresAt: 1 },
		{ nonce: 'invalid' },
	];
	for (const binding of bindings) {
		const connect = harness({ realCookie: true });
		const response = await connect.POST(
			completionRequest(
				{ action: 'complete' },
				realOnboarding.createPayPalConnectionCookie({ ...cookieState, ...binding }),
			),
		);
		assert.equal(response.status, 409);
		assert.equal((await response.json()).error, 'paypal_connection_expired');
		assert.deepEqual(connect.state.lookupCalls, []);
		assert.deepEqual(connect.state.readinessCalls, []);
		assert.deepEqual(connect.state.updates, []);
	}
	const connect = harness({ realCookie: true });
	const response = await connect.POST(
		completionRequest(
			{ action: 'complete' },
			realOnboarding.createPayPalConnectionCookie(cookieState),
		),
	);
	assert.equal(response.status, 200);
	assert.equal(connect.state.updates.length, 1);
});

test('completion rechecks recipient compare-and-set after provider work', async () => {
	const connect = harness({
		onReadiness: (current) => {
			current.memberId = '2C23456789ABC';
		},
	});
	const response = await connect.POST(completionRequest());
	assert.equal(response.status, 409);
	assert.equal((await response.json()).error, 'paypal_account_already_connected');
	assert.equal(connect.state.memberId, '2C23456789ABC');
	assert.deepEqual(connect.state.updates, []);
	assert.equal(response.headers.get('set-cookie'), null);
});
