---
title: State
description: Per-request state tokens (flareState), RouteOptions and MiddlewareOptions wiring, ctx.state, derivation, and compile-time provisioning checks.
sidebar:
  order: 5
---

Per-request **HTTP state** is typed data that lives on `FlareHttpContext` for one request. You create **state tokens** with `flareState()`, write values in middleware `before()` hooks, read them in route handlers via `ctx.state`, and declare dependencies in `static state` or `{ state: [...] }` so HTTP **compile** can verify an upstream middleware `provides` each token.

This is separate from [`host.state`](/core/host/), which is the host lifecycle enum (`"starting"` | `"ready"` | `"draining"` | `"stopped"`). HTTP state is request-scoped; host state is process-scoped.

## Public API

| Export                       | Role                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `flareState<T>(name?)`       | Factory; returns a `TypedStateToken<T>` builder with optional `.withDefault()`, `.from()`, `.withLogging()`            |
| `StateToken`                 | Opaque token reference for `static state` / `provides` arrays and other collections where the value type is not needed |
| `TypedStateToken<T>`         | Token with value type `T`; pass to `ctx.state.set`, `get`, and `require`                                               |
| `StateGetter`                | Read-only `{ state: { get, require } }` passed to `.from()` derivations                                                |
| `FlareReadonly<T>`           | Deep-readonly snapshot returned by `get` / `require`                                                                   |
| `RouteOptions.state`         | Inline route declaration of tokens read in the handler                                                                 |
| `MiddlewareOptions.state`    | Builder middleware declaration of tokens read in the hook                                                              |
| `MiddlewareOptions.provides` | Builder middleware declaration of tokens written in `before()`                                                         |
| `ControllerBase.state`       | Class declaration of tokens any handler method reads                                                                   |
| `MiddlewareBase.state`       | Class declaration of tokens the middleware reads                                                                       |
| `MiddlewareBase.provides`    | Class declaration of tokens the middleware writes                                                                      |
| `FlareHttpContext.state`     | Per-request `{ set, get, require }` API                                                                                |

`inject` lives on the same registration options objects (`RouteOptions`, `MiddlewareOptions`) but resolves **services**, not state. Use `state` / `provides` for request slots and `inject` / `static deps` for DI.

## Creating a token

```ts
import { flareState } from "@flare-ts/core";

const AuthUser = flareState<{ id: string; role: "admin" | "user"; }>(
  "AuthUser",
);
const RequestId = flareState<string>("RequestId");
```

The optional string `name` appears in error messages. Omit it and the token is labeled `(anonymous state)` in errors. The type parameter is the stored value shape: `ctx.state.set(AuthUser, value)` is checked against it.

Two calls to `flareState("AuthUser")` produce **two independent slots**. Identity is the object reference, not the name string.

### Token helpers

Optional builder methods on the object returned by `flareState()` (each callable at most once; `.withDefault()` and `.from()` may be called in either order):

| Helper                  | What you get on read                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.withDefault(value)`   | `require` / `get` return a deep-frozen `FlareReadonly<T>` of the default when nothing was `set` and `.from()` did not produce a value. The default is stored on first read and reused for the rest of the request. `value` cannot be `undefined`.                                                                                                                      |
| `.from((ctx) => value)` | On first read, Flare calls your function with `ctx` typed as `StateGetter` (read other tokens via `ctx.state.get` / `ctx.state.require` only; `set` is not on that type). A non-`undefined` result is deep-frozen, stored, and reused. If both `.from()` and `.withDefault()` are set, derivation runs first; `undefined` from `.from()` falls through to the default. |
| `.withLogging(mapper)`  | After each `set` (including values written by derivation or default resolution), `mapper` receives the frozen value and may return fields merged into the request logger's async-local store. Requires an active logger ALS frame; see [Context propagation](/core/logger/#context-propagation) for when that is available on each runtime.                            |

Calling a helper twice on the same token throws immediately (`[Flare] withDefault() can only be called once per token.`, `[Flare] from() can only be called once per token.`, or `[Flare] withLogging() can only be called once per token.`).

For auth or tenant context set in middleware, you usually only need `flareState()` plus a `before()` hook that `set`s the token. Helpers cover defaults, lazy derivation, and structured log fields without extra middleware.

## Declaring dependencies

HTTP compile checks wiring only for tokens you **declare**. Omit a token from `state` and compile skips the provider check for that consumer. At request time, `require` still throws `StateToken <name> not found in FlareHttpContext state.` when nothing resolves; use `get` when the token is optional.

### Controllers

```ts
import { ControllerBase, flareState } from "@flare-ts/core";
import { Get } from "@flare-ts/core/decorators";

