#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'tools/growth-lab/inputs/mana-wg.json');
const DEFAULT_OUT = path.join(REPO_ROOT, 'tools/growth-lab/runs');
const DAY_MS = 86_400_000;
const SCENARIOS = ['pessimistic', 'base', 'optimistic'];
const HORIZONS = [30, 90, 365, 1095];
const REQUIRED_AUDIENCE_SEGMENTS = [
	'students',
	'employed residents',
	'trainees',
	'international residents',
	'other shared households',
];
const PARAMETER_PATHS = [
	['market', 'students'],
	['market', 'wgShare'],
	['market', 'maxActiveWgs'],
	['funnel', 'membersPerCreatedWg'],
	['funnel', 'actionsWithin7Days'],
	['funnel', 'activationProbability'],
	['retention', 'day30'],
	['referral', 'ratePerRetainedWgPer30Days'],
	['referral', 'multiplier'],
	['revenue', 'monthlyPerRetainedWg'],
];
const CHANNEL_PARAMETER_KEYS = [
	'reachPerDay',
	'visitRate',
	'creationRate',
	'cashCostPerDay',
	'operatorHoursPerDay',
];
const ALLOWED_ACTIONS = new Set([
	'seo',
	'content',
	'community',
	'referral',
	'organic_social',
	'paid_ads',
	'account_creation',
	'bulk_post',
	'automated_dm',
	'scrape',
	'deploy',
	'production_write',
	'email_consent',
]);
const EXTERNAL_ACTIONS = new Set([
	'community',
	'referral',
	'organic_social',
	'paid_ads',
	'account_creation',
	'bulk_post',
	'automated_dm',
	'scrape',
	'deploy',
	'production_write',
	'email_consent',
]);
const FORBIDDEN_EXECUTABLE_KEYS =
	/^(command|commands|script|scripts|callback|module|moduleRef|executable|exec|code|token|credential|password|secret|message|messageContent)$/i;
const FORBIDDEN_CALIBRATION_KEYS =
	/(^|_)(id|identifier|member|household|user|email|phone|message|token|credential|password|secret)($|_)/i;

class LabError extends Error {
	constructor(code, message, details = []) {
		super(message);
		this.name = 'LabError';
		this.code = code;
		this.details = details;
	}
}

function isObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isParameter(value) {
	return isObject(value) && ['unit', 'min', 'mode', 'max'].some((key) => key in value);
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (!isObject(value)) return JSON.stringify(value);
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
		.join(',')}}`;
}

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function getPath(root, segments) {
	return segments.reduce((value, segment) => value?.[segment], root);
}

function validDate(value) {
	return (
		typeof value === 'string' &&
		/^\d{4}-\d{2}-\d{2}$/.test(value) &&
		!Number.isNaN(Date.parse(`${value}T00:00:00Z`))
	);
}

function daysBetween(later, earlier) {
	return Math.max(
		0,
		(Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS,
	);
}

function validUrl(value) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:';
	} catch {
		return false;
	}
}

function validateParameter(value, field, asOf, errors) {
	if (!isObject(value)) {
		errors.push(`${field}: required bounded parameter object`);
		return;
	}
	for (const key of [
		'unit',
		'min',
		'mode',
		'max',
		'evidence',
		'source',
		'observedAt',
		'freshnessDays',
	]) {
		if (!(key in value)) errors.push(`${field}.${key}: required`);
	}
	if (typeof value.unit !== 'string' || !value.unit)
		errors.push(`${field}.unit: must be a non-empty string`);
	if (![value.min, value.mode, value.max].every(Number.isFinite))
		errors.push(`${field}: min/mode/max must be finite numbers`);
	if (Number.isFinite(value.min) && value.min < 0)
		errors.push(`${field}.min: must be non-negative`);
	if (
		Number.isFinite(value.min) &&
		Number.isFinite(value.mode) &&
		Number.isFinite(value.max) &&
		!(value.min <= value.mode && value.mode <= value.max)
	) {
		errors.push(`${field}: requires min <= mode <= max`);
	}
	if (value.evidence !== 'observed' && value.evidence !== 'assumed')
		errors.push(`${field}.evidence: must be observed or assumed`);
	if (!validUrl(value.source)) errors.push(`${field}.source: must be an http(s) URL`);
	if (!validDate(value.observedAt)) errors.push(`${field}.observedAt: must be YYYY-MM-DD`);
	if (!Number.isInteger(value.freshnessDays) || value.freshnessDays < 0)
		errors.push(`${field}.freshnessDays: must be a non-negative integer`);
	if (
		validDate(value.observedAt) &&
		Number.isInteger(value.freshnessDays) &&
		validDate(asOf) &&
		daysBetween(asOf, value.observedAt) < 0
	) {
		errors.push(`${field}.observedAt: cannot be later than as-of date`);
	}
}

function scanKeys(value, pattern, field, errors) {
	if (Array.isArray(value)) {
		value.forEach((item, index) => scanKeys(item, pattern, `${field}[${index}]`, errors));
		return;
	}
	if (!isObject(value)) return;
	for (const [key, child] of Object.entries(value)) {
		if (pattern.test(key)) errors.push(`${field}.${key}: prohibited sensitive or executable field`);
		scanKeys(child, pattern, `${field}.${key}`, errors);
	}
}

function validateCalibration(snapshot, errors) {
	if (snapshot.calibration === undefined) return;
	if (!Array.isArray(snapshot.calibration)) {
		errors.push('calibration: must be an array');
		return;
	}
	snapshot.calibration.forEach((observation, index) => {
		const field = `calibration[${index}]`;
		scanKeys(observation, FORBIDDEN_CALIBRATION_KEYS, field, errors);
		for (const key of [
			'path',
			'value',
			'unit',
			'measurementWindow',
			'sampleSize',
			'source',
			'observedAt',
		]) {
			if (!(key in (observation ?? {}))) errors.push(`${field}.${key}: required`);
		}
		if (typeof observation?.path !== 'string' || !observation.path)
			errors.push(`${field}.path: must be a parameter path`);
		if (!Number.isFinite(observation?.value) || observation.value < 0)
			errors.push(`${field}.value: must be a non-negative number`);
		if (typeof observation?.unit !== 'string' || !observation.unit)
			errors.push(`${field}.unit: required`);
		if (typeof observation?.measurementWindow !== 'string' || !observation.measurementWindow)
			errors.push(`${field}.measurementWindow: required`);
		if (!Number.isInteger(observation?.sampleSize) || observation.sampleSize < 1)
			errors.push(`${field}.sampleSize: must be a positive integer`);
		if (!validUrl(observation?.source)) errors.push(`${field}.source: must be an http(s) URL`);
		if (!validDate(observation?.observedAt)) errors.push(`${field}.observedAt: must be YYYY-MM-DD`);
	});
}

function validateSnapshot(snapshot, asOf = snapshot?.snapshotDate) {
	const errors = [];
	if (!isObject(snapshot)) return ['snapshot: must be an object'];
	if (snapshot.schemaVersion !== 1) errors.push('schemaVersion: must equal 1');
	if (!validDate(snapshot.snapshotDate)) errors.push('snapshotDate: must be YYYY-MM-DD');
	if (typeof snapshot.modelVersion !== 'string' || !snapshot.modelVersion)
		errors.push('modelVersion: required');
	for (const segments of PARAMETER_PATHS)
		validateParameter(getPath(snapshot, segments), segments.join('.'), asOf, errors);
	if (
		!Array.isArray(snapshot.market?.audienceSegments) ||
		!REQUIRED_AUDIENCE_SEGMENTS.every((segment) =>
			snapshot.market.audienceSegments.includes(segment),
		)
	) {
		errors.push(`market.audienceSegments: must include ${REQUIRED_AUDIENCE_SEGMENTS.join(', ')}`);
	}
	if (!Array.isArray(snapshot.channels) || snapshot.channels.length === 0) {
		errors.push('channels: must contain at least one channel');
	} else {
		const ids = new Set();
		snapshot.channels.forEach((channel, index) => {
			const field = `channels[${index}]`;
			if (!isObject(channel)) {
				errors.push(`${field}: must be an object`);
				return;
			}
			if (typeof channel.id !== 'string' || !channel.id) errors.push(`${field}.id: required`);
			if (ids.has(channel.id)) errors.push(`${field}.id: duplicate`);
			ids.add(channel.id);
			if (!['low', 'medium', 'high'].includes(channel.complianceRisk))
				errors.push(`${field}.complianceRisk: must be low, medium, or high`);
			for (const key of CHANNEL_PARAMETER_KEYS)
				validateParameter(channel[key], `${field}.${key}`, asOf, errors);
		});
	}
	const validation = snapshot.objective?.validation;
	const weights = snapshot.objective?.weights;
	if (
		!Array.isArray(snapshot.objective?.horizons) ||
		canonical(snapshot.objective.horizons) !== canonical(HORIZONS)
	)
		errors.push('objective.horizons: must be [30, 90, 365, 1095]');
	for (const key of [
		'targetActivatedWgs',
		'activationRateMin',
		'day30RetentionMin',
		'maxCashAcquisitionCost',
		'maxBudgetEur',
		'maxOperatorHours',
		'minEvidenceConfidence',
	]) {
		if (!Number.isFinite(validation?.[key]) || validation[key] < 0)
			errors.push(`objective.validation.${key}: must be non-negative`);
	}
	if (
		!isObject(weights) ||
		Object.values(weights).some((value) => !Number.isFinite(value) || value < 0) ||
		Math.abs(Object.values(weights ?? {}).reduce((sum, value) => sum + value, 0) - 1) > 0.001
	) {
		errors.push('objective.weights: must be non-negative and sum to 1');
	}
	if (!Array.isArray(snapshot.strategies) || snapshot.strategies.length === 0) {
		errors.push('strategies: must contain at least one declarative strategy');
	} else {
		const channels = new Set((snapshot.channels ?? []).map((channel) => channel.id));
		snapshot.strategies.forEach((strategy, index) => {
			const field = `strategies[${index}]`;
			scanKeys(strategy, FORBIDDEN_EXECUTABLE_KEYS, field, errors);
			if (!isObject(strategy)) {
				errors.push(`${field}: must be an object`);
				return;
			}
			if (typeof strategy.id !== 'string' || !strategy.id) errors.push(`${field}.id: required`);
			if (!channels.has(strategy.channelId)) errors.push(`${field}.channelId: unknown channel`);
			if (!Number.isFinite(strategy.budgetEur) || strategy.budgetEur < 0)
				errors.push(`${field}.budgetEur: must be non-negative`);
			if (!Number.isFinite(strategy.maxHours) || strategy.maxHours < 0)
				errors.push(`${field}.maxHours: must be non-negative`);
			if (!Array.isArray(strategy.actions) || strategy.actions.length === 0) {
				errors.push(`${field}.actions: must contain at least one action`);
			} else {
				strategy.actions.forEach((action, actionIndex) => {
					const actionField = `${field}.actions[${actionIndex}]`;
					if (!ALLOWED_ACTIONS.has(action?.kind))
						errors.push(`${actionField}.kind: unknown declarative action`);
					for (const key of ['reachMultiplier', 'cashMultiplier', 'hoursMultiplier']) {
						if (!Number.isFinite(action?.[key]) || action[key] < 0)
							errors.push(`${actionField}.${key}: must be non-negative`);
					}
				});
			}
		});
	}
	validateCalibration(snapshot, errors);
	return errors;
}

function applyCalibration(snapshot) {
	const effective = clone(snapshot);
	for (const observation of effective.calibration ?? []) {
		const segments = observation.path.split('.');
		const parameter = getPath(effective, segments);
		if (!isParameter(parameter))
			throw new LabError(
				'INPUT_INVALID',
				`calibration.${observation.path}: target is not a parameter`,
			);
		if (parameter.unit !== observation.unit)
			throw new LabError('INPUT_INVALID', `calibration.${observation.path}: unit mismatch`);
		const minSampleSize = Number.isInteger(observation.minSampleSize)
			? observation.minSampleSize
			: 30;
		parameter.mode = observation.value;
		parameter.evidence = 'observed';
		parameter.source = observation.source;
		parameter.observedAt = observation.observedAt;
		parameter.freshnessDays = 90;
		parameter.calibration = {
			measurementWindow: observation.measurementWindow,
			sampleSize: observation.sampleSize,
			confidence: observation.sampleSize >= minSampleSize ? 'adequate' : 'low',
		};
		if (observation.sampleSize >= minSampleSize) {
			parameter.min = Math.max(parameter.min, observation.value * 0.75);
			parameter.max = Math.max(parameter.min, Math.min(parameter.max, observation.value * 1.25));
		}
	}
	return effective;
}

function parameterEntries(snapshot) {
	const entries = PARAMETER_PATHS.map((segments) => ({
		path: segments.join('.'),
		value: getPath(snapshot, segments),
	}));
	for (const [index, channel] of (snapshot.channels ?? []).entries()) {
		for (const key of CHANNEL_PARAMETER_KEYS)
			entries.push({ path: `channels[${index}].${key}`, value: channel[key] });
	}
	return entries;
}

function sourceInfo(snapshot, asOf) {
	const sources = new Map();
	for (const entry of parameterEntries(snapshot)) {
		const parameter = entry.value;
		if (!isParameter(parameter)) continue;
		const stale = daysBetween(asOf, parameter.observedAt) > parameter.freshnessDays;
		const current = sources.get(parameter.source) ?? {
			url: parameter.source,
			stale: false,
			paths: [],
		};
		current.stale ||= stale;
		current.paths.push(entry.path);
		sources.set(parameter.source, current);
	}
	return [...sources.values()].sort((a, b) => a.url.localeCompare(b.url));
}

function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function sampleParameter(parameter, random, scenario) {
	const a =
		scenario === 'pessimistic'
			? parameter.min
			: scenario === 'optimistic'
				? parameter.mode
				: parameter.min;
	const c =
		scenario === 'pessimistic'
			? parameter.mode
			: scenario === 'optimistic'
				? parameter.max
				: parameter.max;
	const b =
		scenario === 'pessimistic'
			? parameter.min
			: scenario === 'optimistic'
				? parameter.max
				: parameter.mode;
	if (a === c) return a;
	const u = random();
	const split = (b - a) / (c - a);
	return u < split
		? a + Math.sqrt(u * (b - a) * (c - a))
		: c - Math.sqrt((1 - u) * (c - b) * (c - a));
}

function round(value) {
	return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function clamp(value, min = 0, max = 1) {
	return Math.min(max, Math.max(min, value));
}

function quantile(values, fraction) {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return round(sorted[lower]);
	return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}

function actionMultipliers(strategy) {
	return strategy.actions.reduce(
		(result, action) => ({
			reach: result.reach * action.reachMultiplier,
			cash: result.cash * action.cashMultiplier,
			hours: result.hours * action.hoursMultiplier,
		}),
		{ reach: 1, cash: 1, hours: 1 },
	);
}

function oneSimulation(snapshot, strategy, scenario, horizons, random, checkRuntime) {
	const channel = snapshot.channels.find((candidate) => candidate.id === strategy.channelId);
	const multipliers = actionMultipliers(strategy);
	const reach = sampleParameter(channel.reachPerDay, random, scenario) * multipliers.reach;
	const visitRate = sampleParameter(channel.visitRate, random, scenario);
	const creationRate = sampleParameter(channel.creationRate, random, scenario);
	const cashCost = sampleParameter(channel.cashCostPerDay, random, scenario) * multipliers.cash;
	const operatorHours =
		sampleParameter(channel.operatorHoursPerDay, random, scenario) * multipliers.hours;
	const members = sampleParameter(snapshot.funnel.membersPerCreatedWg, random, scenario);
	const actions = sampleParameter(snapshot.funnel.actionsWithin7Days, random, scenario);
	const activationProbability = sampleParameter(
		snapshot.funnel.activationProbability,
		random,
		scenario,
	);
	const retention = sampleParameter(snapshot.retention.day30, random, scenario);
	const referralRate = sampleParameter(
		snapshot.referral.ratePerRetainedWgPer30Days,
		random,
		scenario,
	);
	const referralMultiplier = sampleParameter(snapshot.referral.multiplier, random, scenario);
	const monthlyRevenue = sampleParameter(snapshot.revenue.monthlyPerRetainedWg, random, scenario);
	const marketWgCeiling = sampleParameter(snapshot.market.maxActiveWgs, random, scenario);
	const activationCriteriaMet = members >= 3 && actions >= 2;
	const activationRate = activationCriteriaMet ? activationProbability : 0;
	const marketCapacity = marketWgCeiling;
	const results = {};
	let createdWgs = 0;
	let activatedWgs = 0;
	let cash = 0;
	let hours = 0;
	let revenue = 0;
	const maxHorizon = Math.max(...horizons);
	for (let day = 1; day <= maxHorizon; day += 1) {
		checkRuntime();
		const retainedActive = day >= 30 ? activatedWgs * retention : 0;
		const referralWgs = (retainedActive * referralRate * referralMultiplier) / 30;
		const directWgs = reach * visitRate * creationRate;
		const available = Math.max(0, marketCapacity - createdWgs);
		const newWgs = Math.min(available, directWgs + referralWgs);
		const newActivated = activationCriteriaMet ? newWgs * activationRate : 0;
		createdWgs += newWgs;
		activatedWgs += newActivated;
		cash += cashCost;
		hours += operatorHours;
		revenue += (retainedActive * monthlyRevenue) / 30;
		if (horizons.includes(day)) {
			const retainedWgs = day >= 30 ? activatedWgs * retention : 0;
			results[day] = {
				createdWgs,
				activatedWgs,
				activationRate: createdWgs ? activatedWgs / createdWgs : 0,
				day30Retention: retention,
				retainedWgs,
				cashCost: cash,
				cashAcquisitionCost: activatedWgs ? cash / activatedWgs : cash,
				operatorHours: hours,
				revenue,
				contributionMargin: revenue - cash,
			};
		}
	}
	return results;
}

function aggregateSimulation(snapshot, strategy, iterations, seed, horizons, checkRuntime) {
	const scenarioResults = {};
	for (const [scenarioIndex, scenario] of SCENARIOS.entries()) {
		const random = mulberry32(seed + scenarioIndex * 1_000_003 + strategy.id.length * 97);
		const metricValues = Object.fromEntries(horizons.map((horizon) => [horizon, {}]));
		for (let iteration = 0; iteration < iterations; iteration += 1) {
			checkRuntime();
			const run = oneSimulation(snapshot, strategy, scenario, horizons, random, checkRuntime);
			for (const horizon of horizons) {
				for (const [metric, value] of Object.entries(run[horizon])) {
					if (!metricValues[horizon][metric]) metricValues[horizon][metric] = [];
					metricValues[horizon][metric].push(value);
				}
			}
		}
		const aggregate = {};
		for (const horizon of horizons) {
			aggregate[horizon] = {};
			for (const [metric, values] of Object.entries(metricValues[horizon])) {
				aggregate[horizon][metric] = {
					p10: quantile(values, 0.1),
					p50: quantile(values, 0.5),
					p90: quantile(values, 0.9),
				};
			}
		}
		scenarioResults[scenario] = { horizons: aggregate };
	}
	return scenarioResults;
}

function strategyEvidence(snapshot, strategy, asOf) {
	const channelIndex = snapshot.channels.findIndex((channel) => channel.id === strategy.channelId);
	const paths = [
		'market.maxActiveWgs',
		'funnel.membersPerCreatedWg',
		'funnel.actionsWithin7Days',
		'funnel.activationProbability',
		'retention.day30',
		'referral.ratePerRetainedWgPer30Days',
		'referral.multiplier',
		'revenue.monthlyPerRetainedWg',
		...CHANNEL_PARAMETER_KEYS.map((key) => `channels[${channelIndex}].${key}`),
	];
	const entries = parameterEntries(snapshot);
	const byPath = new Map(entries.map((entry) => [entry.path, entry.value]));
	const used = paths
		.map((parameterPath) => ({ path: parameterPath, value: byPath.get(parameterPath) }))
		.filter((entry) => isParameter(entry.value));
	const observed = used.filter((entry) => entry.value.evidence === 'observed').length;
	const staleSources = sourceInfo(snapshot, asOf).filter(
		(source) => source.stale && used.some((entry) => entry.value.source === source.url),
	);
	return {
		paths: used.map((entry) => entry.path),
		observed,
		total: used.length,
		confidence: used.length ? observed / used.length : 0,
		staleSources: staleSources.map((source) => source.url),
	};
}

function rankStrategies(snapshot, strategyResults, asOf) {
	const validation = snapshot.objective.validation;
	const weights = snapshot.objective.weights;
	const rankings = strategyResults.map((result) => {
		const strategy = snapshot.strategies.find((candidate) => candidate.id === result.id);
		const channel = snapshot.channels.find((candidate) => candidate.id === strategy.channelId);
		const evidence = strategyEvidence(snapshot, strategy, asOf);
		const base = result.scenarios.base.horizons[30];
		const failures = [];
		if (base.activatedWgs.p50 < validation.targetActivatedWgs)
			failures.push(
				`activated WGs P50 ${base.activatedWgs.p50} < ${validation.targetActivatedWgs}`,
			);
		if (base.activationRate.p50 < validation.activationRateMin)
			failures.push(`activation P50 ${base.activationRate.p50} < ${validation.activationRateMin}`);
		if (base.day30Retention.p50 < validation.day30RetentionMin)
			failures.push(
				`day-30 retention P50 ${base.day30Retention.p50} < ${validation.day30RetentionMin}`,
			);
		if (base.cashAcquisitionCost.p90 > validation.maxCashAcquisitionCost)
			failures.push(
				`cash CAC P90 ${base.cashAcquisitionCost.p90} > ${validation.maxCashAcquisitionCost}`,
			);
		if (base.cashCost.p90 > validation.maxBudgetEur)
			failures.push(`cash cost P90 ${base.cashCost.p90} > ${validation.maxBudgetEur}`);
		if (base.operatorHours.p90 > validation.maxOperatorHours)
			failures.push(
				`operator hours P90 ${base.operatorHours.p90} > ${validation.maxOperatorHours}`,
			);
		if (evidence.confidence < validation.minEvidenceConfidence)
			failures.push(
				`evidence confidence ${round(evidence.confidence)} < ${validation.minEvidenceConfidence}`,
			);
		if (evidence.staleSources.length) failures.push('depends on stale source evidence');
		const externalAction =
			channel.externalAction ||
			strategy.actions.some((action) => EXTERNAL_ACTIONS.has(action.kind));
		if (externalAction) failures.push('requires approval for external platform action');
		if (channel.complianceRisk === 'high') failures.push('high compliance risk');
		const scoreParts = {
			activatedWgs: clamp(base.activatedWgs.p50 / Math.max(validation.targetActivatedWgs, 1)),
			day30Retention: clamp(
				base.day30Retention.p50 / Math.max(validation.day30RetentionMin, 0.001),
			),
			cashAcquisitionCost:
				base.cashAcquisitionCost.p50 === 0
					? 1
					: clamp(
							1 - base.cashAcquisitionCost.p50 / Math.max(validation.maxCashAcquisitionCost, 0.001),
						),
			operatorHours: clamp(1 - base.operatorHours.p50 / Math.max(validation.maxOperatorHours, 1)),
			contributionMargin: clamp(
				0.5 + base.contributionMargin.p50 / Math.max(validation.maxBudgetEur * 2, 1),
			),
			evidenceConfidence: evidence.confidence,
		};
		const score = Object.entries(scoreParts).reduce(
			(sum, [key, value]) => sum + value * (weights[key] ?? 0),
			0,
		);
		return {
			id: result.id,
			label: result.label,
			channel: channel.name,
			score: round(score),
			eligible: failures.length === 0,
			failures,
			evidence,
			scoreParts,
			gateMetrics: {
				activatedWgs: base.activatedWgs.p50,
				activationRate: base.activationRate.p50,
				day30Retention: base.day30Retention.p50,
				cashAcquisitionCost: base.cashAcquisitionCost.p90,
				cashCost: base.cashCost.p90,
				operatorHours: base.operatorHours.p90,
			},
		};
	});
	return rankings
		.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score)
		.map((ranking, index) => ({ ...ranking, rank: index + 1 }));
}

function sensitivity(snapshot) {
	return parameterEntries(snapshot)
		.map((entry) => ({
			parameter: entry.path,
			relativeRange:
				entry.value.max === 0
					? 0
					: round(
							(entry.value.max - entry.value.min) / Math.max(Math.abs(entry.value.mode), 0.001),
						),
			evidence: entry.value.evidence,
			source: entry.value.source,
		}))
		.sort((a, b) => b.relativeRange - a.relativeRange)
		.slice(0, 5);
}

function recommendations(snapshot, rankings) {
	return rankings.slice(0, 3).map((ranking) => {
		const strategy = snapshot.strategies.find((candidate) => candidate.id === ranking.id);
		const channel = snapshot.channels.find((candidate) => candidate.id === strategy.channelId);
		const approval =
			channel.externalAction ||
			strategy.actions.some((action) => EXTERNAL_ACTIONS.has(action.kind));
		return {
			strategyId: strategy.id,
			targetSegment: channel.segment,
			channel: channel.name,
			hypothesis: `${channel.name} can produce activated WGs below the configured EUR ${snapshot.objective.validation.maxCashAcquisitionCost} cash CAC limit.`,
			durationDays: 30,
			cashBudgetEur: strategy.budgetEur,
			timeBudgetHours: strategy.maxHours,
			successThreshold: {
				activatedWgs: snapshot.objective.validation.targetActivatedWgs,
				activationRate: snapshot.objective.validation.activationRateMin,
				day30Retention: snapshot.objective.validation.day30RetentionMin,
				maxCashAcquisitionCost: snapshot.objective.validation.maxCashAcquisitionCost,
			},
			stopCondition:
				'Stop if a policy, consent, privacy, or budget guard is breached, or if the success threshold is not reached by day 30.',
			ready: ranking.eligible,
			requiredApproval: approval
				? 'Human approval and platform-compliant execution are required; the simulator performs no external action.'
				: 'No external action is performed by the simulator; review the proposal before execution.',
			blockers: ranking.failures,
		};
	});
}

function buildResult(snapshot, options = {}) {
	const asOf = options.asOf ?? snapshot.snapshotDate;
	const inputHash = sha256(canonical({ snapshot, asOf }));
	const started = Date.now();
	const maxMs = options.maxMs ?? 15_000;
	const checkRuntime = () => {
		if (Date.now() - started > maxMs)
			throw new LabError('TIME_LIMIT', `runtime limit of ${maxMs}ms reached`);
	};
	const seed = options.seed ?? 20260902;
	const iterations = options.iterations ?? 1000;
	const horizons = snapshot.objective.horizons;
	const results = snapshot.strategies.map((strategy) => {
		checkRuntime();
		return {
			id: strategy.id,
			label: strategy.label,
			scenarios: aggregateSimulation(snapshot, strategy, iterations, seed, horizons, checkRuntime),
		};
	});
	const ranking = rankStrategies(snapshot, results, asOf);
	const sources = sourceInfo(snapshot, asOf);
	const staleSources = sources.filter((source) => source.stale).map((source) => source.url);
	const evidence = parameterEntries(snapshot).map((entry) => ({
		parameter: entry.path,
		evidence: entry.value.evidence,
		source: entry.value.source,
		observedAt: entry.value.observedAt,
		freshnessDays: entry.value.freshnessDays,
		unit: entry.value.unit,
		range: { min: entry.value.min, mode: entry.value.mode, max: entry.value.max },
	}));
	return {
		schemaVersion: 1,
		modelVersion: snapshot.modelVersion,
		dataTimestamp: snapshot.snapshotDate,
		asOf,
		inputHash,
		seed,
		iterations,
		horizons,
		audienceSegments: snapshot.market.audienceSegments,
		freshness: {
			state: staleSources.length ? 'stale-evidence-present' : 'current-by-policy',
			staleSources,
		},
		sourceRefresh: snapshot.sourceRefresh ?? null,
		evidence,
		strategies: results,
		ranking,
		sensitivityDrivers: sensitivity(snapshot),
		recommendations: recommendations(snapshot, ranking),
		nextEvidenceGap: ranking.some((item) => item.eligible)
			? null
			: {
					parameter: sensitivity(snapshot)[0]?.parameter ?? 'funnel.activationProbability',
					action:
						'Measure the first-party funnel from visit to WG creation, three-member join, two shared actions, and day-30 retention.',
					reason: 'No strategy currently clears every hard gate with sufficient evidence.',
				},
		limitations: [
			'This is a seeded range simulation, not observed demand or a causal marketing result.',
			'Reach, ranking, conversion, activation, retention, referral, willingness to pay, moderation response, and causal lift require controlled real-world experiments.',
			'Stale sources remain visible and their dependent conclusions are not ready for experiment approval.',
			'All recommendations are proposals; no account, post, message, ad, deployment, or production write is executed.',
		],
	};
}

function markdownReport(result) {
	const winner = result.ranking.find((item) => item.eligible);
	const lines = [
		'# ManaWG Growth Lab',
		'',
		`- Data timestamp: ${result.dataTimestamp}`,
		`- As of: ${result.asOf}`,
		`- Model: ${result.modelVersion}`,
		`- Input hash: \`${result.inputHash}\``,
		`- Seed / iterations: ${result.seed} / ${result.iterations}`,
		`- Horizons: ${result.horizons.join(', ')} days`,
		`- Audience: ${result.audienceSegments.join(', ')}`,
		`- Freshness: ${result.freshness.state}`,
		...(result.sourceRefresh
			? [
					`- Live source refresh: ${result.sourceRefresh.fetchedAt}`,
					`- Live sources checked: ${result.sourceRefresh.sources.length}`,
				]
			: []),
		'',
		winner ? `## Current simulated leader: ${winner.label}` : '## No validated simulated winner',
		'',
		'Ranking uses base-scenario P50 metrics for the configured gates; ranges remain in the JSON output.',
		'',
		'| Rank | Strategy | Eligible | Score | Activated WGs | Activation | Day-30 retention | Cash CAC |',
		'| ---: | --- | :---: | ---: | ---: | ---: | ---: | ---: |',
	];
	for (const item of result.ranking) {
		lines.push(
			`| ${item.rank} | ${item.label} | ${item.eligible ? 'yes' : 'no'} | ${item.score} | ${item.gateMetrics.activatedWgs} | ${item.gateMetrics.activationRate} | ${item.gateMetrics.day30Retention} | ${item.gateMetrics.cashAcquisitionCost} |`,
		);
	}
	lines.push('', '## Recommendations', '');
	result.recommendations.forEach((recommendation, index) => {
		lines.push(
			`${index + 1}. **${recommendation.channel}** — ${recommendation.targetSegment}. Ready: **${recommendation.ready ? 'yes' : 'no'}**. Budget: EUR ${recommendation.cashBudgetEur}, ${recommendation.timeBudgetHours} hours. Approval: ${recommendation.requiredApproval}`,
		);
	});
	if (result.nextEvidenceGap)
		lines.push(
			'',
			'## Next evidence gap',
			'',
			`- **${result.nextEvidenceGap.parameter}**: ${result.nextEvidenceGap.action}`,
		);
	lines.push(
		'',
		'## Sensitivity drivers',
		'',
		...result.sensitivityDrivers.map(
			(driver) =>
				`- ${driver.parameter}: relative range ${driver.relativeRange} (${driver.evidence})`,
		),
	);
	lines.push(
		'',
		'## Freshness and sources',
		'',
		...result.freshness.staleSources.map((source) => `- **stale:** ${source}`),
	);
	lines.push(
		...result.evidence
			.filter((entry) => !result.freshness.staleSources.includes(entry.source))
			.slice(0, 8)
			.map(
				(entry) =>
					`- ${entry.parameter}: ${entry.evidence}, observed ${entry.observedAt} — ${entry.source}`,
			),
	);
	lines.push(
		...(result.sourceRefresh
			? [
					'',
					'## Live source checks',
					'',
					...result.sourceRefresh.sources.map(
						(source) =>
							`- ${source.id}: ${source.status}, HTTP ${source.httpStatus}, ${source.responseBytes} bytes, fetched ${source.fetchedAt} — ${source.url}`,
					),
				]
			: []),
		'',
		'## Limitations',
		'',
		...result.limitations.map((limitation) => `- ${limitation}`),
		'',
	);
	return lines.join('\n');
}

