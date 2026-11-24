/**
 * WORA OS — problem structure inference.
 *
 * This layer separates wording from structure. It does not decide that a
 * sentence is a forecast because it contains one favourite keyword. It scores
 * projection language, future time, historical basis and a target measure,
 * then checks whether a forecast can actually execute with the supplied inputs.
 * The result is evidence for the reasoning layer, never an executable action.
 */
import { createHash } from 'node:crypto';
import type { UnifiedProblem } from './problem-model.js';

export const PROBLEM_STRUCTURE_SCHEMA_VERSION = '1.0';

export type ProblemStructureKind =
  | 'forecasting'
  | 'descriptive_statistics'
  | 'trend_analysis'
  | 'classification'
  | 'simulation'
  | 'optimization'
  | 'decision'
  | 'root_cause_analysis'
  | 'causal_analysis'
  | 'formal_verification'
  | 'software_engineering'
  | 'general';

export interface StructureRequirement { id: string; label: string; present: boolean; reason: string; }

export interface ForecastHorizon {
  text: string;
  steps: number | null;
  unit: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'period';
  assumption: string | null;
}

export interface ForecastStructure {
  intent: boolean;
  targetVariable: string | null;
  horizon: ForecastHorizon | null;
  observations: number[];
  seriesSource: string | null;
  seriesMalformed: boolean;
  conflictingRecords: boolean;
  basis: 'explicit-series' | 'historical-reference' | 'none';
  requirements: StructureRequirement[];
  missingInputs: string[];
  canExecute: boolean;
  assumptions: string[];
  extractionNotes: string[];
}

export interface ProblemStructure {
  schemaVersion: typeof PROBLEM_STRUCTURE_SCHEMA_VERSION;
  objectiveDigest: string;
  kind: ProblemStructureKind;
  confidence: number;
  signals: {
    projection: string[];
    temporal: string[];
    historical: string[];
    target: string[];
    negative: string[];
    forecast: string[];
  };
  forecasting: ForecastStructure | null;
  provenance: {
    kind: 'deterministic-structure-rules';
    source: 'objective-and-supplied-evidence';
    trust: 'unverified';
    digest: string;
  };
}

const unique = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const matches = (text: string, pattern: RegExp): string[] => unique([...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].map((match) => match[0].toLowerCase()));
const digest = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 32);

const TARGET_TERMS = [
  'revenue', 'sales', 'demand', 'workload', 'orders', 'tickets', 'users', 'traffic', 'churn', 'cost', 'price',
  'inventory', 'headcount', 'volume', 'attendance', 'load', 'calls', 'tickets', 'appointments',
  'production', 'footfall', 'margin', 'profit', 'subscriptions', 'usage', 'conversion', 'retention',
  'throughput', 'capacity', 'spend', 'cash', 'bookings', 'reservations', 'signups', 'activations',
];

