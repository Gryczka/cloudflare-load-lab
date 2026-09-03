import type { Env as WorkerEnv } from "./env";

declare global {
  interface Env extends WorkerEnv {}
}

export {};
