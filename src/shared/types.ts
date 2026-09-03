import { z } from "zod";

export const REGION_CODES = [
  "ENAM",
  "WNAM",
  "WEUR",
  "EEUR",
  "APAC",
  "SAM",
] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export const REGIONS: Record<
  RegionCode,
  {
    label: string;
    shortLabel: string;
    locationHint: string;
    mapX: number;
    mapY: number;
  }
> = {
  ENAM: {
    label: "Eastern North America",
    shortLabel: "E. North America",
    locationHint: "enam",
    mapX: 44,
    mapY: 18.5,
  },
  WNAM: {
    label: "Western North America",
    shortLabel: "W. North America",
    locationHint: "wnam",
    mapX: 33,
    mapY: 20,
  },
  WEUR: {
    label: "Western Europe",
    shortLabel: "W. Europe",
    locationHint: "weur",
    mapX: 66,
    mapY: 13.5,
  },
  EEUR: {
    label: "Eastern Europe",
    shortLabel: "E. Europe",
    locationHint: "eeur",
    mapX: 72,
    mapY: 13,
  },
  APAC: {
    label: "Asia Pacific",
    shortLabel: "Asia Pacific",
    locationHint: "apac",
    mapX: 80,
    mapY: 20,
  },
  SAM: {
    label: "South America",
    shortLabel: "South America",
    locationHint: "sam",
    mapX: 53,
    mapY: 42.5,
  },
};

const taskSchema = z.object({
  name: z.string().trim().min(1).max(80),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  path: z
    .string()
    .trim()
    .min(1)
    .max(1_024)
    .refine((value) => value.startsWith("/"), "Path must start with /")
    .refine(
      (value) => !value.startsWith("//"),
      "Path cannot be protocol-relative",
    ),
  body: z.string().max(32_768).optional(),
  headers: z.record(z.string().max(100), z.string().max(4_096)).default({}),
  expectedStatusMin: z.number().int().min(100).max(599).default(200),
  expectedStatusMax: z.number().int().min(100).max(599).default(399),
  thinkTimeMs: z.number().int().min(0).max(60_000).default(0),
});

const stageSchema = z.object({
  durationSeconds: z.number().int().min(1).max(3_600),
  target: z.number().int().min(0).max(100_000),
});

const profileSchema = z.object({
  mode: z.enum(["arrival-rate", "virtual-users"]).default("arrival-rate"),
  initialTarget: z.number().int().min(0).max(100_000).default(1),
  stages: z.array(stageSchema).min(1).max(20),
  maxVus: z.number().int().min(1).max(100_000).default(100),
});

const regionSchema = z.object({
  code: z.enum(REGION_CODES),
  weight: z.number().positive().max(100),
  shards: z.number().int().min(1).max(4).default(1),
});

export const runConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().trim().min(1).max(100),
    targetId: z.string().trim().min(1).max(100).default("demo"),
    targetOrigin: z.string().url().optional(),
    tasks: z.array(taskSchema).min(1).max(20),
    profile: profileSchema,
    regions: z.array(regionSchema).min(1).max(REGION_CODES.length),
    thresholds: z
      .object({
        p95Ms: z.number().int().min(1).max(60_000).default(500),
        errorRate: z.number().min(0).max(1).default(0.01),
      })
      .default({ p95Ms: 500, errorRate: 0.01 }),
    metadata: z.record(z.string().max(100), z.string().max(500)).default({}),
  })
  .superRefine((value, context) => {
    const codes = value.regions.map((region) => region.code);
    if (new Set(codes).size !== codes.length) {
      context.addIssue({
        code: "custom",
        path: ["regions"],
        message: "Regions must be unique",
      });
    }
    for (const [index, task] of value.tasks.entries()) {
      if (task.expectedStatusMax < task.expectedStatusMin) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "expectedStatusMax"],
          message:
            "Maximum status must be greater than or equal to minimum status",
        });
      }
    }
    const duration = value.profile.stages.reduce(
      (sum, stage) => sum + stage.durationSeconds,
      0,
    );
    if (duration > 3_600) {
      context.addIssue({
        code: "custom",
        path: ["profile", "stages"],
        message: "Total duration cannot exceed one hour",
      });
    }
  });

export type RunConfig = z.infer<typeof runConfigSchema>;
export type LoadTask = RunConfig["tasks"][number];
export type LoadProfile = RunConfig["profile"];

export interface PlannedAssignment {
  region: RegionCode;
  shard: number;
  weight: number;
  profile: LoadProfile;
}

export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "passed"
  | "failed"
  | "cancelled"
  | "error";

export const TERMINAL_STATUSES: RunStatus[] = [
  "passed",
  "failed",
  "cancelled",
  "error",
];

export const DEMO_RUN_CONFIG: RunConfig = runConfigSchema.parse({
  version: 1,
  name: "Global API pulse",
  targetId: "demo",
  tasks: [
    {
      name: "Edge response",
      method: "GET",
      path: "/api/demo-target?payload=2kb",
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      thinkTimeMs: 50,
    },
  ],
  profile: {
    mode: "arrival-rate",
    initialTarget: 3,
    stages: [
      { durationSeconds: 5, target: 6 },
      { durationSeconds: 10, target: 15 },
      { durationSeconds: 5, target: 3 },
    ],
    maxVus: 30,
  },
  regions: [
    { code: "ENAM", weight: 34, shards: 1 },
    { code: "WEUR", weight: 33, shards: 1 },
    { code: "APAC", weight: 33, shards: 1 },
  ],
  thresholds: { p95Ms: 750, errorRate: 0.02 },
  metadata: { source: "public-demo" },
});

export function runDurationSeconds(config: RunConfig): number {
  return config.profile.stages.reduce(
    (sum, stage) => sum + stage.durationSeconds,
    0,
  );
}
