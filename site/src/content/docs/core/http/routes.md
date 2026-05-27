---
title: Routes
description: Inline handlers, controller classes, route groups, and how to register HTTP endpoints.
sidebar:
  order: 1
---

Flare registers HTTP routes in two ways: inline handlers on `host.http`, and controller classes mounted with `host.http.controller`. Most apps use both.

For matching rules, 404/405, HEAD, OPTIONS, CORS preflight, wildcards, and URL decoding, see [Routing reference](/core/http/routing-reference/).

## Registration surface

Everything on this page registers on `host.http` or inside a route group via `host.http.group(prefix, (g) => { … })`. The arc and the group builder expose the same route and middleware registration methods.

| API                                                                     | Signature                                                           | Purpose                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `.get` / `.post` / `.put` / `.patch` / `.delete` / `.head` / `.options` | `(path, handler)` or `(path, options, handler)`                     | Inline route handlers (`RouteHandler`)          |
| `.controller(prefix, Cls)`                                              | `(string, class)`                                                   | Class-based controllers with `@Get`, `@Post`, … |
| `.group(prefix, fn)`                                                    | `(string, (g) => g.register())`                                     | Prefixed route groups                           |
| `.cors(config)`                                                         | `(CorsConfig)`                                                      | Arc-wide CORS; groups replace with `g.cors()`   |
| `.use(Cls)`                                                             | `(MiddlewareBase subclass)`                                         | Global middleware class                         |
| `.before` / `.after` / `.finally`                                       | `(handler)` or `(options, handler)`                                 | Inline middleware hooks                         |
| `.error`                                                                | `(handler)`, `(options, handler)`, or `(ErrorHandlerBase subclass)` | HTTP error handlers                             |

There is no `host.http.route` or `host.http.all` helper. Register each HTTP method explicitly, or use multiple decorators on one controller class.

## Public exports

| Symbol                                                               | Import from                 | Role                                                                             |
| -------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `RouteHandler`                                                       | `@flare-ts/core`            | Inline route callback: `(ctx, scope) => HandlerResult \| Promise<HandlerResult>` |
| `RouteOptions`                                                       | `@flare-ts/core`            | Optional second argument on `.get` / `.post` / … (see below)                     |
| `FlareHandlerScope`                                                  | `@flare-ts/core`            | Second argument to inline handlers (`inject`, `config`)                          |
| `Get`, `Post`, `Put`, `Patch`, `Delete`, `Head`, `Options`, `Method` | `@flare-ts/core/decorators` | Controller method decorators                                                     |

```ts
import type {
  RouteHandler,
  RouteOptions,
  FlareHandlerScope,
} from "@flare-ts/core";
import { Get, Post } from "@flare-ts/core/decorators";
```

## Inline handlers

Register a route with `host.http.<method>(path, [options], handler)`. Supported methods: **GET**, **POST**, **PUT**, **PATCH**, **DELETE**, **HEAD**, **OPTIONS**. The handler must satisfy `RouteHandler`.

The handler receives `(ctx, scope)` and returns a `HandlerResult` (see [Response](/core/http/response/)). Omit either parameter in TypeScript when you do not need it.

`scope` is a `FlareHandlerScope`:

| Member                | Purpose                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `scope.inject(Token)` | Resolves a service declared in `options.inject`                                                 |
| `scope.config(Token)` | Resolves config directly from the container (inline handlers have no `static config` guardrail) |

```ts
import { FlareResponse } from "@flare-ts/core";

host.http.get("/ping", () => new FlareResponse(200, { ok: true }));

host.http.get("/users/:id", (ctx) => {
  return new FlareResponse(200, { id: ctx.req.rawRouteParams["id"] });
});
```

Without a contract, matched path segments are plain strings on `ctx.req.rawRouteParams` (`Record<string, string>`). Query keys are on `ctx.req.rawQueryParams`, a [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) instance (read with `.get("key")`).

To validate and coerce inputs at the HTTP edge, declare a `contract` and call `ctx.extract(descriptor)` in the handler with the same descriptor reference you passed in `options.contract`. See [Contracts](/core/http/contracts/) for the descriptor shape and timing (route/query vs body).

