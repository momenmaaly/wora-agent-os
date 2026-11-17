import type { WorkspaceZone } from '../../shared/types/index.js';

const SYSTEM_BOOT_AT = '2026-01-01T00:00:00.000Z';

export const EXAMPLE_ZONES: WorkspaceZone[] = [
  {
    id:               'zone-planning',
    name:             'Planning Bay',
    themeColor:       '#6366f1',
    position:         { x: -8, z: -8 },
    radius:           3.5,
    assignedAgentIds: ['agent-planner-01'],
    maxCapacity:      8,
    description:      'Strategic planning, roadmaps & product architecture',
    createdAt:        SYSTEM_BOOT_AT,
    createdBy:        'system',
  },
  {
    id:               'zone-engineering',
    name:             'Engineering Hub',
    themeColor:       '#22d3ee',
    position:         { x: 8, z: -8 },
    radius:           3.5,
    assignedAgentIds: ['agent-coder-01'],
    maxCapacity:      8,
    description:      'Full-stack implementation, systems & DevOps',
    createdAt:        SYSTEM_BOOT_AT,
    createdBy:        'system',
  },
  {
    id:               'zone-review',
    name:             'Review Chamber',
    themeColor:       '#f59e0b',
    position:         { x: 0, z: 8 },
    radius:           3.5,
    assignedAgentIds: ['agent-reviewer-01'],
    maxCapacity:      8,
    description:      'Security auditing, code review & quality assurance',
    createdAt:        SYSTEM_BOOT_AT,
    createdBy:        'system',
  },
  {
    id:               'zone-analytics',
    name:             'Analytics Core',
    themeColor:       '#10b981',
    position:         { x: -8, z: 8 },
    radius:           3.5,
    assignedAgentIds: ['agent-analyst-01'],
    maxCapacity:      8,
    description:      'Data modeling, metrics, benchmarks & cost analysis',
    createdAt:        SYSTEM_BOOT_AT,
    createdBy:        'system',
  },
];

export const VALID_ZONE_IDS = new Set(EXAMPLE_ZONES.map((z) => z.id));
