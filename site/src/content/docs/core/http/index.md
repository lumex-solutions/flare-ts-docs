---
title: HTTP
description: "The HTTP arc on FlareHost: routes, middleware, state, contracts, and where each topic is documented."
sidebar:
  order: 0
---

`host.http` is Flare's **HTTP arc**: the registration surface for routes, middleware, request state, contracts, CORS, and error handlers. You compose everything on the host. When you call `host.build()`, Flare validates service, HTTP, and config registrations, then compiles route matching and per-route handler chains. Until `build()` runs, `host.http.fetch()` returns **503** with `{ error: "Application not ready. Call host.build() before handling requests." }`.

For why transport lives on an arc while services and config stay on the host, see [Arc model](/concepts/arc-model/). For validator codes and HTTP failure responses, see [Failure modes](/core/failure-modes/).

## Topics in this section

Read in this order if you are wiring HTTP for the first time:

1. **[Routes](/core/http/routes/)**: inline handlers, controller classes, groups, prefixes, and route options (`contract`, `state`, `inject`, `isolated`, `name`).
2. **[Middleware](/core/http/middleware/)**: `before` / `after` / `finally`, class vs builder hooks, group ordering, and short-circuit rules.
3. **[Request](/core/http/request/)**: `ctx.req`, headers, params, query, and request bodies.
4. **[Response](/core/http/response/)**: return values, `FlareResponse`, headers, and response shaping.
5. **[State](/core/http/state/)**: `flareState()` tokens, `provides`, derivation, and `ctx.state.require`.
6. **[Contracts](/core/http/contracts/)**: `flareContract`, `ctx.extract`, request validation, and response serializers.
7. **[HTTP errors](/core/http/errors/)**: `host.http.error`, `ErrorHandlerBase`, and HTTP error mapping.
8. **[Routing reference](/core/http/routing-reference/)**: matching semantics after `build()` (404/405, HEAD, OPTIONS, CORS preflight, wildcards, URL decoding).

Each page covers one concern. This index orients you; it does not repeat their tables and examples.

## Registration surface

Everything HTTP-facing registers on `host.http` (or inside a route group via `host.http.group`). Inline route handlers and builder-style middleware hooks receive `(ctx, scope)`. `after` and `finally` hooks also receive `result`. Error handlers receive the thrown value, `HttpErrorContext`, and `scope` (see [HTTP errors](/core/http/errors/)). For route and middleware handlers, `scope` is a `FlareHandlerScope` with `scope.inject(Token)` and `scope.config(Token)`.

