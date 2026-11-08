type CaptureProperties = Record<string, unknown>;
type PosthogClient = {
	capture: (event: string, properties?: CaptureProperties) => void;
	__loaded?: boolean;
};

/**
 * The SDK is initialised in idle time (instrumentation-client.ts, at most ~5 s after load). An
 * event captured right at page load, such as a sign-in that just finished, waits for it instead
 * of being dropped. Deployments that never initialise it (preview, loopback, automated browsers)
 * give up after this long.
 */
const INIT_WAIT_MS = 8000;
const INIT_POLL_MS = 250;

function whenInitialised(client: PosthogClient): Promise<boolean> {
	return new Promise((resolve) => {
		let waited = 0;
		const check = () => {
			if (client.__loaded) return resolve(true);
			waited += INIT_POLL_MS;
			if (waited > INIT_WAIT_MS) return resolve(false);
			setTimeout(check, INIT_POLL_MS);
		};
		check();
	});
}

let posthogPromise: Promise<PosthogClient | null> | undefined;

function loadPosthog(): Promise<PosthogClient | null> {
	posthogPromise ??= import('posthog-js')
		.then(({ default: posthog }) => posthog as PosthogClient)
		.catch(() => null);
	return posthogPromise;
}

const posthog = {
	capture(event: string, properties?: CaptureProperties): void {
		void loadPosthog().then(async (client) => {
			if (!client) return;
			try {
				if (await whenInitialised(client)) client.capture(event, properties);
			} catch {
				// Analytics must never affect the product flow.
			}
		});
	},
};

export default posthog;
