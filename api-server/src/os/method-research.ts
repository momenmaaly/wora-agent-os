/**
 * WORA OS — method research and discovery boundary.
 *
 * When the implemented catalog cannot satisfy a stated requirement, WORA names
 * the unresolved requirement, proposes candidate method families and states
 * honestly whether each is implemented, available only through an unintegrated
 * library, or still research. It never registers or executes a candidate and
 * never claims a superior algorithm without reproducible evidence.
 */
import { createHash } from 'node:crypto';
import type { ProblemProfile } from './problem.js';
import { listAlgorithms } from './algorithms.js';
import { getTool } from './tools.js';

export const METHOD_RESEARCH_SCHEMA_VERSION = '1.0';

export type MethodImplementation = 'implemented' | 'existing-library-not-integrated' | 'research-required';

export interface MethodResearchCandidate {
  id: string;
  name: string;
  family: string;
  implementation: MethodImplementation;
  toolId: string | null;
  theoreticalFit: number;
  rationale: string;
  limitations: string[];
  requiredInputs: string[];
  evidenceNeeded: string[];
  benchmarkBaseline: string;
}

export interface MethodResearch {
  schemaVersion: typeof METHOD_RESEARCH_SCHEMA_VERSION;
  status: 'not-needed' | 'existing-capability' | 'missing-inputs' | 'research-required';
  requirement: string | null;
  candidates: MethodResearchCandidate[];
  selectedExisting: string | null;
  registration: 'none' | 'not-registered';
  inventedAlgorithmClaim: false;
  benchmarkPlan: string[];
  limitations: string[];
  evidence: string[];
}

interface ResearchEntry {
  id: string;
  triggers: RegExp;
  requirement: string;
  candidates: Array<Omit<MethodResearchCandidate, 'id' | 'implementation' | 'toolId'> & { toolId?: string | null; implementation?: MethodImplementation }>;
}