function writeAtomic(file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	const fd = fs.openSync(temporary, 'w');
	try {
		fs.writeFileSync(fd, content);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(temporary, file);
}

function appendIndex(outDir, record) {
	fs.mkdirSync(outDir, { recursive: true });
	fs.appendFileSync(path.join(outDir, 'index.jsonl'), `${JSON.stringify(record)}\n`);
}

function parseArgs(argv) {
	const options = {
		input: DEFAULT_INPUT,
		out: DEFAULT_OUT,
		seed: 20260902,
		iterations: 1000,
		maxMs: 15_000,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--') continue;
		if (argument === '--help' || argument === '-h') options.help = true;
		else if (argument.startsWith('--input=')) options.input = argument.slice(8);
		else if (argument === '--input') options.input = argv[++index];
		else if (argument.startsWith('--out=')) options.out = argument.slice(6);
		else if (argument === '--out') options.out = argv[++index];
		else if (argument.startsWith('--seed=')) options.seed = Number(argument.slice(7));
		else if (argument === '--seed') options.seed = Number(argv[++index]);
		else if (argument.startsWith('--iterations=')) options.iterations = Number(argument.slice(13));
		else if (argument === '--iterations') options.iterations = Number(argv[++index]);
		else if (argument.startsWith('--max-ms=')) options.maxMs = Number(argument.slice(9));
		else if (argument === '--max-ms') options.maxMs = Number(argv[++index]);
		else if (argument.startsWith('--as-of=')) options.asOf = argument.slice(8);
		else if (argument === '--as-of') options.asOf = argv[++index];
		else throw new LabError('CLI_INVALID', `unknown argument ${argument}`);
	}
	if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 4_294_967_295)
		throw new LabError('CLI_INVALID', 'seed must be an unsigned 32-bit integer');
	if (
		!Number.isInteger(options.iterations) ||
		options.iterations < 1 ||
		options.iterations > 100_000
	)
		throw new LabError('CLI_INVALID', 'iterations must be between 1 and 100000');
	if (!Number.isInteger(options.maxMs) || options.maxMs < 1 || options.maxMs > 600_000)
		throw new LabError('CLI_INVALID', 'max-ms must be between 1 and 600000');
	return options;
}

