import { DurableObject } from "cloudflare:workers";
import type { RegionCode, RunConfig } from "../../shared/types";
import type { Env } from "../env";

interface Lease {
  isDemo: boolean;
  expiresAt: number;
  regions?: Partial<Record<RegionCode, number>>;
}

interface BudgetState {
  day: string;
  demoRunsToday: number;
  leases: Record<string, Lease>;
}

export interface ReservationResult {
  ok: boolean;
  reason?: string;
}

export class BudgetCoordinator extends DurableObject<Env> {
  private state: BudgetState = {
    day: new Date().toISOString().slice(0, 10),
    demoRunsToday: 0,
    leases: {},
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state =
        (await ctx.storage.get<BudgetState>("state")) ??
        ({
          day: new Date().toISOString().slice(0, 10),
          demoRunsToday: 0,
          leases: {},
        } satisfies BudgetState);
      await this.cleanup();
    });
  }

  async reserve(
    runId: string,
    isDemo: boolean,
    durationSeconds: number,
    requestedRegions: RunConfig["regions"],
  ): Promise<ReservationResult> {
    await this.cleanup();
    if (this.state.leases[runId]) return { ok: true };

    const active = Object.values(this.state.leases);
    const sameMode = active.filter((lease) => lease.isDemo === isDemo).length;
    const maxActive = numberVar(
      isDemo ? this.env.DEMO_MAX_ACTIVE_RUNS : this.env.CUSTOM_MAX_ACTIVE_RUNS,
      isDemo ? 2 : 4,
    );
    if (sameMode >= maxActive) {
      return {
        ok: false,
        reason: `Capacity is full (${maxActive} active runs)`,
      };
    }

    const requested = Object.fromEntries(
      requestedRegions.map((region) => [region.code, region.shards]),
    ) as Partial<Record<RegionCode, number>>;
    const activeByRegion: Partial<Record<RegionCode, number>> = {};
    let activeGenerators = 0;
    for (const lease of active) {
      for (const [code, count] of Object.entries(lease.regions ?? {})) {
        const region = code as RegionCode;
        activeByRegion[region] = (activeByRegion[region] ?? 0) + (count ?? 0);
        activeGenerators += count ?? 0;
      }
    }

    const requestedGenerators = Object.values(requested).reduce(
      (sum, count) => sum + (count ?? 0),
      0,
    );
    const maxGenerators = numberVar(this.env.MAX_ACTIVE_GENERATORS, 12);
    if (activeGenerators + requestedGenerators > maxGenerators) {
      return {
        ok: false,
        reason: `Generator capacity is full (${maxGenerators} active instances)`,
      };
    }

    const maxPerRegion = numberVar(this.env.MAX_INSTANCES_PER_REGION, 4);
    for (const [code, count] of Object.entries(requested)) {
      const region = code as RegionCode;
      if ((activeByRegion[region] ?? 0) + (count ?? 0) > maxPerRegion) {
        return {
          ok: false,
          reason: `${region} capacity is full (${maxPerRegion} active instances)`,
        };
      }
    }

    if (isDemo) {
      const maxDaily = numberVar(this.env.DEMO_MAX_DAILY_RUNS, 30);
      if (this.state.demoRunsToday >= maxDaily) {
        return {
          ok: false,
          reason: "The public demo has reached its daily budget",
        };
      }
      this.state.demoRunsToday += 1;
    }

    this.state.leases[runId] = {
      isDemo,
      expiresAt: Date.now() + (durationSeconds + 180) * 1_000,
      regions: requested,
    };
    await this.persist();
    return { ok: true };
  }

  async release(runId: string): Promise<void> {
    if (this.state.leases[runId]) {
      delete this.state.leases[runId];
      await this.persist();
    }
  }

  async status(): Promise<{
    demoRunsToday: number;
    activeDemo: number;
    activeCustom: number;
    activeGenerators: number;
  }> {
    await this.cleanup();
    const leases = Object.values(this.state.leases);
    return {
      demoRunsToday: this.state.demoRunsToday,
      activeDemo: leases.filter((lease) => lease.isDemo).length,
      activeCustom: leases.filter((lease) => !lease.isDemo).length,
      activeGenerators: leases.reduce(
        (total, lease) =>
          total +
          Object.values(lease.regions ?? {}).reduce(
            (sum, count) => sum + (count ?? 0),
            0,
          ),
        0,
      ),
    };
  }

  async alarm(): Promise<void> {
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    let changed = false;
    if (this.state.day !== today) {
      this.state.day = today;
      this.state.demoRunsToday = 0;
      changed = true;
    }
    for (const [runId, lease] of Object.entries(this.state.leases)) {
      if (lease.expiresAt <= Date.now()) {
        delete this.state.leases[runId];
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
    const expiries = Object.values(this.state.leases).map(
      (lease) => lease.expiresAt,
    );
    if (expiries.length > 0)
      await this.ctx.storage.setAlarm(Math.min(...expiries));
  }
}

function numberVar(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
