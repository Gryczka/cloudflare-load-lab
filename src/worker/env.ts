import type {
  GeneratorAPAC,
  GeneratorEEUR,
  GeneratorENAM,
  GeneratorSAM,
  GeneratorWEUR,
  GeneratorWNAM,
} from "./containers/generator";
import type { BudgetCoordinator } from "./durable-objects/budget-coordinator";
import type { RunCoordinator } from "./durable-objects/run-coordinator";

export interface Env {
  ASSETS: Fetcher;
  LOADLAB_DB: D1Database;
  LOADLAB_ARTIFACTS: R2Bucket;
  RUN_COORDINATOR: DurableObjectNamespace<RunCoordinator>;
  BUDGET_COORDINATOR: DurableObjectNamespace<BudgetCoordinator>;
  GENERATOR_ENAM: DurableObjectNamespace<GeneratorENAM>;
  GENERATOR_WNAM: DurableObjectNamespace<GeneratorWNAM>;
  GENERATOR_WEUR: DurableObjectNamespace<GeneratorWEUR>;
  GENERATOR_EEUR: DurableObjectNamespace<GeneratorEEUR>;
  GENERATOR_APAC: DurableObjectNamespace<GeneratorAPAC>;
  GENERATOR_SAM: DurableObjectNamespace<GeneratorSAM>;
  RUN_RATE_LIMITER: RateLimit;
  PUBLIC_DEMO_MODE: string;
  DEMO_MAX_ACTIVE_RUNS: string;
  DEMO_MAX_DAILY_RUNS: string;
  CUSTOM_MAX_ACTIVE_RUNS: string;
  MAX_ACTIVE_GENERATORS: string;
  MAX_INSTANCES_PER_REGION: string;
  ALLOWED_TARGET_HOSTS: string;
  REPOSITORY_URL: string;
  ADMIN_TOKEN?: string;
}