const ENTRIES: ResearchEntry[] = [
  {
    id: 'nonlinear-continuous', triggers: /nonlinear|non-convex|غير\s*خطي/iu, requirement: 'continuous nonlinear or non-convex optimization',
    candidates: [
      { name: 'Interior-point nonlinear programming', family: 'nonlinear-programming', theoreticalFit: 0.8, toolId: null, implementation: 'existing-library-not-integrated', rationale: 'A mature NLP solver can model smooth nonlinear objectives and constraints.', limitations: ['Requires derivative information and a solver adapter not present in WORA.'], requiredInputs: ['continuous variables', 'smooth objective', 'constraint functions'], evidenceNeeded: ['solver adapter', 'convergence and feasibility benchmarks'], benchmarkBaseline: 'Current LP/MIP path fails closed for nonlinear terms.' },
      { name: 'Sequential quadratic programming', family: 'nonlinear-programming', theoreticalFit: 0.72, toolId: null, implementation: 'research-required', rationale: 'SQP can handle smooth constrained problems with local convergence.', limitations: ['Local optimum only; no global guarantee.'], requiredInputs: ['gradients', 'constraint Jacobian'], evidenceNeeded: ['local/global benchmark', 'constraint-violation tests'], benchmarkBaseline: 'No implemented SQP path.' },
      { name: 'Evolutionary search', family: 'metaheuristic', theoreticalFit: 0.55, toolId: null, implementation: 'research-required', rationale: 'Derivative-free search can explore non-convex spaces.', limitations: ['No optimality proof; stochastic and expensive.'], requiredInputs: ['bounded variables', 'evaluation budget'], evidenceNeeded: ['reproducible seeds', 'baseline comparison', 'quality bounds'], benchmarkBaseline: 'No implemented evolutionary optimizer.' },
    ],
  },
  {
    id: 'vrp-time-windows', triggers: /time\s*window|delivery\s*window|نافذة\s*زمنية/iu, requirement: 'vehicle routing with time windows',
    candidates: [
      { name: 'VRP with time windows (VRPTW)', family: 'routing', theoreticalFit: 0.85, toolId: null, implementation: 'research-required', rationale: 'The stated service windows add time constraints that the current CVRP baseline does not model.', limitations: ['Current routing.vrp ignores time windows; using it would silently drop a stated constraint.'], requiredInputs: ['depot', 'customers with windows', 'vehicles with capacity'], evidenceNeeded: ['time-window feasibility checks', 'benchmark against Solomon instances'], benchmarkBaseline: 'routing.vrp handles capacity and distance only.' },
      { name: 'Column generation for VRPTW', family: 'routing', theoreticalFit: 0.78, toolId: null, implementation: 'research-required', rationale: 'Set-partitioning with route columns can solve modest VRPTW instances.', limitations: ['Implementation and pricing subproblem are not present.'], requiredInputs: ['time windows', 'fleet capacity', 'travel times'], evidenceNeeded: ['optimality gap', 'runtime benchmark'], benchmarkBaseline: 'No implemented column-generation path.' },
    ],
  },
  {
    id: 'stochastic-programming', triggers: /two[ -]?stage|stochastic\s+program|chance[ -]?constraint|برمجة\s*عشوائية/iu, requirement: 'stochastic programming under uncertainty',
    candidates: [
      { name: 'Two-stage stochastic MIP', family: 'stochastic-optimization', theoreticalFit: 0.82, toolId: null, implementation: 'research-required', rationale: 'Scenario-based recourse models uncertainty explicitly instead of collapsing it to an expected value.', limitations: ['Scenario generation and non-anticipativity constraints are not implemented.'], requiredInputs: ['scenario probabilities', 'first-stage variables', 'recourse variables'], evidenceNeeded: ['out-of-sample stability', 'scenario-count sensitivity'], benchmarkBaseline: 'sim.scenario_compare and sim.monte_carlo evaluate scenarios but do not optimize recourse.' },
      { name: 'Sample average approximation', family: 'stochastic-optimization', theoreticalFit: 0.7, toolId: null, implementation: 'research-required', rationale: 'SAA can approximate a stochastic program with repeated deterministic samples.', limitations: ['Statistical optimality gap requires repeated independent samples.'], requiredInputs: ['sampler', 'deterministic MIP', 'confidence level'], evidenceNeeded: ['gap estimate', 'seed reproducibility'], benchmarkBaseline: 'No SAA implementation is registered.' },
    ],
  },
  {
    id: 'reinforcement-learning', triggers: /reinforcement\s*learning|\brl\b|تعلم\s*معزز/iu, requirement: 'sequential decision learning',
    candidates: [
      { name: 'Policy-gradient reinforcement learning', family: 'reinforcement-learning', theoreticalFit: 0.7, toolId: null, implementation: 'research-required', rationale: 'A policy can optimize sequential decisions when a simulator and reward are available.', limitations: ['Needs training, evaluation environments and safety constraints; no such runtime is integrated.'], requiredInputs: ['environment', 'reward', 'training budget'], evidenceNeeded: ['seeded training runs', 'held-out evaluation', 'safety limits'], benchmarkBaseline: 'No RL runtime is implemented.' },
    ],
  },
  {
    id: 'deep-learning', triggers: /deep\s*learning|neural\s*network|شبكة\s*عصبية/iu, requirement: 'learned predictive model',
    candidates: [
      { name: 'Supervised neural network', family: 'machine-learning', theoreticalFit: 0.65, toolId: null, implementation: 'research-required', rationale: 'A learned model may fit nonlinear patterns when enough labelled data exists.', limitations: ['Requires training data, validation and model-risk review; not present.'], requiredInputs: ['labelled dataset', 'validation split', 'training budget'], evidenceNeeded: ['held-out metrics', 'calibration', 'leakage audit'], benchmarkBaseline: 'forecast.linear is the only implemented predictive baseline.' },
    ],
  },
  {
    id: 'mcts', triggers: /monte\s*carlo\s*tree|mcts|شجرة\s*مونت\s*كارلو/iu, requirement: 'sequential search with simulation',
    candidates: [
      { name: 'Monte Carlo tree search', family: 'search', theoreticalFit: 0.7, toolId: null, implementation: 'research-required', rationale: 'MCTS can search sequential decision trees using simulated rollouts.', limitations: ['Needs a generative model, action space and compute budget.'], requiredInputs: ['state transition model', 'action space', 'rollout policy'], evidenceNeeded: ['reproducible seeds', 'baseline comparison', 'compute budget'], benchmarkBaseline: 'No MCTS implementation is registered.' },
    ],
  },
  {
    id: 'constraint-programming', triggers: /constraint\s*program|\bcp[ -]?sat\b|قيد\s*برمجي/iu, requirement: 'constraint programming or CP-SAT',
    candidates: [
      { name: 'CP-SAT', family: 'constraint-programming', theoreticalFit: 0.75, toolId: null, implementation: 'existing-library-not-integrated', rationale: 'OR-Tools CP-SAT is a strong fit for finite-domain combinatorial constraints.', limitations: ['The repository uses OR-Tools for LP/MIP but exposes no CP-SAT tool.'], requiredInputs: ['finite-domain variables', 'constraints', 'objective'], evidenceNeeded: ['adapter', 'feasibility and optimality tests'], benchmarkBaseline: 'MIP is available through or.solve_lp; CP-SAT is not registered.' },
    ],
  },
];

const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16);

