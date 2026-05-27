---
title: Composition & Startup Validation
description: How a Flare app is assembled and what host.build() validates before the server accepts traffic.
sidebar:
  order: 2
---

A Flare app is assembled by registering a graph of tokens, classes, and routes on `FlareHost`, then calling `host.build()` to validate the entire graph and compile per-route pipelines before the server accepts traffic. Registration is explicit: call `host.cfg()`, `host.scoped()` or `host.singleton()`, and `host.http.*` before `build()`. Registrations after the first successful `build()` are ignored because later calls return the cached app.

## The three pieces

```ts
import { FlareHost } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";

const host = new FlareHost(node);

host.cfg(DbConfig); // 1. config tokens
host.singleton(DbService); // 2. service registrations
host.http.controller("/api", ApiController); // 3. routes / arcs
```

1. **Config tokens**: sections of `flare.json` or `FLARE__` env vars you want typed (`flareConfig("db", { ... })`). Register each with `host.cfg(token)` so the host parses and validates that section during `build()`.
2. **Service registrations**: classes the DI container resolves. Use `host.scoped()` for per-request instances. Use `host.singleton()` for per-process instances on Node (singletons are created at `build()` in production). On Cloudflare Workers, `host.singleton()` throws at registration time; register the same class with `host.scoped()` instead. Both methods require a `static deps` array (may be `[]`). Omitting `static deps` throws when you call `host.scoped()` or `host.singleton()`, not at `build()`.
3. **Routes / arcs**: inline handlers, controllers, middleware, and groups on `host.http`. State tokens enter the graph when routes declare `state: [...]` and middleware declares `provides: [...]`.

Logger transports register on `host.logging`. Error handlers register on `host.http.error()`. CORS registers on `host.http.cors()`. See [Host](/core/host/) for the full registration table.

## What `build()` validates

`host.build()` is synchronous and runs in order: config compilation, logger bootstrap, three composite validator suites (service, then HTTP, then config), then HTTP arc compilation (pipelines, router, state wiring). Validator **errors** throw [`FlareValidationError`](/core/failure-modes/); **warnings** log after compilation succeeds (such as `DEAD_MIDDLEWARE` and `ORPHANED_CONTRACT_ENTRY`).

After validators pass, the HTTP arc compiles pipelines. State provisioning is checked here: if a controller's `static state` or a middleware class's `static state` includes a token that no earlier middleware `provides` in a `before()` hook, compilation throws a plain `Error`, not a `FlareValidationError`. See [Arc model](/concepts/arc-model/) for provisioning rules.

The sections below summarize the most common codes. See [Failure modes](/core/failure-modes/) for the full catalog, example messages, and registration-time errors.

### Service validator

Covers the dependency graph, captive deps, and lifecycle hooks.

- **`UNDECLARED_DEPENDENCY`**: a service lists `Foo` in `static deps` but `Foo` was never registered. Register it with `host.scoped()` or `host.singleton()` before `build()`.
- **`CIRCULAR_DEPENDENCY`**: A depends on B depends on A in the service graph. Break the cycle by restructuring `static deps` or introducing an intermediate service.
- **`CAPTIVE_DEPENDENCY`**: a singleton depends on a scoped service. Register the dependency as a singleton too, or make the dependent scoped.
- **`INVALID_LIFECYCLE_HOOK`** / **`CONTRADICTORY_LIFECYCLE_HOOKS`**: wrong hook for the lifetime (for example `onStart()` on a scoped service, or `dispose()` on a singleton). Use `onStop()` on singletons and avoid conflicting hooks on the same class.
- **`CONTROLLER_LIFECYCLE_HOOK`** / **`MIDDLEWARE_LIFECYCLE_HOOK`**: lifecycle hooks declared on a controller or middleware class. Move startup and shutdown logic to services or arc hooks instead.
- **`CONTROLLER_UNREGISTERED_DEP`** / **`MIDDLEWARE_UNREGISTERED_DEP`**: `static deps` references a service that was never registered. Register the service before `build()`.

