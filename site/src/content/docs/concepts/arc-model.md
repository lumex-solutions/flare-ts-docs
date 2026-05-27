---
title: Arc Model
description: An arc is Flare's unit of transport-facing capability. HTTP is the only arc today; future releases will add more surfaces on the same host.
sidebar:
  order: 1
---

An **arc** is a transport-facing capability registered on `FlareHost`. Each arc owns how work enters the process (routing, protocol hooks, request-scoped machinery) and how results leave. Business logic stays in `FlareService` classes and shared config, which the host resolves once and makes available to every arc.

Today the host exposes one arc:

```ts
host.http;
```

## Why the arc/host split

Coupling domain code directly to HTTP means rewriting services when you add a second transport. Flare separates the two:

| Layer | Owns                                                        |
| ----- | ----------------------------------------------------------- |
| Arc   | Transport (paths, protocol middleware, arc-local lifecycle) |
| Host  | DI container, config, logger, composition, validation       |

A `FlareService` written for an HTTP controller can be injected from a future background worker or queue consumer without changes. The arc supplies the entry point; the service supplies the logic.

## HTTP arc registration

Register every HTTP entry point on `host.http`:

| Method                                                                           | Purpose                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `host.http.get` / `.post` / `.put` / `.patch` / `.delete` / `.head` / `.options` | Inline routes                                                                 |
| `host.http.controller(prefix, Cls)`                                              | Class-based controllers (`@Get`, `@Post`, … from `@flare-ts/core/decorators`) |
| `host.http.use(Cls)`                                                             | Global `MiddlewareBase`                                                       |
| `host.http.before` / `.after` / `.finally`                                       | Inline global middleware hooks                                                |
| `host.http.group(prefix, fn)`                                                    | Prefixed route groups with optional isolated middleware                       |
| `host.http.error(fn \| Cls)`                                                     | Central HTTP error mapping (function or `ErrorHandlerBase` subclass)          |
| `host.http.cors(config)`                                                         | Arc-wide CORS (groups can override)                                           |
| `host.http.onStart(fn)` / `.onStop(fn)`                                          | Arc lifecycle hooks (invoked when the app starts or stops)                    |

## Request pipeline

For each matched route, the compiled route pipeline runs middleware and the handler in this order:

1. Global and group `before` hooks (globals first, then group-local; registration order within each scope). See [Middleware](/core/http/middleware/#execution-order) for how globals and groups interleave.
2. Route handler (with contract body parsing immediately before the handler when the route declares a body)
3. `after` hooks (globals first, then group-local; registration order within each scope)
4. `finally` hooks (LIFO across the combined middleware list)

Route and query contract values are parsed on the request before any `before` hook runs so middleware can read typed `ctx.req` route and query fields. Body contracts run after the `before` chain and immediately before the handler so auth middleware can reject a request before the body is consumed.

Returning a non-`undefined` [`MiddlewareOverride`](/core/http/middleware/) from `before` (typically `new FlareResponse(...)`) skips the handler and all `after` hooks for that request. `finally` still runs. See [Middleware → Short-circuit rules](/core/http/middleware/#short-circuit-rules).

With a contract on the route, handlers receive coerced route, query, and body values (typed per the contract) instead of raw strings. See [Contracts](/core/http/contracts/).

## `build()` and the arc

`host.build()` finalizes the whole host in one synchronous call and returns a runtime-specific app (`run()` on Node, `export()` on Workers, `test()` when `FLARE_MODE=test`). A second call returns the cached app with no extra work.

In order, `build()`:

1. Compiles config and bootstraps the logger.
2. Runs three composite validator suites (service graph, HTTP routes/middleware/contracts/CORS, config tokens).
3. Compiles scoped and singleton DI registries (deferred until `app.test()` when `FLARE_MODE=test`).
4. Compiles the HTTP arc: per-route pipelines (middleware ordering, router) and state provisioning checks.

Validator failures throw [`FlareValidationError`](/core/failure-modes/). HTTP compile failures (including missing state providers) throw a plain `Error` with a descriptive message. Invalid config schema types throw a plain `Error` during step 1, before validators run. See [Composition](/concepts/composition/) for what each validator checks and [Failure modes](/core/failure-modes/) for the full error catalog.

### State provisioning at `build()` time

HTTP compile (during `host.build()`, after validators pass) verifies that every token listed in a route's or middleware's `static state` (or builder `{ state: [...] }`) is `provides`d by an earlier middleware in that route's chain. Build tracks two views of the chain:

| View        | What it tracks                                    | When `state` is checked                                  |
| ----------- | ------------------------------------------------- | -------------------------------------------------------- |
| Pre-handler | Tokens from middleware that implements `before()` | Route handlers and middleware with a `before()` hook     |
| Cumulative  | All tokens any middleware `provides`              | Middleware that implements only `after()` or `finally()` |

A middleware with only `after()` or `finally()` cannot satisfy a route's pre-handler `state` requirement: `provides` on that middleware updates the cumulative view but not the pre-handler view. Duplicate `provides` for the same token in one chain throws at `build()` time. See [State](/core/http/state/) for token wiring and [Middleware](/core/http/middleware/) for which hooks count toward `provides`.

Callbacks registered with `host.http.onStart()` and `host.http.onStop()` stay on the arc; the returned app's `start()` / `stop()` (or async variants) invoke them in registration order alongside singleton service lifecycle.

## Future arcs

:::caution[Not implemented]
Only `host.http` exists today. Background workers, WebSockets, and queue consumers are directional design targets with no host API yet.
:::

When new arcs ship, expect the same composition contract: a new host property, shared config and services unchanged, arc-local registration and a compile step in `build()`, and arc lifecycle wired into the app. Until then, keep domain code in `FlareService` classes so it's ready to inject when a second arc appears.

## Related

- [Composition](/concepts/composition/): what `build()` validates
- [Dependency injection](/concepts/dependency-injection/): scoped vs singleton
- [Routes](/core/http/routes/): inline routes and controllers
- [Middleware](/core/http/middleware/): pipeline phases and state provisioning
- [Host](/core/host/): adapters and lifecycle
