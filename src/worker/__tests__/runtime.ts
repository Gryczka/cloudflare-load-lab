/** Test-only runtime base; never imported by the Worker entry point. */
export class DurableObject<T> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: T,
  ) {}
}