const AuthUser = flareState<{ id: string; role: "admin" | "user"; }>(
  "AuthUser",
);

class MeController extends ControllerBase {
  public static override deps = [];
  public static override state = [AuthUser];

  @Get("")
  me() {
    return this.ok(this.ctx.state.require(AuthUser));
  }
}
```

Controllers must declare `public static override state = []` (or real tokens) at registration time, even when empty.

### Inline routes

`RouteOptions.state` merges into the synthetic controller's `static state` for compile:

```ts
import { FlareResponse, flareState } from "@flare-ts/core";

const AuthUser = flareState<{ id: string; role: "admin" | "user"; }>(
  "AuthUser",
);

host.http.get(
  "/me",
  { state: [AuthUser] },
  (ctx) => new FlareResponse(200, ctx.state.require(AuthUser)),
);
```

See [Route options](/core/http/routes/#route-options-routeoptions) for the full `RouteOptions` table.

### Middleware

Middleware that **writes** a token lists it in `provides`. Middleware that **reads** tokens from earlier hooks lists them in `static state` (class) or `{ state: [...] }` (builder).

```ts
import { MiddlewareBase, flareState } from "@flare-ts/core";

const AuthUser = flareState<{ id: string; role: "admin" | "user"; }>(
  "AuthUser",
);

class AuthMiddleware extends MiddlewareBase {
  public static override deps = [];
  public static override state = [];
  public static override provides = [AuthUser];

  before() {
    this.ctx.state.set(AuthUser, { id: "u1", role: "admin" });
  }
}

// builder equivalent
host.http.before({ provides: [AuthUser] }, (ctx) => {
  ctx.state.set(AuthUser, { id: "u1", role: "admin" });
});
```

See [MiddlewareOptions](/core/http/middleware/#middlewareoptions) for builder registration.

### Error handlers

Error handlers are **not** part of the state wiring graph:

- Error handler registration validates dependencies only (`static deps` on classes, `inject` on builder handlers).
- `ErrorHandlerOptions` has `inject` and `name` only; there is no `state` option for builder handlers.
- `ErrorHandlerBase` has no `static state` field.
- `handle(err, context)` receives `HttpErrorContext`, not `FlareHttpContext`, so there is no public `ctx.state` on the error-handler signature.

If you need request state inside error handling, resolve it before the throw (for example in middleware or the route handler) and pass it through `FlareError.detail`, an injected scoped service, or log context. See [HTTP errors](/core/http/errors/).

## Writing and reading

### Writing in middleware

`ctx.state.set(token, value)` does not check `provides` at runtime. HTTP compile compares each consumer's `state` list against middleware `provides` instead. If you `set` a token without listing it in `provides`, routes that declare the token in `state` fail compile with a missing-provider error.

The `set` signature enforces the value type only: `<T>(token: TypedStateToken<T>, value: T) => void`.

Only middleware with a **`before()`** hook can satisfy route `state` via `provides`. Listing `provides` on `after` / `finally`-only middleware does not count for routes, even if `static provides` or `{ provides: [...] }` is set. Put token writes in `before()` instead. An `after`-only middleware can still declare `provides` for downstream **`after` / `finally`-only middleware** that lists the token in `static state` or `{ state: [...] }` (see [Middleware consumers vs route consumers](#middleware-consumers-vs-route-consumers)).

Values are deep-frozen on write. Plain objects and arrays are supported; class instances and circular structures throw (see [Failure modes](/core/failure-modes/)).

### Reading in handlers

```ts
import { ControllerBase, FlareResponse, flareState } from "@flare-ts/core";
import { Get } from "@flare-ts/core/decorators";

const AuthUser = flareState<{ id: string; role: "admin" | "user"; }>(
  "AuthUser",
);

// inline
host.http.get(
  "/me",
  { state: [AuthUser] },
  (ctx) => new FlareResponse(200, ctx.state.require(AuthUser)),
);

// controller
class MeController extends ControllerBase {
  public static override deps = [];
  public static override state = [AuthUser];

