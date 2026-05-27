---
title: Failure modes
description: When Flare throws during registration, host.build(), HTTP compile, and request handling, with real validation codes.
sidebar:
  order: 7
---

Flare separates **four failure phases**. Knowing which phase threw tells you whether to fix a registration call, a dependency graph, pipeline wiring, or a single request.

| Phase             | When                                         | Error type                              |
| ----------------- | -------------------------------------------- | --------------------------------------- |
| 1. Registration   | `host.scoped()`, `host.http.use()`, etc.     | plain `Error`                           |
| 2. `host.build()` | config parse, then validators                | plain `Error` or `FlareValidationError` |
| 3. HTTP compile   | end of `host.build()`, after validators pass | plain `Error`                           |
| 4. Request        | `app.fetch()` / runtime traffic              | `FlareResponse` or plain `Error`        |

Test-only failures (`FlareTestError` during `app.test()` / `app.reset()`) are a separate track; see [Test mode extras](#test-mode-extras) below.

## Phase 1: Registration time

These throw **when you call a registration API**, not at `build()`:

| Trigger                                      | Message / behavior                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service without `static deps`                | `${Service} is missing static 'deps'.` at `host.scoped()` / `host.singleton()`                                                                                                                    |
| Controller/middleware without `static deps`  | Same at `host.http.use()` / `.controller()`                                                                                                                                                       |
| Controller/middleware without `static state` | `${Class} is missing static 'state'.` (or combined `deps` + `state`)                                                                                                                              |
| Error handler class without `static deps`    | `${Class} is missing static 'deps'.` at `host.http.error()`                                                                                                                                       |
| `host.singleton()` on Workers                | `[flare] host.singleton() is not supported on Cloudflare Workers; edge runtimes have no long-lived process — use host.scoped() instead.`                                                          |
| Invalid controller class                     | `Invalid controller argument for path ${path}. Must be a ControllerClass.`                                                                                                                        |
| Invalid middleware class                     | `Invalid middleware argument. Must be a MiddlewareClass.`                                                                                                                                         |
| Bad route path at register                   | `Path must start with "/": ${path}` / `Path must not end with "/": ${path}` / `Path must not contain empty segments (double slash): ${path}` (also `Group prefix must …` for `host.http.group()`) |
| Missing handler function                     | `Missing ${label} function.` when a route, middleware, or error-handler overload omits the callback                                                                                               |
| Route path is `"/"` on a handler             | `Path cannot be "/". Omit the argument for controller root routes.` (`@Get` / `@Post` decorators)                                                                                                 |
| Unsupported HTTP method on handler           | `Unsupported HTTP method "${method}" on route "${Class}.${path}". Supported methods are: …` (decorator evaluation)                                                                                |
| Duplicate method on same path at register    | `Duplicate route registration for ${method} ${path}. Each route can only have one handler per HTTP method.` (`host.http.route()` synthetic controller)                                            |

**Fix:** declare `public static override deps = []` (or real deps), declare `static state = []` when the class uses `state: [...]`, register only valid controller/middleware classes, and use `host.scoped()` on Cloudflare Workers instead of `host.singleton()`.

## Phase 2: `host.build()`

### Config parse (plain `Error`, before validators)

If a registered config section fails schema parse during the config step at the start of `host.build()`, `build()` throws before any validator runs:

```
Config validation failed: …
```

The payload is JSON-serialized parse errors. There is no `FlareValidationError` code for this failure.

### Validators (`FlareValidationError`)

After config and logger compile, `host.build()` runs service, HTTP, and config validator suites. Entries with `severity: "error"` throw `FlareValidationError`:

```
[flare] Build failed with 1 validation error:

  1. [UNDECLARED_DEPENDENCY] Service GreetService has an undeclared dependency: TagService.
     Hint: Register TagService with host.scoped() or host.singleton() before calling host.build().
```

(Node and test runners typically prefix this with `Error:` when printing the exception.)

Each entry has a **`code`**, **`message`**, and optional **`hint`**. The thrown `message` lists only `severity: "error"` entries. On a failed `host.build()`, the thrown error's `errors` array contains only those error-severity entries (warnings are not included). After a successful build, warnings log through the configured logger transports and never appear on the validation error.

`FlareValidationError` is exported from `@flare-ts/core/errors` (and `@flare-ts/core`). Catch with `instanceof FlareValidationError` or inspect `err.errors`:

```ts
import { FlareValidationError } from "@flare-ts/core/errors";

try {
  host.build();
} catch (err) {
  if (err instanceof FlareValidationError) {
    for (const entry of err.errors) {
      console.error(entry.code, entry.message);
    }
  }
}
```

Decorator route paths (`@Get("/a//b")`, etc.) are not checked for double slashes at evaluation time; the same shape problem surfaces at `host.build()` as `ROUTE_EMPTY_SEGMENT` instead.

See [Composition & startup validation](/concepts/composition/) for validator ordering. Warning codes (`ORPHANED_CONTRACT_ENTRY`, `DEAD_MIDDLEWARE`) are listed in the HTTP table below; they never throw.

### Service codes

| Code                            | Meaning                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `UNDECLARED_DEPENDENCY`         | `static deps` references a service never registered                                                            |
| `CIRCULAR_DEPENDENCY`           | Dependency cycle in the service graph                                                                          |
| `CAPTIVE_DEPENDENCY`            | Singleton depends on a scoped service                                                                          |
| `CONTROLLER_UNREGISTERED_DEP`   | Route/controller `deps` references unregistered service                                                        |
| `MIDDLEWARE_UNREGISTERED_DEP`   | Middleware `deps` references unregistered service                                                              |
| `INVALID_LIFECYCLE_HOOK`        | Hook on wrong lifetime (e.g. `dispose()` on a singleton: use `onStop()` instead, or switch to `host.scoped()`) |
| `CONTRADICTORY_LIFECYCLE_HOOKS` | Conflicting hook declarations (e.g. `onStart` + `dispose` on the same class)                                   |
| `CONTROLLER_LIFECYCLE_HOOK`     | `onStart` / `onStop` / `dispose` on a controller                                                               |
| `MIDDLEWARE_LIFECYCLE_HOOK`     | Lifecycle hook on middleware                                                                                   |

### HTTP codes

| Code                          | Meaning                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `DUPLICATE_ROUTE_METHOD`      | Same method registered twice on one path                 |
| `DUPLICATE_ROUTE_PATTERN`     | Conflicting path patterns                                |
| `DUPLICATE_ROUTE_PIPELINE`    | Duplicate pipeline identity                              |
| `ROUTE_EMPTY_SEGMENT`         | Empty path segment                                       |
| `ROUTE_MISSING_PARAM_NAME`    | `:param` segment without a name                          |
| `ROUTE_INVALID_PARAM_NAME`    | Invalid param identifier                                 |
| `ROUTE_MISSING_WILDCARD_NAME` | `*segment` without a name                                |
| `ROUTE_WILDCARD_NOT_LAST`     | `*segment` not final                                     |
| `DUPLICATE_ROUTE_PARAM`       | Same param name twice on one path                        |
| `ROUTE_QUERY_PARAM_COLLISION` | Query key collides with route param name                 |
| `MIDDLEWARE_STATE_CYCLE`      | Global middleware `state`/`provides` cycle               |
| `CORS_CREDENTIALS_WILDCARD`   | Invalid CORS credentials + `*` origin                    |
| `CORS_NEGATIVE_MAX_AGE`       | Negative `maxAge`                                        |
| `CORS_PARTIAL_WILDCARD`       | Invalid partial wildcard origin                          |
| `ORPHANED_CONTRACT_ENTRY`     | **Warning:** contract entry with no handler              |
| `DEAD_MIDDLEWARE`             | **Warning:** global middleware excluded from every route |

### Config codes

| Code                        | Meaning                                                  |
| --------------------------- | -------------------------------------------------------- |
| `UNREGISTERED_CONFIG_TOKEN` | Class uses `static config` but `host.cfg()` never called |
| `MISSING_CONFIG_KEY`        | `flare.json` section missing                             |
| `MISSING_CONFIG_FIELD`      | Required field absent after merge                        |

Accessing `host.logger` before logger bootstrap completes (including before `host.build()` finishes) throws:

```
Logger not initialized yet. Accessing the host logger before build completes logger bootstrap is not allowed.
```

## Phase 3: HTTP compile

After validators pass, the HTTP arc **compiles** pipelines. Failures here are **plain `Error`**, not `FlareValidationError`:

| Trigger                             | Message                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State not provided                  | `${Consumer} requires state token ${Token} that is not provided by any preceding middleware. Please ensure that a preceding middleware in the chain provides this state token.` |
| Duplicate state provider            | `Duplicate state token provided by middleware ${name}: ${Token} already provided by middleware ${other}. Each state token can only be provided by one middleware in the chain.` |
| Empty route table                   | `no routes provided`                                                                                                                                                            |
| Route cap exceeded                  | `1025 routes exceeds maximum of 1024`                                                                                                                                           |
| No routes on controller             | `Controller ${name} has no route handlers. Add at least one decorated method.`                                                                                                  |
| Middleware with no hooks            | `Middleware ${name} must implement at least one of the before(), after(), or finally() lifecycle hooks.`                                                                        |
| Invalid route primitive in contract | `Handler ${name} defines a route parameter "${key}" with unsupported type "float". Route parameters can only be string or integer primitives.`                                  |
| Duplicate handler at compile        | `Duplicate route registration for GET /api/foo. Each route can only have one handler per HTTP method.`                                                                          |
| Group excludes unknown middleware   | `[flare] Group tried to exclude middleware "${name}" but it is not registered in the global middleware chain.`                                                                  |

**Fix:** add `provides: [Token]` on middleware that runs **before** any route or middleware class that lists `Token` in `static state`. See [State](/core/http/state/).

## Phase 4: Request time

### HTTP responses

These return a `FlareResponse` directly. Custom `host.http.error()` handlers are **not** invoked for contract validation failures.

| Situation                                                      | Status                                                                                                           | Body                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound path malformed (no leading `/`, trailing `/`, or `//`) | **400**                                                                                                          | `{ error: "Invalid request path. Paths must start with \"/\", must not contain empty segments (\"//\"), and must not end with a trailing slash except for \"/\"." }` (same body for all rejected shapes) |
| Path not found                                                 | **404**                                                                                                          | `"Not Found"` (plain string)                                                                                                                                                                             |
| Path found, method missing                                     | **405**                                                                                                          | `"Method Not Allowed"` (plain string) + `Allow` header listing methods registered on that path (includes `HEAD` when `GET` exists)                                                                       |
| App not built                                                  | **503**                                                                                                          | `{ error: "Application not ready. Call host.build() before handling requests." }`                                                                                                                        |
| Body over limit                                                | **413**                                                                                                          | `{ error: "ContentTooLarge", code: 413, detail: { maxBytes } }`                                                                                                                                          |
| Contract route params invalid                                  | **400**                                                                                                          | `{ error: "Invalid route parameters. Check that your URL path matches the expected format." }`                                                                                                           |
| Contract query invalid                                         | **400**                                                                                                          | `{ error: "Invalid query parameters. Check that your URL query string matches the expected format." }`                                                                                                   |
| Contract body invalid (schema)                                 | **400**                                                                                                          | `{ error: "Invalid request body", details: … }`                                                                                                                                                          |
| Contract body invalid (other)                                  | **400**                                                                                                          | `{ error: "Invalid request body" }`                                                                                                                                                                      |
| Handler throws                                                 | Your `host.http.error()` mapper, or framework default **500** `{ error: "Internal Server Error" }` when unmapped |                                                                                                                                                                                                          |

For middleware, handler, body-prep, and `finally` throws that go through `host.http.error()`, see [HTTP errors](/core/http/errors/).

### Runtime throws

These throw plain `Error` during pipeline execution without going through `host.http.error()`. Node and Cloudflare adapters catch them at the runtime boundary and return **500** `{ error: "Internal Server Error" }`.

| Situation                                  | Message                                                                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler returns nothing / bad type         | `Handler returned null/undefined. Did you forget to return a response?` / `Handler returned an unsupported type. Use a response helper or return a FlareResponse.`                                                                             |
| `ctx.state.set()` invalid value            | `[flare] State values cannot contain circular references.` / `[flare] State values must be primitives, arrays, or plain objects. Store mutable resources in an injected service instead.`                                                      |
| Unsupported route primitive at runtime     | Only `float` is rejected at HTTP compile. Route descriptors are typed as `string` or `int`; if an unsupported primitive still reaches the runtime parser, the client receives **400** with the generic invalid route-parameters message above. |
| `this.inject()` undeclared token           | `[flare] ${Class} called inject("${Token}") but "${Token}" is not declared in ${Class}.deps. Add it to the static deps array.`                                                                                                                 |
| `this.config()` with no `static config`    | `[flare] ${Class} called config("${token.key}") but ${Class} does not declare a static config array. Add "static config = [/* tokens */]" to the class.`                                                                                       |
| `this.config()` undeclared token           | `[flare] ${Class} called config() with token "${token.key}" but "${token.key}" is not declared in ${Class}.config. Add it to the static config array.`                                                                                         |
| `ctx.state.require()` missing token        | `StateToken ${Token} not found in FlareHttpContext state.`                                                                                                                                                                                     |
| `this.inject()` with an unregistered token | `ServiceToken ${Token} not registered in container.`                                                                                                                                                                                           |

## Test mode extras

Once `FLARE_MODE=test` is set before the host module loads, `host.build()` returns a test app and the rows below apply. The first row is the exception: calling `app.test()` on a production app (no test mode at host construction).

| Situation                                                                                        | Result                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.test()` on a production app (`host.build()` without `FLARE_MODE=test` at host construction) | plain `Error`: `[flare] app.test() called on a non-test app. Set FLARE_MODE=test in your test runner env before importing the host module (e.g. vitest: test.env.FLARE_MODE = 'test').` |
| Second `app.test()` on same host                                                                 | `FlareTestError`: `app.test() may only be called once per host instance. Use handle.reset({ replace }) to swap services between scenarios.`                                             |
| `app.test({ replace })` fails validators                                                         | `FlareTestError`: `app.test() validation failed:` + `[CODE] …` lines                                                                                                                    |
| Invalid `replace` target                                                                         | `FlareTestError`: `${Token} is not a registered service. Replace targets must be registered via host.singleton() or host.scoped()` / `${Replacement} does not extend ${Token}`          |
| `app.reset()` misuse                                                                             | `FlareTestError`: `app.reset() called without FLARE_MODE=test.` or `app.reset() called before app.test(); nothing to reset.`                                                            |
| `handle.reset()` before `app.test()`                                                             | `FlareTestError`: `handle.reset() called before app.test(); nothing to reset.`                                                                                                          |
| Bad `fetch("METHOD /path")` target                                                               | `FlareTestError`: `Invalid target "…". Expected "METHOD /path".` or `Invalid target "…". Path must start with "/".`                                                                     |
| `mockContext` bad state key                                                                      | `FlareTestError`: `mockContext received an invalid state key at index …: expected a StateToken, got …`                                                                                  |

`FlareTestError` is exported from `@flare-ts/core/testing`. Import it when you need `instanceof` checks in tests.

## Related

- [Testing](/core/testing/): `FLARE_MODE=test`, `app.reset({ replace })`
- [Routing reference](/core/http/routing-reference/): 404/405/HEAD/OPTIONS
- [State](/core/http/state/): `provides` / `state` wiring
