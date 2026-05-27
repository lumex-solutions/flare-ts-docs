---
title: HTTP errors
description: host.http.error and g.error registration, ErrorHandlerBase, HttpErrorContext, fallback responses, and paths that bypass error handlers.
sidebar:
  order: 7
---

Use `host.http.error(...)` (or `g.error(...)` inside a route group) to map thrown errors in the HTTP pipeline to client responses.

This page covers the HTTP error pipeline only. For defining `FlareError` instances, categories, and code descriptors, see [Core errors](/core/errors/). For the full registration/build/request failure catalog, see [Failure modes](/core/failure-modes/).

## Public exports (`@flare-ts/core`)

| Symbol                | Kind  | Role                                                                                |
| --------------------- | ----- | ----------------------------------------------------------------------------------- |
| `ErrorHandlerBase`    | class | Base class for class-based error handlers                                           |
| `ErrorHandlerOptions` | type  | Options for `.error(options, handler)`                                              |
| `FlareErrorHandler`   | type  | Inline error-handler callback signature                                             |
| `FlareHandlerScope`   | type  | Third argument to inline handlers (`inject`, `config`)                              |
| `HttpErrorContext`    | type  | Second argument context (`requestId`, `method`, `url`, optional `stage` / `target`) |
| `ResponseLike`        | type  | Valid non-defer return (`FlareResponse` or platform `Response`)                     |
| `FlareError`          | class | Thrown application errors (also importable from `@flare-ts/core/errors`)            |

Registration uses the same `.error(...)` overloads on `host.http` and on the group builder inside `host.http.group`. There is no separate export for the registration methods themselves; they live on the HTTP arc and group builders.

## Registration API

Register on `host.http` for arc-wide handlers, or on the group builder with `g.error(...)` for group-scoped handlers. Both expose the same `.error(...)` overloads.

| Overload           | Signature                                        | Purpose                                                                                                                   |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Class handler      | `.error(Class)`                                  | Register a class extending `ErrorHandlerBase`. Options are not supported for classes; declare `static deps` on the class. |
| Function handler   | `.error(FlareErrorHandler)`                      | Register an inline error handler.                                                                                         |
| Function + options | `.error(ErrorHandlerOptions, FlareErrorHandler)` | Inline handler with `inject` and/or `name`.                                                                               |

Class registration throws at registration time when `static deps` is missing:

```ts
// throws: "MyErrors is missing static 'deps'."
host.http.error(class MyErrors extends ErrorHandlerBase { … });
```

There is no options object for class handlers. Use `static deps = [Logger, …]` (and optional `static config = […]`) on the class instead.

### Function handler example

```ts
import { FlareResponse } from "@flare-ts/core";

host.http.error((err, context) => {
  return new FlareResponse(500, { error: "Internal Server Error" });
});
```

