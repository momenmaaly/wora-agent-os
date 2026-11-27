/**
 * WORA OS — Bayesian uncertainty intelligence.
 *
 * Conjugate Beta–Binomial and Normal–Normal updates with explicit priors,
 * posterior parameters, credible intervals and prior-sensitivity checks.
 * Results are posterior calculations under the declared model; they are not
 * calibrated guarantees about the real world.
 */
import type { ScientificVerification } from './scientific-verification.js';

export const BAYES_SCHEMA_VERSION = '1.0';
const TOLERANCE = 1e-7;

export interface BetaBinomialModel {
  type: 'beta_binomial';
  prior: { alpha: number; beta: number };
  successes: number;
  trials: number;
  credibleLevel?: number;
  alternativePriors?: Array<{ label?: string; alpha: number; beta: number }>;
}

export interface NormalNormalModel {
  type: 'normal_normal';
  prior: { mean: number; sd: number };
  observations: number[];
  knownSd: number;
  credibleLevel?: number;
  alternativePriors?: Array<{ label?: string; mean: number; sd: number }>;
}

export type BayesModel = BetaBinomialModel | NormalNormalModel;

export interface BayesVariant {
  label: string;
  posteriorMean: number;
  lower: number;
  upper: number;
}

export interface BayesResult {
  schemaVersion: typeof BAYES_SCHEMA_VERSION;
  status: 'optimal' | 'infeasible' | 'unverified';
  modelType: BayesModel['type'];
  posterior: Record<string, number>;
  credibleInterval: { level: number; lower: number; upper: number };
  predictive: number | null;
  posteriorProbabilityAbove: number | null;
  priorSensitivity: { provided: boolean; variants: BayesVariant[]; maxMeanShift: number | null; note: string };
  verification: ScientificVerification;
  limitations: string[];
}

function emptyVerification(): ScientificVerification {
  return { schemaVersion: '1.0', passed: true, checks: [], failures: [], tolerance: TOLERANCE };
}

function add(result: ScientificVerification, id: string, description: string, passed: boolean, evidence: string): void {
  result.checks.push({ id, description, status: passed ? 'passed' : 'failed', evidence });
  if (!passed) result.failures.push(`${id}: ${evidence}`);
  result.passed = result.failures.length === 0;
}

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = 0.99999999999980993;
  const zz = z - 1;
  for (let i = 0; i < LANCZOS.length; i++) x += LANCZOS[i]! / (zz + i + 1);
  const t = zz + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}
const logBeta = (a: number, b: number): number => logGamma(a) + logGamma(b) - logGamma(a + b);

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const fpMin = 1e-300;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(x, a, b)) / a;
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < p) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

function normalQuantile(p: number): number {
  // Acklam's inverse normal CDF approximation.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function validate(model: BayesModel): string[] {
  const errors: string[] = [];
  const level = model.credibleLevel ?? 0.95;
  if (!Number.isFinite(level) || level <= 0.5 || level >= 1) errors.push('credibleLevel must be between 0.5 and 1');
  if (model.type === 'beta_binomial') {
    if (!Number.isFinite(model.prior.alpha) || model.prior.alpha <= 0) errors.push('prior alpha must be positive');
    if (!Number.isFinite(model.prior.beta) || model.prior.beta <= 0) errors.push('prior beta must be positive');
    if (!Number.isInteger(model.trials) || model.trials < 0) errors.push('trials must be a non-negative integer');
    if (!Number.isInteger(model.successes) || model.successes < 0 || model.successes > model.trials) errors.push('successes must be an integer between 0 and trials');
    for (const prior of model.alternativePriors ?? []) {
      if (!Number.isFinite(prior.alpha) || prior.alpha <= 0 || !Number.isFinite(prior.beta) || prior.beta <= 0) errors.push('alternative beta priors need positive alpha and beta');
    }
  } else {
    if (!Number.isFinite(model.prior.mean)) errors.push('prior mean must be finite');
    if (!Number.isFinite(model.prior.sd) || model.prior.sd <= 0) errors.push('prior sd must be positive');
    if (!Number.isFinite(model.knownSd) || model.knownSd <= 0) errors.push('knownSd must be positive');
    if (!Array.isArray(model.observations) || model.observations.length === 0 || !model.observations.every(Number.isFinite)) errors.push('at least one finite observation is required');
    for (const prior of model.alternativePriors ?? []) {
      if (!Number.isFinite(prior.mean) || !Number.isFinite(prior.sd) || prior.sd <= 0) errors.push('alternative normal priors need a finite mean and positive sd');
    }
  }
  return [...new Set(errors)];
}

