import { describe, expect, it } from "vitest";
import { DEMO_RUN_CONFIG } from "./types";
import { allocateInteger, estimateRun, planAssignments } from "./planner";

const stageTotals = (stage: number) =>
  planAssignments(DEMO_RUN_CONFIG).reduce(
    (sum, assignment) => sum + (assignment.profile.stages[stage]?.target ?? 0),
    0,
  );

describe("allocateInteger", () => {
  it("preserves the global target", () => {
    expect(allocateInteger(17, [40, 30, 30]).reduce((a, b) => a + b, 0)).toBe(
      17,
    );
  });

  it("uses stable largest-remainder allocation", () => {
    expect(allocateInteger(5, [34, 33, 33])).toEqual([2, 2, 1]);
  });
});

describe("planAssignments", () => {
  it("does not multiply the requested global load", () => {
    expect(stageTotals(0)).toBe(6);
    expect(stageTotals(1)).toBe(15);
    expect(stageTotals(2)).toBe(3);
  });

  it("plans one demo shard per region", () => {
    const assignments = planAssignments(DEMO_RUN_CONFIG);
    expect(assignments.map((assignment) => assignment.region)).toEqual([
      "ENAM",
      "WEUR",
      "APAC",
    ]);
  });

  it("provides a conservative estimate", () => {
    expect(estimateRun(DEMO_RUN_CONFIG)).toEqual({
      generatorSeconds: 60,
      shardCount: 3,
      maxRequests: 255,
    });
  });
});
