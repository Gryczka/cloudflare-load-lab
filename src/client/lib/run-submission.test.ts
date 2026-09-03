import { describe, expect, it } from "vitest";
import { DEMO_RUN_CONFIG, type RunConfig } from "../../shared/types";
import { selectRunSubmission } from "./run-submission";

const customDraft: RunConfig = {
  ...structuredClone(DEMO_RUN_CONFIG),
  name: "Configured run",
  profile: {
    ...structuredClone(DEMO_RUN_CONFIG.profile),
    stages: [{ durationSeconds: 10, target: 47 }],
  },
  regions: [
    { code: "ENAM", weight: 25, shards: 1 },
    { code: "WNAM", weight: 25, shards: 1 },
    { code: "WEUR", weight: 25, shards: 1 },
    { code: "SAM", weight: 25, shards: 1 },
  ],
};

describe("selectRunSubmission", () => {
  it("keeps custom load and regions for an authenticated built-in target run", () => {
    const submission = selectRunSubmission("admin-token", customDraft);

    expect(submission.mode).toBe("custom");
    expect(submission.config).toBe(customDraft);
    expect(submission.config.profile.stages[0]?.target).toBe(47);
    expect(submission.config.regions.map((region) => region.code)).toEqual([
      "ENAM",
      "WNAM",
      "WEUR",
      "SAM",
    ]);
  });

  it("uses the fixed bounded plan without an administrator token", () => {
    const submission = selectRunSubmission("", customDraft);

    expect(submission).toEqual({ mode: "demo", config: DEMO_RUN_CONFIG });
    expect(
      Math.max(
        ...submission.config.profile.stages.map((stage) => stage.target),
      ),
    ).toBe(15);
  });
});