function betaPosterior(alpha: number, beta: number, successes: number, trials: number): Record<string, number> {
  const postAlpha = alpha + successes;
  const postBeta = beta + trials - successes;
  const mean = postAlpha / (postAlpha + postBeta);
  const variance = (postAlpha * postBeta) / ((postAlpha + postBeta) ** 2 * (postAlpha + postBeta + 1));
  return { alpha: postAlpha, beta: postBeta, mean, variance, sd: Math.sqrt(variance) };
}

function normalPosterior(priorMean: number, priorSd: number, observations: number[], knownSd: number): Record<string, number> {
  const n = observations.length;
  const sampleMean = observations.reduce((sum, value) => sum + value, 0) / n;
  const priorPrecision = 1 / (priorSd * priorSd);
  const dataPrecision = n / (knownSd * knownSd);
  const precision = priorPrecision + dataPrecision;
  const mean = (priorPrecision * priorMean + dataPrecision * sampleMean) / precision;
  const sd = Math.sqrt(1 / precision);
  return { mean, sd, variance: sd * sd, priorPrecision, dataPrecision, sampleMean, n };
}

function betaVariant(prior: { alpha: number; beta: number; label?: string }, successes: number, trials: number, level: number): BayesVariant {
  const posterior = betaPosterior(prior.alpha, prior.beta, successes, trials);
  return {
    label: prior.label ?? `Beta(${prior.alpha}, ${prior.beta})`,
    posteriorMean: round(posterior['mean']!),
    lower: round(betaQuantile((1 - level) / 2, posterior['alpha']!, posterior['beta']!)),
    upper: round(betaQuantile(1 - (1 - level) / 2, posterior['alpha']!, posterior['beta']!)),
  };
}

function normalVariant(prior: { mean: number; sd: number; label?: string }, observations: number[], knownSd: number, level: number): BayesVariant {
  const posterior = normalPosterior(prior.mean, prior.sd, observations, knownSd);
  const z = normalQuantile(1 - (1 - level) / 2);
  return {
    label: prior.label ?? `Normal(${prior.mean}, ${prior.sd})`,
    posteriorMean: round(posterior['mean']!),
    lower: round(posterior['mean']! - z * posterior['sd']!),
    upper: round(posterior['mean']! + z * posterior['sd']!),
  };
}

export function verifyBayes(model: BayesModel, result: BayesResult): ScientificVerification {
  const verification = emptyVerification();
  if (result.status === 'infeasible') {
    add(verification, 'model-status', 'The Bayesian model is infeasible', true, 'invalid model reported explicitly');
    return verification;
  }
  const level = model.credibleLevel ?? 0.95;
  if (model.type === 'beta_binomial') {
    const expected = betaPosterior(model.prior.alpha, model.prior.beta, model.successes, model.trials);
    add(verification, 'posterior-parameters', 'Posterior alpha and beta equal prior plus data', Math.abs(result.posterior['alpha']! - expected['alpha']!) <= 1e-9 && Math.abs(result.posterior['beta']! - expected['beta']!) <= 1e-9, `alpha=${result.posterior['alpha']}; beta=${result.posterior['beta']}`);
    add(verification, 'posterior-mean', 'Posterior mean equals alpha/(alpha+beta)', Math.abs(result.posterior['mean']! - expected['mean']!) <= 1e-6, `mean=${result.posterior['mean']}`);
    add(verification, 'credible-interval', 'Credible interval contains the posterior mean', result.credibleInterval.lower <= result.posterior['mean']! + 1e-9 && result.credibleInterval.upper + 1e-9 >= result.posterior['mean']!, `interval=[${result.credibleInterval.lower}, ${result.credibleInterval.upper}]`);
    add(verification, 'credible-level', 'The requested credible level is recorded', Math.abs(result.credibleInterval.level - level) <= 1e-12, `level=${result.credibleInterval.level}`);
    const recomputedProbability = 1 - regularizedIncompleteBeta(0.5, result.posterior['alpha']!, result.posterior['beta']!);
    add(verification, 'posterior-probability', 'P(theta > 0.5) is recomputed from the posterior Beta distribution', result.posteriorProbabilityAbove !== null && Math.abs(result.posteriorProbabilityAbove - recomputedProbability) <= 1e-6, `reported=${String(result.posteriorProbabilityAbove)}; recomputed=${round(recomputedProbability)}`);
    add(verification, 'predictive', 'The posterior predictive probability equals the posterior mean', result.predictive !== null && Math.abs(result.predictive - expected['mean']!) <= 1e-6, `predictive=${String(result.predictive)}`);
  } else {
    const expected = normalPosterior(model.prior.mean, model.prior.sd, model.observations, model.knownSd);
    add(verification, 'posterior-mean', 'Normal posterior mean equals the precision-weighted mean', Math.abs(result.posterior['mean']! - expected['mean']!) <= 1e-6, `mean=${result.posterior['mean']}`);
    add(verification, 'posterior-sd', 'Normal posterior sd equals sqrt(1/precision)', Math.abs(result.posterior['sd']! - expected['sd']!) <= 1e-6, `sd=${result.posterior['sd']}`);
    add(verification, 'credible-interval', 'Credible interval contains the posterior mean', result.credibleInterval.lower <= result.posterior['mean']! + 1e-9 && result.credibleInterval.upper + 1e-9 >= result.posterior['mean']!, `interval=[${result.credibleInterval.lower}, ${result.credibleInterval.upper}]`);
    add(verification, 'credible-level', 'The requested credible level is recorded', Math.abs(result.credibleInterval.level - level) <= 1e-12, `level=${result.credibleInterval.level}`);
  }
  add(verification, 'prior-sensitivity', 'Prior sensitivity is either computed or explicitly marked as not assessed', result.priorSensitivity.provided ? result.priorSensitivity.variants.length > 0 : result.priorSensitivity.variants.length === 0, `variants=${result.priorSensitivity.variants.length}; provided=${result.priorSensitivity.provided}`);
  return verification;
}

