import type { LoadProfile, PlannedAssignment, RunConfig } from "./types";

/**
 * Allocate an integer total using largest remainders. This preserves the global
 * target exactly, which prevents regional rounding from silently multiplying load.
 */
export function allocateInteger(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("Total must be a non-negative safe integer");
  }
  if (
    weights.length === 0 ||
    weights.some((weight) => !Number.isFinite(weight) || weight < 0)
  ) {
    throw new Error("Weights must be a non-empty list of non-negative numbers");
  }

  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) throw new Error("At least one weight must be positive");

  const exact = weights.map((weight) => (total * weight) / weightTotal);
  const allocated = exact.map(Math.floor);
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let index = 0; remainder > 0; index = (index + 1) % order.length) {
    const entry = order[index];
    if (!entry) break;
    allocated[entry.index] = (allocated[entry.index] ?? 0) + 1;
    remainder -= 1;
  }

  return allocated;
}

function assignmentProfile(
  profile: LoadProfile,
  assignmentIndex: number,
  weights: number[],
): LoadProfile {
  const startTargets = allocateInteger(profile.initialTarget, weights);
  const stageTargets = profile.stages.map((stage) =>
    allocateInteger(stage.target, weights),
  );
  const maxTarget = Math.max(
    startTargets[assignmentIndex] ?? 0,
    ...stageTargets.map((targets) => targets[assignmentIndex] ?? 0),
  );

  return {
    ...profile,
    initialTarget: startTargets[assignmentIndex] ?? 0,
    stages: profile.stages.map((stage, stageIndex) => ({
      durationSeconds: stage.durationSeconds,
      target: stageTargets[stageIndex]?.[assignmentIndex] ?? 0,
    })),
    // Arrival-rate executors need enough VUs to sustain slower endpoints. Split
    // the explicit cap, but never set less than the local requested target or 1.
    maxVus: Math.max(
      1,
      maxTarget,
      allocateInteger(profile.maxVus, weights)[assignmentIndex] ?? 1,
    ),
  };
}

export function planAssignments(config: RunConfig): PlannedAssignment[] {
  const assignments: Omit<PlannedAssignment, "profile">[] = [];
  const normalizedRegions = config.regions.map((region) => ({
    ...region,
    normalizedWeight: region.weight / region.shards,
  }));

  for (const region of normalizedRegions) {
    for (let shard = 0; shard < region.shards; shard += 1) {
      assignments.push({
        region: region.code,
        shard,
        weight: region.normalizedWeight,
      });
    }
  }

  const weights = assignments.map((assignment) => assignment.weight);
  return assignments.map((assignment, index) => ({
    ...assignment,
    profile: assignmentProfile(config.profile, index, weights),
  }));
}

export interface CostEstimate {
  generatorSeconds: number;
  shardCount: number;
  maxRequests: number;
}

export function estimateRun(config: RunConfig): CostEstimate {
  const assignments = planAssignments(config);
  let maxRequests = 0;
  let previous = config.profile.initialTarget;

  for (const stage of config.profile.stages) {
    // Use the greater endpoint as a conservative upper bound for a ramp.
    if (config.profile.mode === "arrival-rate") {
      maxRequests += Math.max(previous, stage.target) * stage.durationSeconds;
    }
    previous = stage.target;
  }

  return {
    generatorSeconds:
      assignments.length *
      config.profile.stages.reduce(
        (sum, stage) => sum + stage.durationSeconds,
        0,
      ),
    shardCount: assignments.length,
    maxRequests,
  };
}
