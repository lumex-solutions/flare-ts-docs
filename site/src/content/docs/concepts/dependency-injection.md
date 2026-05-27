---
title: Dependency Injection
description: Static deps arrays, ServiceToken vs StateToken, scoped vs singleton, and why Flare has no reflect-metadata.
sidebar:
  order: 3
---

Flare's DI is explicit and static. Every class declares what it depends on with a `static deps` array. The host resolves only what you listed, fails loudly at `build()` when the graph is broken, and never scans constructors or reads decorator metadata.

## Declaring dependencies

```ts
import { FlareService } from "@flare-ts/core";

class TagService extends FlareService {
  public static override deps = [];
  tag() {
    return "hello";
  }
}

class GreetService extends FlareService {
  public static override deps = [TagService];

  readonly #tags = this.inject(TagService);
  greet() {
    return `tag: ${this.#tags.tag()}`;
  }
}
```

Three rules:

1. **Every service declares `static deps`**, even if it is `[]`. Omitting it throws when you call `host.scoped()` or `host.singleton()`, or when you register a controller, middleware, or error-handler class on the HTTP arc. It does not fail lazily at `build()`.
2. **`this.inject(Token)` only resolves tokens listed in `deps`**. Calling `inject()` with an unlisted token throws at the call site with a message naming the class and token, and telling you to add the token to `static deps`. Listing a token in `deps` that was never registered is caught at `host.build()` as `UNDECLARED_DEPENDENCY` (services) or `CONTROLLER_UNREGISTERED_DEP` / `MIDDLEWARE_UNREGISTERED_DEP` (controllers and middleware). Error handlers are not checked by those validators: an unregistered service in a class error handler's `static deps` (or in a functional handler's `inject` option) fails at request time with `ServiceToken <name> not registered in container.`
3. **The host resolves lazily from what you registered**. Scoped services are constructed on the first `inject()` in a request, then cached for the rest of that request. Resolution order follows the dependency graph, not registration order.

## How resolution works

At request time the HTTP arc obtains a per-request DI scope and passes it into controllers, middleware, error handlers, and services:

1. **Singletons first.** Pre-built instances from the host's singleton map are returned when one exists. Singletons are created during `host.build()` in normal mode, or during `app.test()` / `app.reset()` in test mode so replacements can run before constructors execute.
2. **Scoped services next.** The scope runs the factory once per request, caches the instance, and returns it on later `inject()` calls in the same request.
3. **Config.** `this.config(token)` returns the typed section `T` for that `ConfigToken`, read from the merged `flare.json` object held by the scope. The same `static config` guardrail as `inject()` and `deps` applies: undeclared tokens throw at the call site.
4. **Disposal.** After the handler pipeline finishes, scoped instances are disposed in reverse creation order. `dispose()` may be sync or async. Failures are logged and do not block other disposes.

When the app has no scoped services at all, the HTTP arc reuses one shared scope across requests. As soon as any scoped service is registered, each request gets a fresh scope so isolation and disposal stay correct. In test mode, scoped registration is deferred until `app.test()`, so the host re-evaluates that decision after compile-for-test runs.

Circular graphs: `CIRCULAR_DEPENDENCY` is reported at build or test validation. If a factory creates a cycle at runtime, the scope throws `[flare] Circular service dependency detected while resolving "<name>". Check that your service factories do not call inject() on each other.`

## Token types

| Token          | What it identifies            | Where it lives                   | Declared on a class as                                               |
| -------------- | ----------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `ServiceToken` | A DI-resolvable service class | `host.scoped` / `host.singleton` | `static deps`                                                        |
| `StateToken`   | A per-request state slot      | `flareState()`                   | `static state` (routes/controllers) / `static provides` (middleware) |

Routes and controllers also have `ConfigToken` for typed `flare.json` sections, declared via `static config`. See [Core → Config](/core/config/).

## Lifetimes

```ts
host.scoped(DbConnection); // new instance per request, disposed after the response
host.singleton(MailService); // one instance for the process; onStart/onStop at app lifecycle
```

| Lifetime  | Instance created                                                         | Disposed              | Lifecycle hooks                                         | Workers?                                                                       |
| --------- | ------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Scoped    | First `inject()` in a request                                            | When the request ends | `dispose()`                                             | Yes                                                                            |
| Singleton | `host.build()` in normal mode; `app.test()` / `app.reset()` in test mode | On graceful shutdown  | `onStart()` when the app starts; `onStop()` on shutdown | No: use `host.scoped()` on Workers (`host.singleton()` throws at registration) |

The validator rejects captive scopes: a singleton that lists a scoped service in `static deps` would hold one request's instance for the lifetime of the process (`CAPTIVE_DEPENDENCY` at build). If a singleton needs request-scoped data, pass it into a method or resolve the scoped work inside the handler.

:::caution[Bun / Deno]
The `bun` and `deno` adapters are exported for forward compatibility but throw during `host.build()` today (`"Bun runtime is not yet supported"` / `"Deno runtime is not yet supported"`). Use the Node or Cloudflare adapter for local development until those runtimes ship. Singleton registration only applies where `host.singleton()` is supported (Node today). See [Host](/core/host/).
:::

## Build-time errors and runtime guardrails

Flare splits structured validator codes from plain runtime errors thrown by `inject()` and the request scope.

### Validator codes

| Code                          | When                                                                   | Fix                                                        |
| ----------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `UNDECLARED_DEPENDENCY`       | A service `static deps` entry is not registered                        | Call `host.scoped()` / `host.singleton()` before `build()` |
| `CIRCULAR_DEPENDENCY`         | Cycle in the service dependency graph                                  | Refactor or introduce an intermediary                      |
| `CAPTIVE_DEPENDENCY`          | Singleton `deps` includes a scoped token                               | Inject scoped deps in handlers, not singletons             |
| `CONTROLLER_UNREGISTERED_DEP` | Controller or inline route `inject` references an unregistered service | Register the service on the host                           |
| `MIDDLEWARE_UNREGISTERED_DEP` | Middleware `deps` references an unregistered service                   | Register the service on the host                           |

Validator codes throw as a build validation error from `host.build()` (see [Failure modes](/core/failure-modes/#phase-2-hostbuild)); `app.test()` / `app.reset()` surface the same codes as `FlareTestError` from `@flare-ts/core/testing` when the service suite re-runs after substitutions. Messages include a `hint` field. Full lists are in [Failure modes](/core/failure-modes/) and [Composition](/concepts/composition/).

In test mode, `host.build()` still runs the full validator suite (services, HTTP, and config). Only scoped and singleton **instantiation** is deferred until `app.test({ replace })` so stubs can substitute first. `app.test()` re-runs the service validator against the post-replacement graph and throws `FlareTestError` if the graph is invalid.

### Runtime guardrails

These throw plain `Error` during a request, not a build validation error:

| Trigger                                                                                 | Error (abridged)                                                                                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `inject()` token not in `static deps`                                                   | `[flare] GreetService called inject("TagService") but "TagService" is not declared in GreetService.deps. Add it to the static deps array.` |
| Scope missing a token (such as in `mockContainer` or an unregistered error-handler dep) | `ServiceToken TagService not registered in container.`                                                                                     |
| Circular resolution inside factories                                                    | `[flare] Circular service dependency detected while resolving "…". Check that your service factories do not call inject() on each other.`  |
| Missing `static deps` at registration                                                   | `TagService is missing static 'deps'.`                                                                                                     |

See [Failure modes](/core/failure-modes/) for the full request-time error catalog.

## Replacing services in tests

Integration tests swap implementations without a second host module:

```ts
class StubDb extends Db {
  override query() {
    return { ok: true, url: "stub" };
  }
}