export function solveBayes(model: BayesModel): BayesResult {
  const errors = validate(model);
  if (errors.length) {
    return {
      schemaVersion: BAYES_SCHEMA_VERSION, status: 'infeasible', modelType: model.type, posterior: {}, credibleInterval: { level: 0.95, lower: 0, upper: 0 }, predictive: null, posteriorProbabilityAbove: null,
      priorSensitivity: { provided: false, variants: [], maxMeanShift: null, note: 'Invalid model was not analysed.' },
      verification: { schemaVersion: '1.0', passed: false, checks: [{ id: 'model-validation', description: 'The Bayesian model is valid', status: 'failed', evidence: errors.join('; ') }], failures: errors, tolerance: TOLERANCE },
      limitations: ['Invalid model was not analysed.'],
    };
  }
  const level = model.credibleLevel ?? 0.95;
  let posterior: Record<string, number>;
  let lower: number;
  let upper: number;
  let predictive: number | null;
  let posteriorProbabilityAbove: number | null;
  let variants: BayesVariant[] = [];
  if (model.type === 'beta_binomial') {
    posterior = betaPosterior(model.prior.alpha, model.prior.beta, model.successes, model.trials);
    lower = betaQuantile((1 - level) / 2, posterior['alpha']!, posterior['beta']!);
    upper = betaQuantile(1 - (1 - level) / 2, posterior['alpha']!, posterior['beta']!);
    predictive = posterior['mean']!;
    posteriorProbabilityAbove = 1 - regularizedIncompleteBeta(0.5, posterior['alpha']!, posterior['beta']!);
    variants = (model.alternativePriors ?? []).map((prior) => betaVariant(prior, model.successes, model.trials, level));
  } else {
    posterior = normalPosterior(model.prior.mean, model.prior.sd, model.observations, model.knownSd);
    const z = normalQuantile(1 - (1 - level) / 2);
    lower = posterior['mean']! - z * posterior['sd']!;
    upper = posterior['mean']! + z * posterior['sd']!;
    predictive = posterior['mean']!;
    posteriorProbabilityAbove = null;
    variants = (model.alternativePriors ?? []).map((prior) => normalVariant(prior, model.observations, model.knownSd, level));
  }
  const maxMeanShift = variants.length ? Math.max(...variants.map((variant) => Math.abs(variant.posteriorMean - posterior['mean']!))) : null;
  const result: BayesResult = {
    schemaVersion: BAYES_SCHEMA_VERSION, status: 'optimal', modelType: model.type,
    posterior: Object.fromEntries(Object.entries(posterior).map(([key, value]) => [key, round(value)])),
    credibleInterval: { level, lower: round(lower), upper: round(upper) },
    predictive: predictive === null ? null : round(predictive), posteriorProbabilityAbove: posteriorProbabilityAbove === null ? null : round(posteriorProbabilityAbove),
    priorSensitivity: {
      provided: variants.length > 0, variants, maxMeanShift: maxMeanShift === null ? null : round(maxMeanShift),
      note: variants.length ? 'Alternative priors were recomputed; differences are not statistical significance.' : 'No alternative priors were supplied, so prior sensitivity was not assessed.',
    },
    verification: emptyVerification(),
    limitations: [
      'Posterior results are conditional on the declared likelihood and priors.',
      'A credible interval is not a frequentist confidence interval or a guarantee about future outcomes.',
      'Prior sensitivity is only assessed when alternative priors are supplied.',
    ],
  };
  result.verification = verifyBayes(model, result);
  if (!result.verification.passed) result.status = 'unverified';
  return result;
}