### Path rules (inline routes)

- Paths must start with `/`.
- Paths must not end with `/`, except the lone path `/` is allowed.
- Paths must not contain empty segments (`//`); registration throws immediately.
- Registering the same HTTP method twice at the same path throws `Duplicate route registration for {METHOD} {path}. Each route can only have one handler per HTTP method.` (inline routes: when you call the second `.get` / `.post` / …; controller decorators: when you call `host.build()`).

You can register different methods at the same path by calling `host.http.post(...)`, `host.http.get(...)`, and so on with the same `path`. Flare merges them into one synthetic controller.

### Route options (`RouteOptions`)

| Option     | Type                | Purpose                                                                                                                                                                                          |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract` | `RequestDescriptor` | Pipeline coercion and validation; `ctx.extract(descriptor)` returns typed `{ route, query, body }`                                                                                               |
| `inject`   | `ServiceToken[]`    | Services available via `scope.inject(Token)`                                                                                                                                                     |
| `state`    | `StateToken[]`      | `host.build()` fails if no upstream middleware `provides` each token; read values at runtime with `ctx.state.require(Token)`. See [Middleware](/core/http/middleware/) for declaring `provides`. |
| `isolated` | `boolean`           | When `true`, the route's pipeline has no middleware (default `false`). See [Middleware → Execution order](/core/http/middleware/#execution-order).                                               |
| `name`     | `string`            | Optional display name for the generated controller wrapper (defaults from HTTP method and path)                                                                                                  |

```ts
import { FlareResponse } from "@flare-ts/core";
import { int } from "@flare-ts/lib/schema";
// Db: ServiceToken, AuthUser: StateToken

const getUser = { route: { id: int } };

host.http.get(
  "/users/:id",
  { contract: getUser, inject: [Db], state: [AuthUser] },
  (ctx, scope) => {
    const { route } = ctx.extract(getUser);
    const me = ctx.state.require(AuthUser);
    const row = scope.inject(Db).find(route.id);
    return new FlareResponse(200, { ...row, viewedBy: me.id });
  },
);
```

## Controllers

When several routes share a prefix, contract, services, or state tokens, promote them to a `ControllerBase` subclass and mount with `host.http.controller(prefix, Cls)`:

```ts
import { ControllerBase, flareContract } from "@flare-ts/core";
import { Get, Post } from "@flare-ts/core/decorators";
import { int } from "@flare-ts/lib/schema";

const UsersContract = flareContract({
  show: { route: { id: int } },
});

class UsersController extends ControllerBase {
  public static override deps = [];
  public static override state = [];
  public static override contract = UsersContract;

  @Get("/:id")
  show() {
    const { route } = this.ctx.extract(UsersContract.show);
    return this.ok({ id: route.id });
  }
}