function implementedCandidateFor(profile: ProblemProfile): MethodResearchCandidate | null {
  const toolId = profile.scientific.method?.toolId ?? profile.algorithmSelection.primary?.toolId ?? null;
  if (!toolId || !getTool(toolId)) return null;
  const algorithm = listAlgorithms().find((entry) => entry.toolId === toolId);
  if (!algorithm) return null;
  return {
    id: `implemented-${digest(toolId)}`, name: algorithm.name, family: algorithm.domain,
    implementation: 'implemented', toolId, theoreticalFit: 1,
    rationale: algorithm.guarantee, limitations: [...algorithm.limitations].slice(0, 4),
    requiredInputs: [...algorithm.inputs], evidenceNeeded: [...algorithm.verification],
    benchmarkBaseline: `${algorithm.name} is implemented and tested in the current catalog.`,
  };
}

export function researchUnresolvedMethod(input: { objective: string; profile: ProblemProfile; excludeExisting?: boolean; missingInputs?: string[] }): MethodResearch {
  const implemented = input.excludeExisting ? null : implementedCandidateFor(input.profile);
  const missingInputs = input.missingInputs?.length ? input.missingInputs : input.profile.scientific.missingInformation ?? [];
  const unsupported = input.profile.algorithmSelection.status === 'unsupported';
  const entry = ENTRIES.find((candidate) => candidate.triggers.test(input.objective));
  if (!entry && missingInputs.length) {
    return {
      schemaVersion: METHOD_RESEARCH_SCHEMA_VERSION, status: 'missing-inputs', requirement: 'complete input data for the selected method',
      candidates: implemented ? [implemented] : [], selectedExisting: implemented?.toolId ?? null,
      registration: 'none', inventedAlgorithmClaim: false,
      benchmarkPlan: [], limitations: ['A method is not changed merely because data is missing; the missing values must be supplied or explicitly assumed.'],
      evidence: missingInputs.map((item) => `Missing: ${item}`),
    };
  }
  if (!unsupported && !entry) {
    return {
      schemaVersion: METHOD_RESEARCH_SCHEMA_VERSION, status: implemented ? 'existing-capability' : 'not-needed',
      requirement: null, candidates: implemented ? [implemented] : [], selectedExisting: implemented?.toolId ?? null,
      registration: 'none', inventedAlgorithmClaim: false, benchmarkPlan: [], limitations: [],
      evidence: implemented ? ['The implemented catalog already contains a matching tested method.'] : ['No unresolved method requirement was detected.'],
    };
  }
  const candidates: MethodResearchCandidate[] = (entry?.candidates ?? []).map((candidate) => {
    const tool = candidate.toolId ? getTool(candidate.toolId) : null;
    return {
      id: `research-${digest(`${entry?.id}:${candidate.name}`)}`,
      name: candidate.name, family: candidate.family,
      implementation: tool ? 'implemented' : candidate.implementation ?? 'research-required',
      toolId: tool ? candidate.toolId ?? null : null,
      theoreticalFit: candidate.theoreticalFit, rationale: candidate.rationale,
      limitations: candidate.limitations, requiredInputs: candidate.requiredInputs,
      evidenceNeeded: candidate.evidenceNeeded, benchmarkBaseline: candidate.benchmarkBaseline,
    };
  });
  if (implemented && !candidates.some((candidate) => candidate.toolId === implemented.toolId)) candidates.unshift(implemented);
  const selectedExisting = implemented?.toolId ?? null;
  return {
    schemaVersion: METHOD_RESEARCH_SCHEMA_VERSION,
    status: selectedExisting ? 'existing-capability' : candidates.length || unsupported ? 'research-required' : 'not-needed',
    requirement: entry?.requirement ?? (missingInputs.length ? 'complete input data' : 'an implemented method for the stated problem'),
    candidates: candidates.slice(0, 5), selectedExisting,
    registration: 'not-registered', inventedAlgorithmClaim: false,
    benchmarkPlan: [
      'Define a reproducible baseline on the same inputs.',
      'Implement the candidate behind an isolated adapter with no privileged access.',
      'Run correctness checks against known optima, invariants or independent recomputation.',
      'Benchmark quality, runtime, memory and failure behavior with fixed seeds.',
      'Register the method only after the benchmark and verification pass.',
    ],
    limitations: [
      'Candidate methods are research proposals, not registered capabilities.',
      'No claim of superiority is made without reproducible evidence.',
    ],
    evidence: [
      `Requirement: ${entry?.requirement ?? 'unresolved method requirement'}`,
      `Implemented catalog status: ${input.profile.algorithmSelection.status}`,
      ...(missingInputs.length ? [`Missing inputs: ${missingInputs.join('; ')}`] : []),
    ],
  };
}
