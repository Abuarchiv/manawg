import '@testing-library/jest-dom';
import { vi } from 'vitest';

// 'server-only' is a sentinel module that throws when imported from a client
// bundle. Tests run in a jsdom env and load both server + client code; mock it
// out so any chat-server.ts (and similar) import resolves to a no-op.
vi.mock('server-only', () => ({}));
