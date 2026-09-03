import { DEMO_RUN_CONFIG, type RunConfig } from "../../shared/types";

export interface RunSubmission {
  mode: "custom" | "demo";
  config: RunConfig;
}

export function selectRunSubmission(
  appliedAdminToken: string,
  draft: RunConfig,
): RunSubmission {
  return appliedAdminToken
    ? { mode: "custom", config: draft }
    : { mode: "demo", config: DEMO_RUN_CONFIG };
}
