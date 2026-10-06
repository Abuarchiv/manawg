// Registers the unit-test resolver: `node --import ./tests/support/register.mjs --test ...`.
import { register } from 'node:module';

register('./resolve-hooks.mjs', import.meta.url);
