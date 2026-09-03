# Threat model

Load generation is dual-use. The public deployment is designed to demonstrate orchestration without offering anonymous arbitrary-target traffic.

## Enforced boundaries

- Anonymous runs ignore client configuration and use a server-owned target, profile, and three-region distribution.
- Custom runs require a high-entropy administrator Bearer token. Authenticated operators may apply a custom profile to the server-owned built-in target without adding an external origin.
- Custom origins must use HTTPS and contain no path, query, fragment, or credentials.
- Ownership verification uses a random challenge served from a well-known path and expires after 24 hours.
- Operators may explicitly allow exact hostnames through `ALLOWED_TARGET_HOSTS` for controlled staging environments.
- Task paths must be origin-relative and protocol-relative paths are rejected.
- Redirects are disabled in generated k6 requests.
- Container internet access defaults off; runtime allowlists include only the target and callback host.
- Obvious local, loopback, link-local, metadata, and `.internal` hosts are rejected or denied.
- Public starts are edge-rate-limited and globally capped by concurrent and daily Durable Object budgets.
- A singleton budget coordinator atomically reserves total and per-region generator capacity before any Container starts.
- Duration, peak load, shard count, request body size, and configuration size are bounded.
- Control-plane callback tokens are random per assignment, held by the Go agent, and never exposed to k6 through `__ENV`.
- Sensitive-looking request headers are redacted from final snapshots.

## Known limitations

Hostname allowlists are not a substitute for full DNS-rebinding protection. `global_fetch_strictly_public` protects the Worker's verification fetch, and Containers deny known private names, but an operator should still restrict custom access to trusted users and verify platform egress behavior for their threat model.

Task request bodies may contain sensitive test fixtures and remain in the per-run Durable Object until completion. Do not place production credentials in declarative configuration. A future release should use named encrypted secret references delivered directly to the generator.

The public demo's IP limiter is deliberately only a first filter; IP addresses may represent NATs or rotate. The daily and active-run budget is the final cost boundary.

## Operational recommendations

- Keep `PUBLIC_DEMO_MODE` disabled for private deployments that do not need it.
- Rotate `ADMIN_TOKEN` and avoid putting it in URLs or persistent browser storage.
- Start with low `max_instances`, peak load, and duration caps.
- Use a dedicated staging origin with representative data.
- Configure target-side rate limits and an emergency deny rule.
- Monitor Container starts, callback rejection, run errors, and daily generator-seconds.
