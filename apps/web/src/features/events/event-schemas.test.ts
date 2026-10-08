import assert from 'node:assert/strict';
import test from 'node:test';

const { eventDateTimeSchema, eventTitleSchema } = await import('./event-schemas');

test('event timestamps outside the supported years are rejected', () => {
	assert.equal(eventDateTimeSchema.safeParse('2026-10-05T18:00:00.000Z').success, true);
	assert.equal(eventDateTimeSchema.safeParse('1950-03-01T00:00:00.000Z').success, true);
	assert.equal(eventDateTimeSchema.safeParse('0026-10-05T18:00:00.000Z').success, false);
	assert.equal(eventDateTimeSchema.safeParse('2999-10-05T18:00:00.000Z').success, false);
	assert.equal(eventDateTimeSchema.safeParse('not a date').success, false);
});

test('event titles are trimmed and must not be blank', () => {
	assert.equal(eventTitleSchema.safeParse('   ').success, false);
	assert.equal(eventTitleSchema.parse('  Putzplan  '), 'Putzplan');
	assert.equal(eventTitleSchema.safeParse('x'.repeat(201)).success, false);
});