const HORIZON_UNITS: Record<string, { unit: ForecastHorizon['unit']; steps: (n: number) => number; assumption: string | null }> = {
  day: { unit: 'day', steps: (n) => n, assumption: null },
  week: { unit: 'week', steps: (n) => n, assumption: null },
  month: { unit: 'month', steps: (n) => n, assumption: null },
  quarter: { unit: 'month', steps: (n) => n * 3, assumption: 'A quarter was converted to three monthly periods; the observation cadence is assumed monthly.' },
  year: { unit: 'month', steps: (n) => n * 12, assumption: 'A year was converted to twelve monthly periods; the observation cadence is assumed monthly.' },
  period: { unit: 'period', steps: (n) => n, assumption: null },
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

function parseNumber(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (/^\d+$/u.test(normalized)) return Number(normalized);
  return WORD_NUMBERS[normalized] ?? null;
}

function parseHorizon(text: string): { horizon: ForecastHorizon | null; notes: string[] } {
  const notes: string[] = [];
  const explicit = /(?:over|for|in|during)?\s*(?:the\s+)?(?:next|coming|following|upcoming)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(day|week|month|quarter|year|period)s?/iu.exec(text);
  if (explicit?.[1] && explicit[2]) {
    const count = parseNumber(explicit[1]);
    const config = HORIZON_UNITS[explicit[2].toLowerCase()];
    if (count !== null && config) {
      notes.push(`Horizon inferred from "${explicit[0].trim()}".`);
      return { horizon: { text: explicit[0].trim(), steps: config.steps(count), unit: config.unit, assumption: config.assumption }, notes };
    }
  }
  const singular = /(?:over|for|in|during)?\s*(?:the\s+)?(?:next|coming|following|upcoming)\s+(day|week|month|quarter|year|period)\b/iu.exec(text);
  if (singular?.[1]) {
    const config = HORIZON_UNITS[singular[1].toLowerCase()];
    if (config) {
      notes.push(`Horizon inferred from "${singular[0].trim()}".`);
      return { horizon: { text: singular[0].trim(), steps: config.steps(1), unit: config.unit, assumption: config.assumption }, notes };
    }
  }
  const quarter = /\bq[1-4]\b/iu.exec(text);
  if (quarter) {
    notes.push(`A single quarter (${quarter[0]}) is one forecast period; the observation cadence is not assumed.`);
    return { horizon: { text: quarter[0], steps: 1, unit: 'quarter', assumption: null }, notes };
  }
  const byDate = /\b(?:by|through|until)\s+(?:20\d{2}|q[1-4])\b/iu.exec(text);
  if (byDate) {
    notes.push(`A date horizon ("${byDate[0].trim()}") was found, but the number of future periods is not explicit.`);
    return { horizon: { text: byDate[0].trim(), steps: null, unit: 'period', assumption: null }, notes };
  }
  return { horizon: null, notes };
}

function parseSeries(objective: string, evidence: Array<{ statement: string }>): { observations: number[]; source: string | null; malformed: boolean; note: string | null } {
  const sources = [{ text: objective, source: 'objective:explicit-series' }, ...evidence.map((item, index) => ({ text: item.statement, source: `evidence:${index + 1}` }))];
  for (const item of sources) {
    const bracket = /\[([^\]]+)\]/u.exec(item.text);
    if (bracket?.[1]) {
      const tokens = bracket[1].split(/[,;\s]+/u).filter(Boolean);
      const numbers = tokens.map((token) => Number(token));
      if (tokens.length > 0 && numbers.every((value) => Number.isFinite(value))) {
        return { observations: numbers, source: item.source, malformed: false, note: `Parsed ${numbers.length} numeric observation(s) from an explicit array.` };
      }
      return { observations: [], source: item.source, malformed: true, note: 'An explicit series was present but contained non-numeric or malformed values; it was not repaired.' };
    }
    const labeled = /(?:series|observations?|actuals?|historical(?:\s+(?:values|totals|data))?)\s*[:=]\s*([-+]?\d+(?:\.\d+)?(?:\s*[,;]\s*[-+]?\d+(?:\.\d+)?)+)/iu.exec(item.text);
    if (labeled?.[1]) {
      const numbers = labeled[1].split(/[,;]/u).map((token) => Number(token.trim()));
      if (numbers.every((value) => Number.isFinite(value))) {
        return { observations: numbers, source: item.source, malformed: false, note: `Parsed ${numbers.length} numeric observation(s) from a labelled series.` };
      }
    }
  }
  return { observations: [], source: null, malformed: false, note: null };
}

function targetVariableOf(text: string): string | null {
  for (const term of TARGET_TERMS) {
    const stem = term.replace(/s$/u, '');
    const match = new RegExp(`\\b${stem}s?\\b`, 'iu').exec(text);
    if (match) return term;
  }
  const measured = /\b(?:measured|target|output|response)\s+(?:variable|metric|value|quantity)\b/iu.exec(text);
  if (measured) return measured[0].toLowerCase();
  const howMany = /\bhow many\s+([a-z][a-z -]{2,40})\b/iu.exec(text);
  if (howMany?.[1]) return howMany[1].trim().toLowerCase();
  const afterVerb = /\b(?:forecast|predict|project|estimate|expect|anticipate|outlook\s+for)\s+(?:the\s+)?(?:future\s+)?(?:monthly\s+|quarterly\s+|annual\s+|weekly\s+)?([a-z][a-z -]{2,40}?)(?=\s+(?:for|over|in|next|from|using|based|during|to|at)\b|[,.;]|$)/iu.exec(text);
  if (afterVerb?.[1]) {
    const candidate = afterVerb[1].trim().toLowerCase().replace(/^(?:a|an|the)\s+/u, '');
    if (!/^(?:future|period|month|quarter|year|week|day)$/u.test(candidate) && !/\b(?:with|without|historical|incomplete|data|series|period|future|last|next)\b/u.test(candidate)) return candidate;
  }
  const numericValue = /\b(?:(?:numerical|numeric)\s+(?:value|quantity|number)|number|value|quantity)\b/iu.exec(text);
  if (numericValue) return numericValue[0].toLowerCase();
  return null;
}