  @Get("")
  me() {
    return this.ok(this.ctx.state.require(AuthUser));
  }
}
```

`ctx.state` API on `FlareHttpContext`:

| Call                          | Returns                                   | Throws if missing?                                            |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `ctx.state.require(token)`    | `FlareReadonly<T>` (deep-frozen snapshot) | Yes: `StateToken <name> not found in FlareHttpContext state.` |
| `ctx.state.get(token)`        | `FlareReadonly<T>` or `undefined`         | No                                                            |
| `ctx.state.set(token, value)` | `void`                                    | No at `set` time (see write restrictions above)               |

Reads always return frozen snapshots: mutating the returned object does not change stored state.

Resolution order on read: stored value → `.from()` derivation → `.withDefault()` fallback → `undefined`.

### Circular derivation

If `.from()` handlers mutually `require` each other, the second read throws at runtime:

```
[Flare] Circular state derivation detected for token "…". Check that your .from() functions do not require each other.
```

Other derivation failures are wrapped: `Error retrieving derivation for token <name>: …`

## Build-time checks

After validators pass, HTTP **compile** walks each route's middleware chain and checks provisioning.

### Route and controller consumers

For each route, compile verifies that **every token in the route's effective `state` list is provided by a middleware `before()` hook** in that route's chain. Tokens listed in `provides` on `after`- or `finally`-only middleware do not satisfy route `state` declarations.

Example failure (plain `Error`, not `FlareValidationError`):

```ts
import { FlareResponse, flareState } from "@flare-ts/core";

const AuthUser = flareState<{ id: string; }>("AuthUser");

host.http.get(
  "/me",
  { state: [AuthUser] },
  (ctx) => new FlareResponse(200, ctx.state.require(AuthUser)),
);

host.build();
// Error: … requires state token AuthUser that is not provided by any preceding middleware.
// Please ensure that a preceding middleware in the chain provides this state token.
```

Other compile failures:

- **Duplicate provider:** two middleware entries list the same token in `provides`. Message: `Duplicate state token provided by middleware … already provided by middleware …`
- **Missing provider for middleware:** a middleware's declared `state` token was not provided by an earlier hook (same message shape; consumer name is the middleware class).

### Middleware consumers vs route consumers

Route `state` and middleware with a **`before()`** hook both require upstream tokens from a middleware **`provides` that implements `before()`**. `after` / `finally`-only `provides` do not count.

Middleware that implements only **`after`** / **`finally`** checks declared `state` against **all** upstream `provides`, including from hooks that never run before the handler. That is why an `after`-only middleware can consume a token from another `after`-only provider, but route-facing tokens must still be written in `before()`.

### Global middleware state cycles

During `host.build()` validation (before HTTP compile), the **global** middleware list is checked for cycles in the `state` / `provides` graph. A cycle throws `FlareValidationError` with code `MIDDLEWARE_STATE_CYCLE`:

```
Circular state dependency in middleware chain: AuthMiddleware -> TenantMiddleware -> AuthMiddleware
```

Group-local middleware chains are **not** checked by that validator. Instead, HTTP compile verifies that each consumer's declared `state` tokens are provided by an earlier hook in the same chain. A cyclic group graph typically surfaces as a missing-provider compile error rather than `MIDDLEWARE_STATE_CYCLE`.

### Scoping: global, group, and isolated routes

| Scope                                                       | Effect on state provisioning                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global** middleware                                       | Satisfies every non-isolated route and non-isolated group route                                                                                                                                                                                                                                |
| **Group** middleware                                        | Satisfies routes registered inside that group only                                                                                                                                                                                                                                             |
| **Isolated group** (`g.isolated()`)                         | Skips global middleware; only group-local middleware runs. Register providers inside the group.                                                                                                                                                                                                |
| **Isolated route** (`{ isolated: true }` on `RouteOptions`) | Skips all middleware for that route. Declared `state` tokens with no upstream `before()` provider fail compile. `.from()` / `.withDefault()` resolve at request time only for tokens **not** listed in `state` (or omit `state` and use `get` / `require` without compile-time wiring checks). |

There is no controller-only middleware slot: mount shared auth on the group or globally. See [Middleware](/core/http/middleware/) and [Routes → Groups](/core/http/routes/#groups).

## Testing

```ts
import { flareState } from "@flare-ts/core";
import { mockContext } from "@flare-ts/core/testing";

const AuthUser = flareState<{ id: string; }>("AuthUser");

const ctx = mockContext({ state: new Map([[AuthUser, { id: "test" }]]) });
```

`mockContext({ state: new Map([[token, value]]) })` pre-seeds tokens on a synthetic `FlareHttpContext`. Keys must be token instances returned by `flareState()`. See [Testing](/core/testing/).

## Related

- [Middleware](/core/http/middleware/): hook lifecycle, `MiddlewareOptions`, execution order
- [Routes](/core/http/routes/): `RouteOptions`, controllers, groups
- [Dependency injection](/concepts/dependency-injection/): `inject` vs state tokens
- [Failure modes](/core/failure-modes/): compile and request-time state errors
- [Host](/core/host/): `host.state` lifecycle (not HTTP state)
