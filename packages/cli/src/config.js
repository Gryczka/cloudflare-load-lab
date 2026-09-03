import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export async function readConfig(filename) {
  const source = await fs.readFile(filename, "utf8");
  const extension = path.extname(filename).toLowerCase();
  const config =
    extension === ".json" ? JSON.parse(source) : YAML.parse(source);
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  if (!config || typeof config !== "object")
    throw new Error("Configuration must be an object");
  if (config.version !== 1)
    throw new Error("Only configuration version 1 is supported");
  if (!config.name || typeof config.name !== "string")
    throw new Error("name is required");
  if (!Array.isArray(config.tasks) || config.tasks.length === 0)
    throw new Error("At least one task is required");
  if (
    !config.profile ||
    !Array.isArray(config.profile.stages) ||
    config.profile.stages.length === 0
  ) {
    throw new Error("profile.stages must contain at least one stage");
  }
  if (!Array.isArray(config.regions) || config.regions.length === 0)
    throw new Error("At least one region is required");
  for (const task of config.tasks) {
    if (
      typeof task.path !== "string" ||
      !task.path.startsWith("/") ||
      task.path.startsWith("//")
    ) {
      throw new Error(
        `Task path must be origin-relative: ${task.path ?? "<missing>"}`,
      );
    }
  }
  const shards = config.regions.reduce(
    (sum, region) => sum + (region.shards ?? 1),
    0,
  );
  if (shards > 12) throw new Error("This deployment allows at most 12 shards");
  return config;
}

export function plan(config) {
  validateConfig(config);
  const durationSeconds = config.profile.stages.reduce(
    (sum, stage) => sum + stage.durationSeconds,
    0,
  );
  const shards = config.regions.reduce(
    (sum, region) => sum + (region.shards ?? 1),
    0,
  );
  const peak = Math.max(
    config.profile.initialTarget ?? 0,
    ...config.profile.stages.map((stage) => stage.target),
  );
  return {
    durationSeconds,
    shards,
    generatorSeconds: durationSeconds * shards,
    peak,
    regions: config.regions.map((region) => region.code),
  };
}