function help() {
	return 'ManaWG Growth Lab\n\nUsage: pnpm growth:simulate -- [options]\n\nOptions:\n  --input <file>       Versioned JSON snapshot (default: tools/growth-lab/inputs/mana-wg.json)\n  --out <directory>    Generated output directory (default: tools/growth-lab/runs)\n  --seed <uint32>      Deterministic seed (default: 20260902)\n  --iterations <n>     Monte Carlo iterations (default: 1000)\n  --max-ms <n>         Runtime limit (default: 15000)\n  --as-of <date>       Freshness comparison date (default: snapshotDate)\n  --help               Show this help\n';
}

function runCli(options) {
	const outDir = path.resolve(options.out);
	fs.mkdirSync(outDir, { recursive: true });
	const lockPath = path.join(outDir, '.lock');
	let runId = 'unidentified';
	let lockFd;
	try {
		const raw = JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8'));
		const asOf = options.asOf ?? raw.snapshotDate;
		let errors = validateSnapshot(raw, asOf);
		if (errors.length) throw new LabError('INPUT_INVALID', 'snapshot validation failed', errors);
		const snapshot = applyCalibration(raw);
		errors = validateSnapshot(snapshot, asOf);
		if (errors.length)
			throw new LabError('INPUT_INVALID', 'effective snapshot validation failed', errors);
		const inputHash = sha256(canonical({ snapshot, asOf }));
		runId =
			`${snapshot.modelVersion}-${inputHash.slice(0, 16)}-${options.seed}-${options.iterations}`.replace(
				/[^a-zA-Z0-9._-]/g,
				'_',
			);
		try {
			lockFd = fs.openSync(lockPath, 'wx');
			fs.writeFileSync(
				lockFd,
				JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
			);
		} catch (error) {
			if (error.code === 'EEXIST')
				throw new LabError('LOCKED', 'another growth simulation is already running');
			throw error;
		}
		const result = buildResult(snapshot, options);
		const jsonPath = path.join(outDir, `${runId}.json`);
		const reportPath = path.join(outDir, `${runId}.md`);
		const json = `${JSON.stringify(result, null, 2)}\n`;
		if (!fs.existsSync(jsonPath)) writeAtomic(jsonPath, json);
		if (!fs.existsSync(reportPath)) writeAtomic(reportPath, `${markdownReport(result)}\n`);
		writeAtomic(path.join(outDir, 'last-success.json'), json);
		appendIndex(outDir, {
			runId,
			status: 'success',
			result: path.basename(jsonPath),
			report: path.basename(reportPath),
			inputHash,
			seed: options.seed,
			iterations: options.iterations,
		});
		return { runId, result: jsonPath, report: reportPath };
	} catch (error) {
		if (error.code !== 'LOCKED') {
			appendIndex(outDir, {
				runId,
				status: 'failure',
				code: error.code ?? 'ERROR',
				message: error.message,
				details: error.details ?? [],
			});
		}
		throw error;
	} finally {
		if (lockFd !== undefined) {
			fs.closeSync(lockFd);
			fs.unlinkSync(lockPath);
		}
	}
}

function main() {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (options.help) {
			process.stdout.write(help());
			return;
		}
		const result = runCli(options);
		process.stdout.write(`${JSON.stringify({ status: 'success', ...result })}\n`);
	} catch (error) {
		const payload = {
			status: 'failure',
			code: error.code ?? 'ERROR',
			message: error.message,
			details: error.details ?? [],
		};
		process.stderr.write(`${JSON.stringify(payload)}\n`);
		process.exitCode = error.code === 'LOCKED' ? 2 : 1;
	}
}

export { applyCalibration, buildResult, canonical, runCli, validateSnapshot };

if (import.meta.url === `file://${process.argv[1]}`) main();