The second argument is `HttpErrorContext` (see below), not `FlareHttpContext`. Use `context.requestId`, `context.method`, and `context.url` for request metadata. Error handlers do not receive `ctx.state`; pass request data through `FlareError.detail` or an injected service instead (see [State → Error handlers](/core/http/state/#error-handlers)).

### Class handler example

```ts
import { ErrorHandlerBase, FlareResponse, Logger } from "@flare-ts/core";

class HttpErrors extends ErrorHandlerBase {
  public static override deps = [Logger];
  private log = this.inject(Logger);

  override handle(err, context) {
    this.log.error("request failed", {
      err,
      stage: context.stage,
      target: context.target,
    });
    return new FlareResponse(500, { error: "Internal Server Error" });
  }
}

host.http.error(HttpErrors);
```

### Group registration

```ts
import { FlareError, FlareResponse } from "@flare-ts/core";

host.http.group("/api", (g) => {
  g.error((err, context) => {
    if (err instanceof FlareError && err.category === "not_found") {
      return new FlareResponse(404, { error: err.name });
    }
  });
  g.get("/items", …);
  return g.register();
});
```

Group routes run arc-level handlers first, then handlers registered with `g.error()`. Isolation (`g.isolated()`) affects middleware only, not the error-handler chain.

## ErrorHandlerOptions

Applies only to function handlers: `.error(options, handler)`.

| Option   | Type             | Purpose                                                                         |
| -------- | ---------------- | ------------------------------------------------------------------------------- |
| `inject` | `ServiceToken[]` | Services available via `scope.inject(Token)` in the callback.                   |
| `name`   | `string`         | Optional display name for the generated wrapper class used for inline handlers. |

There is no `state` or `provides` option. Error handlers are not part of the request-state wiring graph. See [State → Error handlers](/core/http/state/#error-handlers).

```ts
import { FlareResponse, Logger } from "@flare-ts/core";

host.http.error(
  { inject: [Logger], name: "LogAndDefer" },
  (err, context, scope) => {
    scope.inject(Logger).error("request failed", { err, stage: context.stage });
    // omit return = defer to next handler
  },
);
```

Function handlers receive a [`FlareHandlerScope`](/core/http/#registration-surface) as the third argument (`inject`, `config`). Class handlers use `this.inject()` and `this.config()` from `FlareBase` instead.

## Handler signatures

### `FlareErrorHandler`

```ts
import type {
  FlareError,
  FlareErrorHandler,
  FlareHandlerScope,
  HttpErrorContext,
  ResponseLike,
} from "@flare-ts/core";

type FlareErrorHandler = (
  err: FlareError | Error,
  context: HttpErrorContext,
  scope: FlareHandlerScope,
) => ResponseLike | void | Promise<ResponseLike | void>;
```

`FlareError` is also importable from `@flare-ts/core/errors`.

### `ErrorHandlerBase`

Abstract base class exported from `@flare-ts/core`. Extends `FlareBase`.

| Member                 | Required                                 | Purpose                                                                                     |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `static deps`          | **Yes** (registration throws if missing) | Service tokens allowed for `this.inject()`. Use `[]` when you inject nothing.               |
| `static config`        | No                                       | Config tokens allowed for `this.config()`. Same guardrails as other `FlareBase` subclasses. |
| `this.inject(token)`   | No                                       | Resolves a service from `static deps`.                                                      |
| `this.config(token)`   | No                                       | Resolves config from `static config` (protected).                                           |
| `handle(err, context)` | **Yes** (abstract)                       | Map the error to a response or defer. May be `async`.                                       |

Unlike controllers and middleware, registration validates `static deps` only. Controllers and middleware must declare both `static deps` and `static state`. Error handlers have no `static state` field and do not participate in request-state wiring.

Missing service registrations referenced by `static deps` or `{ inject: [...] }` fail at request time when the handler runs or when `scope.inject()` is called.

## HttpErrorContext

Passed as the second argument to `handle()` and function handlers:

```ts
import type { HttpErrorContext } from "@flare-ts/core";
```

Extends the HTTP log context with optional pipeline location fields:

| Field       | Type                | Purpose                                                                                                              |
| ----------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `source`    | `"flare:http"`      | Always set for pipeline errors.                                                                                      |
| `requestId` | `string`            | Request correlation id from `ctx.req.requestId`.                                                                     |
| `method`    | `string`            | HTTP method.                                                                                                         |
| `url`       | `string`            | Request URL.                                                                                                         |
| `stage`     | `string` (optional) | Pipeline phase where the error originated: `"before"`, `"body"`, `"handler"`, `"after"`, or `"finally"`.             |
| `target`    | `string` (optional) | Human-readable name of the failing step: middleware class name, synthetic middleware name, or controller class name. |

Use `stage` and `target` for logging and routing logic inside error handlers. Spread `context` into log calls to attach `requestId`, `method`, `url`, `stage`, and `target` to the record.

## Return rules

Error handlers return a **`ResponseLike`** (`FlareResponse` or platform `Response`) or **`void`** (or omit a return).

| Return                                         | Behavior                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `FlareResponse` or `Response`                  | Stops the chain. This response flows through `finally` middleware (LIFO), then normalization. |
| `void` / `undefined`                           | Defer to the next registered handler.                                                         |
| Rejected promise / thrown error inside handler | Logged; chain continues with the next handler.                                                |

Handlers may be `async`; returning a `Promise<ResponseLike | void>` is supported.

When every handler defers, throws, or rejects, the framework applies the [default fallback](#default-fallback).

## Execution order

- Handlers run in **registration order** within each scope.
- For routes inside a group that registered at least one group handler, the effective chain is **arc-level handlers**, then **group handlers**.
- When a group registered no `g.error()` handlers, only arc-level handlers run.
- The **first handler that returns a `ResponseLike`** wins; later handlers are skipped.
- If a handler throws or its returned promise rejects, the framework logs the failure and tries the next handler.
- **`finally` middleware still runs** after an error path resolves, including when dispatch returns an async response. A `finally` hook that throws dispatches error handlers again without aborting remaining `finally` hooks. See [Middleware → Error interaction](/core/http/middleware/#error-interaction).

## What is caught

`host.http.error` handles **exceptions thrown** inside the route pipeline for a matched route, including:

| Stage                    | `context.stage` | Examples                                                                                                       |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------- |
| `before` middleware      | `"before"`      | Sync throw or rejected promise in `before()`                                                                   |
| Request body preparation | `"body"`        | Sync throw while parsing or validating the request body (not validation short-circuits that return a response) |
| Controller construction  | `"handler"`     | Controller factory throw (e.g. eager `this.inject()` in a field initializer)                                   |
| Route handler            | `"handler"`     | Handler throw or rejected promise                                                                              |
| `after` middleware       | `"after"`       | Sync throw or rejected promise in `after()`                                                                    |
| `finally` middleware     | `"finally"`     | Sync throw or rejected promise in `finally()`                                                                  |

Rejected promises from async hooks and handlers follow the same dispatch path as sync throws.

### Default fallback

When no handler returns a response, the framework applies this default:

| Thrown value      | Status                               | Body                                                                                                               |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `FlareError`      | `FlareErrorCategories[err.category]` | `{ error: err.name, code?, detail? }`. The `detail` field uses the `FlareError.detail` getter (respects `expose`). |
| Any other `Error` | `500`                                | `{ error: "Internal Server Error" }`                                                                               |

Category-to-status mapping is documented in [Core errors](/core/errors/#categories). Customize `FlareError` shapes in a `host.http.error` handler before the fallback runs.

## What bypasses handlers

These paths produce a response **without** entering the error-handler chain:

| Response                | When                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **503** (pre-build)     | Arc not built (`host.build()` not called yet). Body: `{ error: "Application not ready. Call host.build() before handling requests." }`. Call `host.build()` before accepting traffic.                                                                                                            |
| **503** (Node shutdown) | Node adapter is draining or stopped (`handle.stop()`, SIGTERM, SIGINT). New connections get **503** with `{ error: "Service Unavailable" }` and `Connection: close` before the HTTP pipeline runs. `host.http.error` handlers do not run. See [Host → Node shutdown](/core/host/#node-shutdown). |
| **400**                 | Invalid inbound pathname: trailing slash (except `/`), empty segment (`//`), or missing leading `/`. Body: `{ error: "Invalid request path. Paths must start with \"/\", must not contain empty segments (\"//\"), and must not end with a trailing slash except for \"/\"." }`                  |
| **404**                 | No route matches the request path                                                                                                                                                                                                                                                                |
| **405**                 | Path matches but HTTP method is unsupported or not registered for that route                                                                                                                                                                                                                     |
| **400**                 | Route-parameter contract validation failed (before the pipeline)                                                                                                                                                                                                                                 |
| **400**                 | Query-parameter contract validation failed (before the pipeline)                                                                                                                                                                                                                                 |
| **400**                 | JSON body schema validation failed during body preparation (returns response, does not throw)                                                                                                                                                                                                    |
| **400**                 | JSON body parse/buffer failure during body preparation (non-body-too-large)                                                                                                                                                                                                                      |
| **413**                 | Body over size limit (`ContentTooLarge`; returns response, does not throw)                                                                                                                                                                                                                       |
| Any status              | `before` middleware returns a non-`undefined` override (short-circuit)                                                                                                                                                                                                                           |
| OPTIONS / CORS          | Preflight or auto-`Allow` responses from the router layer                                                                                                                                                                                                                                        |

Contract validation details and exact error bodies are in [Contracts → Validation failures](/core/http/contracts/#validation-failures). Routing behavior for 404/405/HEAD/OPTIONS is in [Routing reference](/core/http/routing-reference/).

### After the pipeline

Handler or middleware return values that fail **normalization** after the pipeline (for example a route handler returning `null`, or an unsupported type) throw **outside** error dispatch. Return a `FlareResponse`, a web `Response`, or another supported `HandlerResult` instead. See [Response → Return values](/core/http/response/#return-values). `host.http.error` will not catch these throws.

## Related

- [Core errors](/core/errors/): `FlareError`, categories, and code descriptors
- [Middleware → Error interaction](/core/http/middleware/#error-interaction): which hooks run when an error is dispatched
- [State → Error handlers](/core/http/state/#error-handlers): why error handlers do not use request state
- [Contracts](/core/http/contracts/): validation failures that bypass error handlers
- [Host](/core/host/): lifecycle, Node shutdown **503**, and `host.build()`
- [Failure modes](/core/failure-modes/): registration, build, and compile failures
- [Routes](/core/http/routes/): endpoint and group registration