host.http.controller("/users", UsersController);
```

A controller class needs at least one decorated handler method. Mounting a class with none makes `host.build()` throw `Controller {name} has no route handlers. Add at least one decorated method.`

### Instance members

On a controller instance you get:

| Member                | What you get                                                                  |
| --------------------- | ----------------------------------------------------------------------------- |
| `this.ctx`            | The `FlareHttpContext` for the in-flight request                              |
| `this.ctx.extract(D)` | Typed `{ route, query, body }` for the descriptor entry bound to this handler |
| `this.inject(Token)`  | A service from the scoped container, limited to tokens in `static deps`       |
| `this.config(Token)`  | A config section, limited to tokens in `static config`                        |

There is no `this.req` on a controller. Read request data from `this.ctx.req` or typed contract values from `this.ctx.extract(...)`.

### Required static members

| Member            | Required? | Purpose                                                       |
| ----------------- | --------- | ------------------------------------------------------------- |
| `static deps`     | Yes       | Services this controller may inject (`[]` if none)            |
| `static state`    | Yes       | State tokens any handler reads via `ctx.state` (`[]` if none) |
| `static contract` | Optional  | Shared `flareContract` for `this.ctx.extract`                 |
| `static config`   | Optional  | Config tokens this controller may read via `this.config`      |

Each handler method that calls `this.ctx.extract(...)` needs a matching key in `static contract`. The `@Get("/:id")` method above is named `show`, so the contract entry is `show`, not `get`. Extra contract keys with no matching handler emit an [`ORPHANED_CONTRACT_ENTRY`](/core/failure-modes/) warning at `host.build()` (does not fail the build).

### Response helpers

Handler methods inherit these **protected** helpers from `ControllerBase`. Each returns a `ResponseLike`. The `body` argument is a `JsonValue` (JSON object or string).

| Helper                         | Status         | Notes                                                                |
| ------------------------------ | -------------- | -------------------------------------------------------------------- |
| `ok(body)`                     | 200            | JSON or text body                                                    |
| `created(body)`                | 201            | JSON or text body                                                    |
| `noContent()`                  | 204            | Empty body                                                           |
| `redirect(location, options?)` | 302 by default | `RedirectOptions`: `permanent` → 301/308; `preserveMethod` → 307/308 |
| `badRequest(body)`             | 400            |                                                                      |
| `unauthorized(body)`           | 401            |                                                                      |
| `forbidden(body)`              | 403            |                                                                      |
| `notFound(body)`               | 404            |                                                                      |
| `tooManyRequests(body)`        | 429            |                                                                      |
| `error(body)`                  | 500            | HTTP response helper; not the same as `host.http.error`              |

For return shapes beyond these helpers (plain objects, streams, `FlareResponse`), see [Response](/core/http/response/).

### Method decorators

`@flare-ts/core/decorators` exports `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, `@Options`, and `@Method(method, path?)`. All decorators accept only the supported methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.