function negativeKind(text: string): ProblemStructureKind {
  const ordered: Array<{ kind: ProblemStructureKind; pattern: RegExp }> = [
    { kind: 'root_cause_analysis', pattern: /\b(?:why|root cause|troubleshoot|diagnos|explain|failure|incident|bug|error)\b/iu },
    { kind: 'causal_analysis', pattern: /\b(?:cause|causal|causation|counterfactual|confound|correlat|associated with|linked to|affect(?:s|ed|ing)?|impact(?:s|ed)?)\b/iu },
    { kind: 'formal_verification', pattern: /\b(?:prove|proof|model check|smt|sat solver|formal verification)\b/iu },
    { kind: 'optimization', pattern: /\b(?:optimi[sz](?:e|ing|ed|ation)?|minimi[sz](?:e|ing|ed|ation)?|maximi[sz](?:e|ing|ed|ation)?|schedul|allocat|assign|cost matrix|shift)\b/iu },
    { kind: 'decision', pattern: /\b(?:choose|select|rank|criteria|alternative|vendor|decision)\b/iu },
    { kind: 'classification', pattern: /\b(?:classif(?:y|ication)|segment(?:ed|ing|ation)|categor(?:y|ize)|label(?:ing)?)\b/iu },
    { kind: 'simulation', pattern: /\b(?:monte carlo|simulat(?:e|ion)|scenario analysis|what-if)\b/iu },
    { kind: 'software_engineering', pattern: /\b(?:build|create|develop|implement)\b.{0,70}\b(?:app|application|software|api|platform|portal|saas|dashboard|service)\b/iu },
    { kind: 'trend_analysis', pattern: /\b(?:calculate|measure|describe|analyse|analyze)\b.{0,30}\b(?:trend|slope)\b/iu },
    { kind: 'descriptive_statistics', pattern: /\b(?:mean|median|average|sum|count|stddev|standard deviation|variance|distribution|outlier|quartile|statistic|summari[sz]e|describe)\b/iu },
  ];
  return ordered.find((item) => item.pattern.test(text))?.kind ?? 'general';
}

