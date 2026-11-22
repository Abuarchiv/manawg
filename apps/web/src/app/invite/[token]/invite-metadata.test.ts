import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';

type Preview = { wgName: string; inviterName: string | null; memberCount: number };
const state = {
	preview: null as Preview | null,
	fails: false,
	lookups: [] as string[],
	errors: 0,
};

mock.module('@/core/db/invite-preview', {
	namedExports: {
		findInvitePreview: async (token: string) => {
			state.lookups.push(token);
			if (state.fails) throw new Error('connection refused: postgres://secret-host');
			return state.preview;
		},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => undefined,
		logApiError: () => {
			state.errors += 1;
		},
	},
});

const { inviteMetadata } = await import('./invite-metadata');

function reset(preview: Preview | null = null): void {
	state.preview = preview;
	state.fails = false;
	state.lookups = [];
	state.errors = 0;
}

const generic = {
	title: 'You have been invited to a flat',
	description:
		'Join your flat on ManaWG: expenses, cleaning rota, shopping and noticeboard. Free, in the browser.',
};

type Meta = Awaited<ReturnType<typeof inviteMetadata>>;

function titles(meta: Meta) {
	return {
		title: meta.title,
		og: meta.openGraph?.title,
		twitter: meta.twitter?.title,
		description: meta.description,
		ogDescription: meta.openGraph?.description,
		twitterDescription: meta.twitter?.description,
	};
}

function assertGeneric(meta: Meta, label: string): void {
	assert.deepEqual(
		titles(meta),
		{
			title: generic.title,
			og: `${generic.title} — ManaWG`,
			twitter: `${generic.title} — ManaWG`,
			description: generic.description,
			ogDescription: generic.description,
			twitterDescription: generic.description,
		},
		label,
	);
	assert.deepEqual(meta.robots, { index: false, follow: false }, label);
	assert.equal(meta.referrer, 'no-referrer', label);
}

test('names the inviter and the flat, and adds the member count to the description', async () => {
	reset({ wgName: 'Lindenstraße', inviterName: 'Mika', memberCount: 3 });
	const meta = await inviteMetadata(TOKEN, 'en');
	const title = 'Mika invites you to the flat “Lindenstraße”';
	const description = `${title}. 3 flatmates already in. ${generic.description}`;
	assert.deepEqual(titles(meta), {
		title,
		og: `${title} — ManaWG`,
		twitter: `${title} — ManaWG`,
		description,
		ogDescription: description,
		twitterDescription: description,
	});
	assert.deepEqual(state.lookups, [TOKEN]);
	assert.deepEqual(meta.robots, { index: false, follow: false });
	assert.equal(meta.referrer, 'no-referrer');
	assert.ok(!JSON.stringify(meta).includes(TOKEN), 'the token never goes into the metadata');
});

test('uses the same wording as the page heading in de, en and es', async () => {
	const expected = {
		de: [
			'Mika lädt dich in die WG „Lindenstraße“ ein',
			'Du bist in die WG „Lindenstraße“ eingeladen',
		],
		en: [
			'Mika invites you to the flat “Lindenstraße”',
			'You are invited to the flat “Lindenstraße”',
		],
		es: ['Mika te invita al piso “Lindenstraße”', 'Te han invitado al piso “Lindenstraße”'],
	};
	for (const [locale, [named, anonymous]] of Object.entries(expected)) {
		reset({ wgName: 'Lindenstraße', inviterName: 'Mika', memberCount: 1 });
		assert.equal((await inviteMetadata(TOKEN, locale)).title, named, locale);
		reset({ wgName: 'Lindenstraße', inviterName: null, memberCount: 1 });
		assert.equal((await inviteMetadata(TOKEN, locale)).title, anonymous, locale);
	}
});

test('an inviter without a name gets the anonymous wording', async () => {
	reset({ wgName: 'Lindenstraße', inviterName: null, memberCount: 2 });
	const meta = await inviteMetadata(TOKEN, 'en');
	assert.equal(meta.title, 'You are invited to the flat “Lindenstraße”');
	assert.equal(meta.openGraph?.title, 'You are invited to the flat “Lindenstraße” — ManaWG');
	const description = `You are invited to the flat “Lindenstraße”. 2 flatmates already in. ${generic.description}`;
	assert.equal(meta.description, description);
	assert.equal(meta.openGraph?.description, description);
	assert.equal(meta.twitter?.description, description);
});

test('a flat with a single member names the invitation without a member count', async () => {
	reset({ wgName: 'Lindenstraße', inviterName: 'Mika', memberCount: 1 });
	const meta = await inviteMetadata(TOKEN, 'en');
	const description = `Mika invites you to the flat “Lindenstraße”. ${generic.description}`;
	assert.equal(meta.description, description);
	assert.equal(meta.openGraph?.description, description);
	assert.equal(meta.twitter?.description, description);
});

test('a dead token (unknown, expired, revoked, used up, malformed) keeps the generic metadata', async () => {
	reset(null);
	assertGeneric(await inviteMetadata(TOKEN, 'en'), 'dead token');
	assert.equal(state.errors, 0);
});

test('a failed lookup keeps the generic metadata and is logged', async () => {
	reset({ wgName: 'Lindenstraße', inviterName: 'Mika', memberCount: 3 });
	state.fails = true;
	const meta = await inviteMetadata(TOKEN, 'en');
	assertGeneric(meta, 'lookup error');
	assert.equal(state.errors, 1);
	assert.ok(!JSON.stringify(meta).includes('postgres'));
});

test('an unknown locale falls back to the default locale', async () => {
	reset({ wgName: 'Lindenstraße', inviterName: 'Mika', memberCount: 1 });
	const meta = await inviteMetadata(TOKEN, 'xx');
	assert.equal(meta.title, 'Mika lädt dich in die WG „Lindenstraße“ ein');
});
