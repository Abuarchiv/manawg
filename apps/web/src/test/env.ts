/**
 * Removes an environment variable, for tests that need to observe how the code
 * behaves when it is genuinely not set.
 *
 * `delete` is the only way to do that. Biome's `lint/performance/noDelete`
 * suggests `process.env.X = undefined` instead, which is wrong here:
 * `process.env` coerces every value to a string, so the assignment stores the
 * literal `"undefined"` and the variable stays set. Code that only checks for
 * presence then takes the branch the test was written to rule out.
 *
 * The rule guards hot paths against deoptimised object shapes, which does not
 * apply to a handful of statements in a test setup. Routing the deletes through
 * this one function keeps the reasoning in a single place — and, since the rule
 * only fires on statically named properties, keeps the call sites clean.
 */
export function unsetEnvVar(name: string): void {
	delete process.env[name];
}