`app.test({ replace })` re-runs the service validator against the post-replacement graph and checks that each replacement class extends the token being replaced (throws [`FlareTestError`](/core/failure-modes/#test-mode-extras), not [`FlareValidationError`](/core/failure-modes/)).

### HTTP validator

Covers routes, middleware, contracts, and CORS.

- **`ROUTE_WILDCARD_NOT_LAST`** / **`ROUTE_MISSING_PARAM_NAME`**: malformed path patterns. Fix the path string or param segment names.
- **`ROUTE_QUERY_PARAM_COLLISION`** / **`DUPLICATE_ROUTE_PARAM`**: route and query param name collisions. Rename one side.
- **`DUPLICATE_ROUTE_METHOD`** / **`DUPLICATE_ROUTE_PATTERN`** / **`DUPLICATE_ROUTE_PIPELINE`**: conflicting route registrations. Remove or rename the duplicate.
- **`MIDDLEWARE_STATE_CYCLE`**: mutual `state`/`provides` dependencies in global middleware. Restructure middleware order or split responsibilities.
- **`ORPHANED_CONTRACT_ENTRY`** (warning): contract entry with no matching handler method. Add the handler or remove the contract key.
- **`DEAD_MIDDLEWARE`** (warning): global middleware excluded by every controller. Remove the middleware or adjust group exclusions.
- **`CORS_CREDENTIALS_WILDCARD`** / **`CORS_PARTIAL_WILDCARD`**: invalid CORS origin/credentials combinations. Use an explicit origin list when `credentials: true`.

Contract body and query schemas validate on each request (invalid bodies return 400). Build time checks contract wiring only: orphaned handler keys warn as `ORPHANED_CONTRACT_ENTRY`, and unsupported route param types (such as `float` in a route segment) fail at HTTP compile. See [Contracts](/core/http/contracts/).

### Config validator

Covers config token registration and required fields.

- **`UNREGISTERED_CONFIG_TOKEN`**: a class declares `static config = [DbConfig]` but `host.cfg(DbConfig)` was never called. Call `host.cfg(DbConfig)` before `build()`.
- **`MISSING_CONFIG_KEY`** / **`MISSING_CONFIG_FIELD`**: a registered token's `flare.json` section or required descriptor field is absent. Add the section or field to config.
- Config schema parsing runs before the validator pass. Invalid types throw a plain `Error` (such as `Config validation failed: ...`) rather than `FlareValidationError`.

## Failure before traffic

Validator and compile failures both happen before the server binds a port:

```
$ tsx src/main.ts
Error: NoDepsService is missing static 'deps'.
    at FlareHost.scoped (...)
```

```
$ tsx src/main.ts
Error: [flare] Build failed with 1 validation error:

  1. [UNDECLARED_DEPENDENCY] Service GreetService has an undeclared dependency: TagService.
     Hint: Register TagService with host.scoped() or host.singleton() before calling host.build().
```

```
$ tsx src/main.ts
Error: MeController requires state token AuthUser that is not provided by any preceding middleware. Please ensure that a preceding middleware in the chain provides this state token.
```

A deploy that fails this way never accepts traffic with a half-built pipeline.

## Idempotent build

`host.build()` is safe to call multiple times. The second call returns the cached app:

```ts
const app = host.build(); // compiles
const same = host.build(); // returns the same app instance
```

This matters in tests. A typical entry file calls `build()` and `run()` at module scope. When your test imports that module, `build()` has already run. Calling `host.build()` again returns the same compiled app; validators and pipeline compilation do not run twice. To drive requests, call `app.test()` on that cached app to get a [`TestAppHandle`](/core/testing/).

In `FLARE_MODE=test`, scoped and singleton compilation are deferred until `app.test({ replace })` so test doubles can substitute classes before any constructor runs. HTTP arc compilation still runs on the first `host.build()`. When `app.test()` runs, scoped and singleton registrations compile so substituted classes can instantiate (pipelines and router are not recompiled). See [Testing](/core/testing/).