| API                                                                     | Purpose                                                                                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `.get` / `.post` / `.put` / `.patch` / `.delete` / `.head` / `.options` | Inline route handlers: `(path, handler)` or `(path, options, handler)`                                                                          |
| `.controller(prefix, Cls)`                                              | Class-based controllers (`@Get`, `@Post`, … from `@flare-ts/core/decorators`)                                                                   |
| `.before` / `.after` / `.finally`                                       | Inline global middleware hooks: `(handler)` or `(options, handler)`                                                                             |
| `.use(Cls)`                                                             | Global `MiddlewareBase` class                                                                                                                   |
| `.group(prefix, fn)`                                                    | Prefixed route groups; the builder callback must `return g.register()`                                                                          |
| `.error(fn \| Cls)`                                                     | Central HTTP error mapping: `(handler)` or `(options, handler)` for functions; register classes with `.error(Cls)` only (no options)            |
| `.cors(config)`                                                         | Arc-wide CORS (groups can override with `g.cors()`; see [Routing reference → OPTIONS and CORS](/core/http/routing-reference/#options-and-cors)) |
| `.onStart(fn)` / `.onStop(fn)`                                          | Arc lifecycle hooks invoked during app start/stop                                                                                               |

### Route options (`RouteOptions`)

| Option     | Purpose                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract` | Request descriptor for request validation and typed `ctx.extract` ([Contracts](/core/http/contracts/))                                                                         |
| `inject`   | Service tokens available via `scope.inject`                                                                                                                                    |
| `state`    | State tokens the handler reads via `ctx.state`; each token must be provided by upstream middleware ([Middleware](/core/http/middleware/), [State](/core/http/state/))          |
| `isolated` | When `true`, the route skips global and group middleware; omit it (default) so middleware runs normally, or use it for endpoints like health checks that must bypass the chain |
| `name`     | Optional display name for logs and error targets (defaults from HTTP method and path)                                                                                          |

### Middleware options (`MiddlewareOptions`)

| Option     | Purpose                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| `inject`   | Service tokens available via `scope.inject`                               |
| `state`    | State tokens the hook reads via `ctx.state`                               |
| `provides` | State tokens written for downstream handlers ([State](/core/http/state/)) |
| `name`     | Optional display name for logs and error targets                          |

### Error handler options (`ErrorHandlerOptions`)

Applies only to function handlers registered with `.error(options, handler)`. Class handlers declare `static deps` only (no `state`).

| Option   | Purpose                                          |
| -------- | ------------------------------------------------ |
| `inject` | Service tokens available via `scope.inject`      |
| `name`   | Optional display name for logs and error targets |

### Group-only methods

Inside `host.http.group(prefix, (g) => { … return g.register(); })`, the group builder exposes the same route and middleware registration methods as `host.http`, plus:

| Method                | Purpose                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `g.isolated()`        | Skips global middleware for routes in this group; register what you need with `g.use(...)` or group-scoped hooks ([Middleware → Execution order](/core/http/middleware/#execution-order)) |
| `g.exclude([Cls, …])` | Drops specific global middleware classes from this group's chain                                                                                                                          |
| `g.replace(from, to)` | Swaps one global middleware class for another in this group                                                                                                                               |
| `g.cors(config)`      | Replaces the arc-level CORS policy for routes in this group                                                                                                                               |
| `g.register()`        | Finalizes the group; return this value from the builder callback                                                                                                                          |

Route groups do not nest (the group builder has no `.group()`). Use one group with a combined prefix (for example `/api/v1`) or register separate top-level groups. See [Routes → Groups](/core/http/routes/#groups).

### `ControllerBase` response helpers

When you mount a controller with `.controller`, handler methods inherit these protected helpers (plus `this.ctx`, `this.inject`, and `this.config` from `FlareBase`):

| Helper                         | Status                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| `ok(body)`                     | 200                                                           |
| `created(body)`                | 201                                                           |
| `noContent()`                  | 204                                                           |
| `redirect(location, options?)` | 302 (301/307/308 when `permanent` / `preserveMethod` are set) |
| `badRequest(body)`             | 400                                                           |
| `unauthorized(body)`           | 401                                                           |
| `forbidden(body)`              | 403                                                           |
| `notFound(body)`               | 404                                                           |
| `tooManyRequests(body)`        | 429                                                           |
| `error(body)`                  | 500                                                           |

Each helper returns a `ResponseLike` with the listed status. See [Routes → Controllers](/core/http/routes/#controllers) for static members, decorators, and `this.ctx.extract`.

```ts
import {
  ControllerBase,
  FlareHost,
  FlareResponse,
  MiddlewareBase,
} from "@flare-ts/core";
import { node } from "@flare-ts/core/node";

class UserController extends ControllerBase {
  static override deps = [];
  static override state = [];
}

class RequestLogMiddleware extends MiddlewareBase {
  static override deps = [];
  static override state = [];
}

const host = new FlareHost(node);

host.http.get("/health", () => new FlareResponse(200, { ok: true }));
host.http.controller("/users", UserController);
host.http.use(RequestLogMiddleware);
host.http.cors({ origins: ["https://app.example.com"] });

host.http.group("/api", (g) => {
  g.get("/status", () => new FlareResponse(200, { ok: true }));
  return g.register();
});

const app = host.build();
app.run();
```

Route decorators follow the [TC39 standard](https://github.com/tc39/proposal-decorators), not legacy `experimentalDecorators`. See [Routes → Method decorators](/core/http/routes/#method-decorators).

## Public exports (`@flare-ts/core`)

HTTP work typically imports from the default package entry:

| Symbol                                                                                                                                   | Role                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `FlareHost`                                                                                                                              | Composition root; exposes `host.http`                                                         |
| `FlareHttpContext`                                                                                                                       | Per-request context passed to `host.http.fetch(ctx)` and handler callbacks                    |
| `FlareRequest`                                                                                                                           | Request view on `ctx.req`                                                                     |
| `FlareResponse`                                                                                                                          | Framework response type                                                                       |
| `ControllerBase`, `MiddlewareBase`, `ErrorHandlerBase`, `FlareBase`                                                                      | Class-based registration bases (`FlareBase` is the shared base for controller helpers and DI) |
| `flareContract`, `flareState`                                                                                                            | Contract and state token factories                                                            |
| `HandlerResult`, `ResponseLike`, `MiddlewareOverride`, `ResponseHeaders`                                                                 | Handler and middleware return types                                                           |
| `RouteOptions`, `MiddlewareOptions`, `ErrorHandlerOptions`, `FlareHandlerScope`                                                          | Registration and scope types                                                                  |
| `RouteHandler`, `BeforeMiddlewareHandler`, `AfterMiddlewareHandler`, `FinallyMiddlewareHandler`, `FlareErrorHandler`, `HttpErrorContext` | Inline handler signatures and error context                                                   |
| `CorsConfig`                                                                                                                             | CORS policy shape for `.cors()`                                                               |
| `CookieOptions`                                                                                                                          | Cookie options on `FlareHttpContext`                                                          |
| `RedirectOptions`                                                                                                                        | Options for `ControllerBase.redirect`                                                         |

Route decorators (`Get`, `Post`, `Put`, `Patch`, `Delete`, `Head`, `Options`, `Method`) come from `@flare-ts/core/decorators`.

## Request path (overview)

At runtime the adapter builds a `FlareHttpContext` around the inbound request and calls `host.http.fetch(ctx)`. Malformed inbound pathnames (empty segments, trailing slash except `/`) return **400** before routing ([Routing reference → Inbound path rules](/core/http/routing-reference/#inbound-path-rules)). Flare selects the highest-priority matching route. No match yields **404** with `"Not Found"`. A path match with a disallowed method yields **405** and an `Allow` header listing permitted methods. When a handler matches, middleware hooks, the handler, error handlers on throw, and response normalization (including contract serializers when declared) run in order. The return value is a `ResponseLike` (`FlareResponse` or a platform `Response`).

Early exits (404, 405, 400, pre-build **503**, and Node shutdown **503**) skip middleware and `host.http.error()` handlers. See [Routing reference](/core/http/routing-reference/) and [Host → Node shutdown](/core/host/#node-shutdown).

Matcher tie-breaks, synthesized OPTIONS responses, contract timing (route/query vs body), and middleware short-circuit behavior are documented on the linked pages above.

## Related

| Goal                                       | Page                                  |
| ------------------------------------------ | ------------------------------------- |
| In-process HTTP requests in tests          | [Testing](/core/testing/)             |
| Schema primitives for contracts and config | [Lib → Schema](/lib/schema/)          |
| What `build()` validates before traffic    | [Composition](/concepts/composition/) |