TypeScript developers often expect routing decorators to depend on legacy [`experimentalDecorators`](https://www.typescriptlang.org/docs/handbook/decorators.html) and [`reflect-metadata`](https://github.com/rbuckton/reflect-metadata). Flare uses [TC39 stage 3 decorators](https://github.com/tc39/proposal-decorators): each decorator writes `{ method, path }` into decorator metadata on the class, which Flare reads when you call `host.build()`. No `reflect-metadata` package is involved.

```ts
@Get("") // controller root at the mount prefix
@Get("/:id") // prefix + "/:id"
@Post("")
@Delete("/:id")
@Method("GET") // path omitted → controller root (same as @Get(""))
```

Named decorators (`@Get`, `@Post`, …) require a `path` argument. Use `""` for the controller root. `@Method` may omit `path`. Do not pass `"/"`: the decorator throws at evaluation time. Omit the argument or use `""` for the controller root instead.

Decorator paths follow the same rules as inline routes, except controller root routes use `""` rather than `"/"`. Non-root paths must start with `/` and must not end with `/`.

## Groups

`host.http.group(prefix, fn)` applies a shared path prefix. The `prefix` must start with `/`, must not end with `/` (except the lone `/` root prefix is unusual for groups), and must not contain empty segments (`//`). Invalid prefixes throw at registration time with the same shape rules as route paths.

Middleware registered inside the callback runs only for routes in that group; global middleware still runs for non-isolated groups.

```ts
import { FlareResponse } from "@flare-ts/core";

host.http.group("/v1", (g) => {
  g.use(LoggingMiddleware); // applies only to /v1/*
  g.get("/health", () => new FlareResponse(200, { ok: true }));
  g.controller("/users", UsersController); // mounts at /v1/users
  return g.register();
});
```

The builder callback **must** `return g.register()`. That call finalizes the group so `host.http.group` can attach it under the prefix.

Inside `host.http.group`, the group builder `g` exposes the same route and middleware registration methods as `host.http`, plus group-scoped controls:

| Method                               | Purpose                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `g.get` / `g.post` / …               | Same inline route overloads as `host.http` (`RouteHandler`, optional `RouteOptions`)                                                        |
| `g.controller(prefix, Cls)`          | Controllers mounted under `group prefix + controller prefix`                                                                                |
| `g.use(Cls)`                         | Middleware that runs only for routes in this group                                                                                          |
| `g.before` / `g.after` / `g.finally` | Inline hooks scoped to this group: `(handler)` or `(MiddlewareOptions, handler)`                                                            |
| `g.error`                            | Group-scoped error handlers: function, `(ErrorHandlerOptions, handler)`, or `ErrorHandlerBase` subclass                                     |
| `g.cors(config)`                     | Replaces the arc-level CORS policy for every route registered in this group                                                                 |
| `g.isolated()`                       | Skips global middleware for routes in this group; register what you need with `g.use()` (or group-scoped hooks) inside the group instead    |
| `g.exclude([Cls, …])`                | Drops specific global middleware classes from this group's chain. `host.build()` throws if an excluded class was never registered globally. |
| `g.replace(from, to)`                | Swaps one global middleware class for another in this group                                                                                 |
| `g.register()`                       | Finalizes the group; return this from the builder callback                                                                                  |

The group builder has no `.group()`, so groups do not nest. To share a longer prefix, use one group with a combined prefix (for example `/api/v1`) or register separate top-level groups.

For middleware ordering with `isolated`, `exclude`, and `replace`, see [Middleware → Execution order](/core/http/middleware/#execution-order).

### Middleware options (`MiddlewareOptions`)

Used with `g.before`, `g.after`, `g.finally`, and the arc-level equivalents:

| Option     | Purpose                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| `inject`   | Service tokens available via `scope.inject`                               |
| `state`    | State tokens the hook reads via `ctx.state`                               |
| `provides` | State tokens written for downstream handlers ([State](/core/http/state/)) |
| `name`     | Optional display name for the generated middleware wrapper                |

### Error handler options (`ErrorHandlerOptions`)

Used with function handlers registered via `g.error(options, handler)` or `host.http.error(options, handler)`:

| Option   | Purpose                                                       |
| -------- | ------------------------------------------------------------- |
| `inject` | Service tokens available via `scope.inject`                   |
| `name`   | Optional display name for the generated error-handler wrapper |

Class-based error handlers (`.error(MyHandler)` where `MyHandler extends ErrorHandlerBase`) do not take options; declare `static deps` on the class instead. See [HTTP errors](/core/http/errors/).

## CORS registration

Register CORS on the arc or inside a group:

```ts
host.http.cors({
  origins: ["https://app.example.com"],
  credentials: true,
});

host.http.group("/public", (g) => {
  g.cors({ origins: ["*"], credentials: false });
  g.get("/health", () => new FlareResponse(200, { ok: true }));
  return g.register();
});
```

At the arc level (`host.http.cors()`), the policy applies to every route **not** inside a group with its own `.cors()` call. At the group level (`g.cors()`), the policy **fully replaces** the arc-level policy for routes registered inside that group.

`CorsConfig` fields (exported as `CorsConfig` from `@flare-ts/core`):

| Field         | Required? | Purpose                                                                                                               |
| ------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `origins`     | Yes       | `'*'`, a single origin string, an allowlist array, or `(origin) => boolean \| Promise<boolean>`                       |
| `methods`     | No        | Allowed methods; when omitted, derived from registered handlers per path at `host.build()`                            |
| `headers`     | No        | Allowed request headers on preflight (`Access-Control-Allow-Headers`)                                                 |
| `expose`      | No        | Response headers exposed to client JS (`Access-Control-Expose-Headers`)                                               |
| `credentials` | No        | Whether credentials are allowed. Incompatible with `origins: '*'`: `host.build()` throws `CORS_CREDENTIALS_WILDCARD`. |
| `maxAge`      | No        | Preflight cache seconds (default `7200`). Negative values throw `CORS_NEGATIVE_MAX_AGE` at `host.build()`.            |

Partial wildcards such as `'*.example.com'` are invalid; `host.build()` throws `CORS_PARTIAL_WILDCARD`.

For CORS behavior and OPTIONS semantics, see [Routing reference](/core/http/routing-reference/).
