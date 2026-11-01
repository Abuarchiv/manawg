import { httpIntegration } from '@sentry/nextjs';
import { initializeSentry } from './src/core/infra/sentry';

// Same options @sentry/nextjs uses for its own Http integration, minus request sessions:
// release health is not collected, and on serverless functions the session flush is cut off.
initializeSentry([httpIntegration({ disableIncomingRequestSpans: true, sessions: false })]);
