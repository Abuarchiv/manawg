type CaptureProperties = Record<string, unknown>;
type PosthogClient = {
	capture: (event: string, properties?: CaptureProperties) => void;
};

let posthogPromise: Promise<PosthogClient | null> | undefined;

function loadPosthog(): Promise<PosthogClient | null> {
	posthogPromise ??= import('posthog-js')
		.then(({ default: posthog }) => posthog as PosthogClient)
		.catch(() => null);
	return posthogPromise;
}

const posthog = {
	capture(event: string, properties?: CaptureProperties): void {
		void loadPosthog().then((client) => {
			if (!client) return;
			try {
				client.capture(event, properties);
			} catch {
				// Analytics must never affect the product flow.
			}
		});
	},
};

export default posthog;