export function inferProblemStructure(objective: string, base?: UnifiedProblem, evidence: Array<{ statement: string }> = []): ProblemStructure {
  const text = objective.trim();
  const combined = [text, ...evidence.map((item) => item.statement)].join('\n');
  const projection = unique([
    ...matches(combined, /\b(?:forecast|predict(?:ion|ed|ing)?|extrapolat(?:e|ion|ing)|anticipat(?:e|ion|ing)|outlook)\b/iu),
    ...matches(combined, /\bproject(?:ion|ed|ing|s)?\b/iu),
    ...matches(combined, /\b(?:estimate|expect)\b/iu),
    ...matches(combined, /\b(?:will|would|might|may|could)\s+(?:change|be|grow|decline|rise|fall|reach|increase|decrease|move)\b/iu),
    ...matches(combined, /\b(?:change|evolve|move|grow|decline|rise|fall)\b.{0,25}\bover\s+(?:the\s+)?(?:next|coming|future|time)\b/iu),
    ...matches(combined, /توقع|تنبؤ|تقدير|مستقبل|القادم|خلال/iu),
  ]);
  const temporal = unique([
    ...matches(combined, /\b(?:next|upcoming|coming|following|future)\s+(?:day|week|month|quarter|year|period|fiscal|q[1-4]|\d+|[a-z]+)\b/iu),
    ...matches(combined, /\bq[1-4]\b/iu),
    ...matches(combined, /\b(?:by|through|until)\s+(?:20\d{2}|q[1-4])\b/iu),
    ...matches(combined, /\b(?:tomorrow|next week|next month|next quarter|next year)\b/iu),
    ...matches(combined, /\bover\s+time\b/iu),
    ...matches(combined, /الربع القادم|الشهر القادم|العام القادم|السنة القادمة|الأشهر القادمة|خلال/iu),
  ]);
  const historical = unique([
    ...matches(combined, /\b(?:historical|history|past|previous|prior|actuals?|observed|observations?|recorded|trailing|to date|so far)\b/iu),
    ...matches(combined, /\b(?:from|using|based on)\s+(?:the\s+)?(?:last|past|previous|history|actuals?|historical)\b/iu),
    ...matches(combined, /\b(?:time series|monthly series|sales history|historical totals|previous months|last \d+ (?:days|weeks|months|quarters|years))\b/iu),
    ...(base?.baseProfile.features.hasTimeSeries === true ? ['structured feature: hasTimeSeries'] : []),
    ...matches(combined, /تاريخي|سابق|الماضي|الأشهر الماضية|سلسلة زمنية/iu),
  ]);
  const targetVariable = targetVariableOf(combined);
  const targetSignals = targetVariable ? [targetVariable] : [];
  const negative = unique([
    ...matches(combined, /\b(?:optimi[sz](?:e|ing|ed|ation)?|minimi[sz](?:e|ing|ed|ation)?|maximi[sz](?:e|ing|ed|ation)?|schedul|allocat|assign|cost matrix|shift)\b/iu),
    ...matches(combined, /\b(?:classif(?:y|ication)|segment|categor(?:y|ize)|label(?:ing)?)\b/iu),
    ...matches(combined, /\b(?:monte carlo|simulat(?:e|ion)|scenario analysis|what-if)\b/iu),
    ...matches(combined, /\b(?:why|root cause|troubleshoot|diagnos|failure|incident|bug|error)\b/iu),
    ...matches(combined, /\b(?:mean|median|average|sum|count|stddev|variance|distribution|outlier|quartile|statistic|summari[sz]e|describe)\b/iu),
  ]);
  const strongForecast = /\b(?:forecast|predict(?:ion|ed|ing)?|extrapolat(?:e|ion|ing)|anticipat(?:e|ion|ing)|outlook)\b/iu.test(combined);
  const projectVerb = /\bproject(?:ion|ed|ing|s)?\b/iu.test(combined);
  const estimateVerb = /\b(?:estimate|expect)\b/iu.test(combined);
  const futureChange = /\b(?:will|would|might|may|could)\s+(?:change|be|grow|decline|rise|fall|reach|increase|decrease|move)\b/iu.test(combined);
  const changeOverTime = /\b(?:change|evolve|move|grow|decline|rise|fall)\b.{0,25}\bover\s+(?:the\s+)?(?:next|coming|future|time)\b/iu.test(combined);
  const projectionScore = strongForecast ? 3 : projectVerb ? 2 : estimateVerb ? 1.5 : futureChange ? 2 : changeOverTime ? 2 : 0;
  const forecastIntent = projectionScore >= 3
    || (projectionScore >= 2 && (temporal.length > 0 || historical.length > 0 || targetSignals.length > 0))
    || (projectionScore >= 1.5 && temporal.length > 0 && (historical.length > 0 || targetSignals.length > 0));
  const negativeType = negativeKind(combined);
  const blockingNegative = ['root_cause_analysis', 'causal_analysis', 'formal_verification', 'optimization', 'decision', 'classification', 'simulation', 'software_engineering'].includes(negativeType);
  const researchCue = /\b(?:research|investigate|study|sources?|literature|evidence)\b/iu.test(combined);
  const selectedKind: ProblemStructureKind = forecastIntent && !blockingNegative
    ? 'forecasting'
    : negativeType !== 'general' && !(researchCue && negativeType === 'descriptive_statistics')
      ? negativeType
      : 'general';
  const confidence = selectedKind === 'forecasting'
    ? Math.min(0.95, 0.55 + (strongForecast ? 0.2 : 0) + (temporal.length ? 0.1 : 0) + (historical.length ? 0.1 : 0))
    : negativeType !== 'general' ? 0.7 : 0.35;

  let forecasting: ForecastStructure | null = null;
  if (forecastIntent) {
    const parsedHorizon = parseHorizon(combined);
    const parsedSeries = parseSeries(text, evidence);
    const conflictingRecords = /\b(?:conflict(?:ing|s)?|inconsistent|discrepan(?:cy|cies)|contradict(?:ory|ing)?|disputed|unreliable)\b.{0,80}\b(?:records?|observations?|data|totals?|sources?)\b/iu.test(combined)
      || /\b(?:records?|observations?|data|totals?|sources?)\b.{0,80}\b(?:conflict(?:ing|s)?|inconsistent|discrepan(?:cy|cies)|contradict(?:ory|ing)?|disputed|unreliable)\b/iu.test(combined)
      || /\b(?:do not|don't|must not)\s+use\b.{0,40}\b(?:historical|past|observations?|data)\b/iu.test(combined);
    const requirements: StructureRequirement[] = [
      { id: 'target-variable', label: 'target variable to forecast', present: Boolean(targetVariable), reason: targetVariable ? `Inferred target: ${targetVariable}.` : 'The objective asks for a projection but does not name the quantity to forecast.' },
      { id: 'forecast-horizon', label: 'forecast horizon (number of future periods)', present: Boolean(parsedHorizon.horizon?.steps), reason: parsedHorizon.horizon?.steps ? `${parsedHorizon.horizon.text} → ${parsedHorizon.horizon.steps} ${parsedHorizon.horizon.unit} period(s).` : 'The number of future periods is not explicit.' },
      { id: 'observations', label: 'at least 8 chronological numeric observations', present: parsedSeries.observations.length >= 8 && !conflictingRecords, reason: parsedSeries.observations.length >= 8 && !conflictingRecords ? `${parsedSeries.observations.length} observations were supplied.` : conflictingRecords ? 'The observations or their sources conflict; no authoritative series can be selected without correction.' : parsedSeries.malformed ? 'The supplied series is malformed or non-numeric; it was not repaired or replaced.' : parsedSeries.observations.length > 0 ? `Only ${parsedSeries.observations.length} observations were supplied; the implemented linear forecast requires at least 8.` : 'No historical numeric observations were supplied.' },
    ];
    const missingInputs = requirements.filter((item) => !item.present).map((item) => item.label);
    const assumptions = unique([
      ...(parsedHorizon.horizon?.assumption ? [parsedHorizon.horizon.assumption] : []),
      'The observations are chronological and measured at a consistent cadence.',
      'A linear trend is a transparent baseline, not a causal or guaranteed prediction.',
      ...(parsedSeries.observations.length >= 8 ? [] : ['No missing observations were invented.']),
    ]);
    forecasting = {
      intent: true, targetVariable, horizon: parsedHorizon.horizon, observations: parsedSeries.observations,
      seriesSource: parsedSeries.source, seriesMalformed: parsedSeries.malformed, conflictingRecords,
      basis: parsedSeries.observations.length ? 'explicit-series' : historical.length ? 'historical-reference' : 'none',
      requirements, missingInputs, canExecute: missingInputs.length === 0, assumptions,
      extractionNotes: unique([...parsedHorizon.notes, ...(parsedSeries.note ? [parsedSeries.note] : []), ...(targetVariable ? [`Target inferred from the objective.`] : [])]),
    };
  }

  return {
    schemaVersion: PROBLEM_STRUCTURE_SCHEMA_VERSION,
    objectiveDigest: digest({ objective: text, evidence: evidence.map((item) => item.statement) }),
    kind: selectedKind, confidence,
    signals: { projection, temporal, historical, target: targetSignals, negative, forecast: forecastIntent ? [...projection, ...temporal, ...targetSignals] : [] },
    forecasting,
    provenance: { kind: 'deterministic-structure-rules', source: 'objective-and-supplied-evidence', trust: 'unverified', digest: digest({ selectedKind, forecastIntent, targetVariable, horizon: forecasting?.horizon, observations: forecasting?.observations.length ?? 0 }) },
  };
}