const app = host.build();

await app.test({ replace: new Map([[Db, StubDb]]) });

// between tests:
await app.reset({ replace: new Map([[Db, StubDb]]) });

// restore originals:
await app.reset();
```

Rules enforced before the new graph compiles:

- The map key must be a registered service token (`host.scoped()` or `host.singleton()`).
- The replacement class must extend the token. If it does not, `FlareTestError` throws: `StubDb does not extend Db`.
- An unknown token throws: `Db is not a registered service. Replace targets must be registered via host.singleton() or host.scoped()`.
- After substitution, the service validator runs again. Invalid `static deps` on a stub fails setup, not the assertion inside the test body.

For unit tests that only need a fake scope, use `mockContainer` from `@flare-ts/core/testing`. Pass a map of token to instance; missing tokens throw `ServiceToken … not registered in container.` at `inject()` time:

```ts
import { mockContainer } from "@flare-ts/core/testing";

const container = mockContainer(
  new Map([[DbService, new StubDb()]]),
);
```

See [Testing](/core/testing/) for the full test API.

## Inline `inject` on routes

Standalone routes do not extend a class, so they declare deps in the route options:

```ts
host.http.get(
  "/db",
  { inject: [DbService] },
  (_ctx, scope) => scope.inject(DbService).query(),
);
```

`scope` is a `FlareHandlerScope` with `inject` and `config` methods. `scope.inject(Token)` uses the same guardrail as `this.inject(Token)` on a class: the token must appear in the route's `inject` array or it throws at the call site. Unregistered services in `inject` produce `CONTROLLER_UNREGISTERED_DEP` at `build()` because inline routes are validated like controller routes.

## Why `static deps` instead of decorator metadata

`static deps` gives you three things that constructor scanning via [`reflect-metadata`](https://www.npmjs.com/package/reflect-metadata) and [`experimentalDecorators`](https://www.typescriptlang.org/tsconfig/#experimentalDecorators) cannot:

- **Failures before traffic.** Broken graphs throw at `build()`, not when a request happens to hit the broken handler.
- **No toolchain requirements.** No `experimentalDecorators`, no `emitDecoratorMetadata`, no `reflect-metadata` package, no runtime metadata cost.
- **Consistent behavior across runtimes.** Decorator metadata semantics vary by runtime. `static deps` is a plain array read at startup; it behaves the same on Node, Workers, Bun, and Deno.

HTTP method decorators (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, `@Options` from `@flare-ts/core/decorators`) are pure routing sugar. They push a `{ method, path }` entry onto a static array on the controller class. No metadata API, no DI involvement.
