import { expect, it, vi } from "vitest";
vi.mock("@cloudflare/containers", () => ({
  Container: class {},
  ContainerProxy: class {},
}));
import staging from "./staging";

it("blocks generator starts and enforces streamed body limits with no per-run dispatch", async () => {
  const getByName = vi.fn(() => {
    throw new Error("Generator/run activation prohibited");
  });
  const env = {
    STAGE_SCOPE: "isolated-staging",
    STAGE_URL: "https://stage.example",
    STAGE_VERSION: { id: "fixture" },
    RUN_COORDINATOR: { getByName },
  } as unknown as Parameters<typeof staging.fetch>[1];
  const run = await staging.fetch(
    new Request(`${env.STAGE_URL}/api/runs`, {
      method: "POST",
      body: '{"demo":true}',
    }),
    env,
  );
  expect(run.status).toBe(503);
  expect(getByName).not.toHaveBeenCalled();
  expect(run.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  const oversized = await staging.fetch(
    new Request(`${env.STAGE_URL}/_stage/check/body`, {
      method: "POST",
      body: "x".repeat(4097),
    }),
    env,
  );
  expect(oversized.status).toBe(413);
});
