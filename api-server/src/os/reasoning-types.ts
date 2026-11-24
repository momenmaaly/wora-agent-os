/**
 * WORA OS — evidence-grounded reasoning contracts.
 *
 * These types separate what was stated, observed, retrieved, assumed,
 * hypothesised and concluded. A model proposal is never a fact: it carries
 * `model-proposal` provenance and remains unverified until independent
 * evidence or verification supports it.
 */
import type { UnifiedProblem } from './problem-model.js';
import type { ProblemStructure } from './problem-structure.js';

export const REASONING_SCHEMA_VERSION = '1.0';

export type ClaimKind =
  | 'user-fact'
  | 'observed-fact'
  | 'retrieved-evidence'
  | 'assumption'
  | 'hypothesis'
  | 'unknown'
  | 'contradiction'
  | 'constraint'
  | 'causal-relation'
  | 'conclusion';

export type ClaimTrust = 'verified' | 'unverified' | 'assumption' | 'model-proposal';
export type ConfidenceKind = 'deterministic' | 'heuristic' | 'uncalibrated' | 'calibrated' | 'none';
export type ReasoningMode = 'deterministic' | 'model-assisted' | 'deterministic-fallback';

export interface ClaimProvenance {
  kind: 'objective' | 'user-evidence' | 'retrieved-memory' | 'tool-output' | 'verification' | 'model' | 'deterministic-rule';
  sourceId: string;
  source: string;
  trust: ClaimTrust;
  observedAt: string | null;
  digest: string | null;
}

export interface ReasoningClaim {
  id: string;
  statement: string;
  kind: ClaimKind;
  provenance: ClaimProvenance;
  confidence: { value: number; kind: ConfidenceKind; note: string };
  evidenceIds: string[];
  supports: string[];
  contradicts: string[];
  active: boolean;
  /** Set only for retrieved-memory claims so persisted models can be re-authorized on read. */
  memoryId?: string;
}

export interface Hypothesis {
  id: string;
  claimId: string;
  statement: string;
  cause: string;
  status: 'candidate' | 'supported' | 'rejected' | 'undetermined';
  rank: number;
  score: number;
  scoreKind: 'heuristic-uncalibrated';
  assumptions: string[];
  evidenceFor: string[];
  evidenceAgainst: string[];
  distinguishingTests: string[];
  rejectionReason: string | null;
  revision: number;
  updatedAt: string;
}

export interface CausalEdge {
  id: string;
  cause: string;
  effect: string;
  relation: 'causes' | 'contributes' | 'correlates' | 'unknown';
  evidenceKind: 'observational' | 'experimental' | 'assumed';
  identified: boolean;
  evidenceIds: string[];
  confounders: string[];
  limitation: string;
  claimId: string | null;
}

export interface InformationNeed {
  id: string;
  question: string;
  unknownClaimId: string | null;
  materiality: 'critical' | 'high' | 'medium' | 'low';
  expectedInformationGain: number;
  cost: { timeMinutes: number; costUsd: number | null; risk: 'low' | 'medium' | 'high'; reversible: boolean };
  canSelfGather: boolean;
  recommendedAction: 'ask-user' | 'gather-self' | 'proceed-with-assumption' | 'stop';
  rationale: string;
  status: 'open' | 'resolved' | 'dismissed';
}

export interface MethodAssessment {
  id: string;
  name: string;
  domain: string;
  status: 'implemented' | 'partial' | 'experimental' | 'documented' | 'not_implemented';
  applies: boolean;
  reason: string;
  requiredInputs: string[];
  assumptions: string[];
  expectedOutputs: string[];
  limitations: string[];
  evidenceRequirements: string[];
  implemented: boolean;
  externalCapabilityRequired: boolean;
  gap: string | null;
  selected: boolean;
}

export interface ReasoningEvidenceInput {
  id?: string;
  statement: string;
  kind: 'user-fact' | 'observed-fact' | 'retrieved-evidence' | 'assumption';
  source: string;
  sourceId?: string;
  trust?: ClaimTrust;
  confidence?: number;
  supports?: string[];
  contradicts?: string[];
  experimental?: boolean;
  confounders?: string[];
  observedAt?: string | null;
}

export interface ReasoningProviderInfo {
  name: string;
  model: string | null;
  status: 'used' | 'not-configured' | 'failed' | 'disabled';
  notice: string;
}

export interface ReasoningChange {
  version: number;
  kind: 'initial' | 'evidence-added' | 'hypothesis-updated' | 'assumption-invalidated' | 'provider-merged';
  description: string;
  affectedClaimIds: string[];
  invalidatedAssumptionIds: string[];
  replanRecommended: boolean;
  affectedTaskIds: string[];
  createdAt: string;
}

export interface ReasoningModel {
  schemaVersion: typeof REASONING_SCHEMA_VERSION;
  workspaceId: string | null;
  missionId: string | null;
  version: number;
  parentVersion: number | null;
  mode: ReasoningMode;
  provider: ReasoningProviderInfo;
  objective: string;
  desiredOutcome: string;
  problemType: string;
  domain: string;
  claims: ReasoningClaim[];
  hypotheses: Hypothesis[];
  causalGraph: CausalEdge[];
  informationNeeds: InformationNeed[];
  methods: MethodAssessment[];
  contradictions: string[];
  unknowns: string[];
  assumptions: string[];
  sufficientToProceed: boolean;
  clarificationQuestion: string | null;
  confidence: { value: number; kind: ConfidenceKind; note: string };
  limitations: string[];
  changes: ReasoningChange[];
  baseProblem: UnifiedProblem | null;
  problemStructure?: ProblemStructure;
  createdAt: string;
}

export interface ReasoningSummary {
  schemaVersion: typeof REASONING_SCHEMA_VERSION;
  mode: ReasoningMode;
  providerStatus: ReasoningProviderInfo['status'];
  problemType: string;
  sufficientToProceed: boolean;
  claimCounts: Record<ClaimKind, number>;
  hypothesisCount: number;
  rejectedHypothesisCount: number;
  causalEdgeCount: number;
  informationNeedCount: number;
  criticalInformationNeedCount: number;
  selectedMethod: string | null;
  gapMethods: string[];
  forecasting?: { intent: boolean; targetVariable: string | null; horizonSteps: number | null; observations: number; canExecute: boolean; missingInputs: string[]; seriesMalformed: boolean; conflictingRecords: boolean } | null;
  clarificationQuestion: string | null;
  confidence: { value: number; kind: ConfidenceKind; note: string };
  limitations: string[];
}
