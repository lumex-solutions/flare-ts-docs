---
title: Testing
description: FLARE_MODE=test, app.test(), app.fetch, and service replacement with app.reset.
---

Flare integration tests drive the same composed app production uses. Set `FLARE_MODE=test` before the host module loads and `host.build()` returns a test app. Call `app.test()` to get a `TestAppHandle` that sends synthetic requests through the real HTTP pipelines in-process. No listen port is bound.

## Setup

Set `FLARE_MODE=test` before the host module is imported. The Node and Cloudflare adapters expose it on `adapter.env` (both read `process.env`), and `FlareHost` latches test mode at construction time. Without it, `host.build()` returns a production runtime app (not the test variant), and calling `app.test()` throws a plain `Error` telling you to set `FLARE_MODE=test`. See [Failure modes → Test mode extras](/core/failure-modes/#test-mode-extras) for harness errors once test mode is active.

Easiest place to set the variable is the test runner env config:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { FLARE_MODE: "test" },
  },
});
```

Export `host` as a named export from a module your tests import. Inline `new FlareHost(...)` in a test file also works. Keep the same registrations as production (routes, services, config tokens).

Your entry file can still call `run()` or `export()` at the bottom. Under `FLARE_MODE=test`, `run()` and `export()` on the built app are no-op shims that return `null` (no socket bind, no real handler export).

```ts
// src/host.ts
import { FlareHost, FlareResponse } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";

export const host = new FlareHost(node);
host.http.get("/ping", () => new FlareResponse(200, { ok: true }));

const app = host.build();
app.run(); // no-op in test mode; binds a port in production
```

## Writing a test

```ts
import { afterAll, beforeAll, expect, it } from "vitest";
import type { TestAppHandle } from "@flare-ts/core/testing";
import { host } from "../src/host.js";

let app: TestAppHandle;

beforeAll(async () => {
  const built = host.build();
  app = await built.test();
});

afterAll(async () => {
  await app.stop();
});

it("returns ok on /ping", async () => {
  const res = await app.fetch("GET /ping");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```

### `TestAppHandle`

Returned by `app.test()`. Methods:

| Method  | Signature                                                    | Behavior                                                                                                                          |
| ------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `fetch` | `(target: string, init?: FlareTestReq) => Promise<Response>` | Sends `"METHOD /path"` through routing, middleware, and handlers. Returns a standard Web `Response`.                              |
| `stop`  | `() => Promise<void>`                                        | Runs singleton `onStop()` hooks in reverse dependency order. Call in `afterAll`.                                                  |
| `reset` | `(opts?: AppTestOptions) => Promise<void>`                   | Tears down, restores original registrations, optionally applies a new `replace` map, and restarts. The same handle keeps working. |

`AppTestOptions` (exported from `@flare-ts/core/testing`) has an optional `replace` map: each key is a `ServiceToken`, each value is a replacement class that extends that service. Use it to type helpers for `app.test(opts)` and `handle.reset(opts)`.

`fetch` target format:

- `"METHOD /path"`: method is uppercased (`"get /x"` becomes `GET /x`).
- Path must start with `/`. Include query strings in the path: `"GET /users?q=hi"`.
- Route params come from routing the path (for example `"GET /users/42"` for `/users/:id`), not from `init`.

`init` (`FlareTestReq`) accepts:

| Field     | Type                     | Behavior                                                                                                                                                       |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body`    | `unknown`                | Raw bytes (`Uint8Array`, `ArrayBuffer`) and strings pass through. Any other value is JSON-stringified and `content-type: application/json` is set when absent. |
| `headers` | `Record<string, string>` | Request headers (keys normalized to lowercase).                                                                                                                |
| `signal`  | `AbortSignal`            | Propagates to `ctx.req.signal` for cancellation tests.                                                                                                         |

Every `fetch` response includes an `x-request-id` header (`test-1`, `test-2`, … per handle). Context cookies and streaming `FlareResponse` bodies are normalized to a standard Web `Response` before return.

`app.test(opts?)` accepts the same optional `AppTestOptions` as `handle.reset()`. `app.test()` may run only once per host instance; further swaps go through `handle.reset({ replace })`.

## Replacing services

Swap a registered service for a test double with `app.reset({ replace })`, or pass `replace` on the first `app.test()` call:

```ts
class StubDb extends Db {
  override query() {
    return { ok: true, url: "stub" };
  }
}

it("swaps the db for a stub", async () => {
  await app.reset({ replace: new Map([[Db, StubDb]]) });
  const res = await app.fetch("GET /health");
  expect(await res.json()).toEqual({ ok: true, url: "stub" });
});
```

Rules enforced before the substituted graph compiles:

- The map key must be a registered service token (`host.scoped()` or `host.singleton()`).
- The replacement class must extend the token (`instanceof` is checked). If it does not, `FlareTestError` throws (for example, `StubDb does not extend Db`).
- After substitution, the service validator re-runs against the post-replacement graph. A stub with invalid `static deps` fails setup with [`FlareTestError`](/core/failure-modes/#test-mode-extras), not the assertion in the test body.

At `host.build()`, Flare runs the full validator suite (services, HTTP, and config) against your original registrations. HTTP and config validators do not run again at `app.test()` or `app.reset()`. Scoped and singleton **instantiation** is deferred until `app.test()` so `replace` can substitute classes before any constructor runs; the service validator then re-runs against the post-replacement graph at `app.test()` and `app.reset({ replace })`.

### Reset between tests

Call `reset` between scenarios without rebuilding the host module:

```ts
await app.reset({ replace: new Map([[Db, StubDb]]) });
// ... assertions ...
await app.reset(); // restore original registrations
```

The first `app.test({ replace })` can pass the same map.

`app.reset()` with no args restores the original registrations. `app.stop()` runs singleton `onStop()` hooks and tears down the test handle. Call it in `afterAll`.

See also [Dependency injection → Replacing services in tests](/concepts/dependency-injection/#replacing-services-in-tests) for the same replacement rules in DI terms.

## What `app.test()` skips

Compared to `app.run()` in production:

| Skipped                            | What you get instead                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Socket bind                        | `app.fetch` walks the pipeline directly in-process.                                                                                                                                |
| Long-lived process                 | `app.stop()` runs singleton `onStop()` hooks and tears down the handle.                                                                                                            |
| Immediate scoped/singleton compile | DI compilation waits until `app.test()` so `replace` can substitute classes before any constructor runs. The service validator re-runs at `app.test()` (after optional `replace`). |

What it does **not** skip: `before` / `after` / `finally` middleware, error handlers, serializers, route contracts, and request metadata on the logger (for example `requestId` from the synthetic request). The test path is the production HTTP pipeline without a network hop.

## Lower-level helpers

`@flare-ts/core/testing` exports:

| Export                  | Kind     | Use                                                                                                                                          |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `TestAppHandle`         | class    | Integration-test handle from `app.test()`.                                                                                                   |
| `FlareTestError`        | class    | Harness setup failures (invalid `fetch` target, double `.test()`, failed replacement validation). Not application HTTP errors.               |
| `inspectBuild`          | function | Read-only snapshot after `build()`. Pass `{ host }` or `{ host, app }`.                                                                      |
| `mockContainer`         | function | Unit-test a class with a fake DI container.                                                                                                  |
| `MockContainer`         | type     | Type alias for the return value of `mockContainer` (avoids deep-importing internal `Container` types).                                       |
| `mockContext`           | function | Build a `FlareHttpContext` without a full HTTP round-trip.                                                                                   |
| `FlareTestReq`          | type     | `fetch` init shape.                                                                                                                          |
| `AppTestOptions`        | type     | Options for `app.test()` and `TestAppHandle.reset()` (`replace` map).                                                                        |
| `FlareTestRequestInput` | type     | Adapter input shape produced internally by `fetch`; not constructable at runtime.                                                            |
| `MockContextOpts`       | type     | Options for `mockContext`.                                                                                                                   |
| `FlareBuildSnapshot`    | type     | Return type of `inspectBuild`. Shape is `{ host, http, app }`; nested field types are not separately exported from `@flare-ts/core/testing`. |

Import runtime helpers from `@flare-ts/core/testing`:

```ts
import {
  inspectBuild,
  mockContainer,
  mockContext,
  FlareTestError,
} from "@flare-ts/core/testing";
import type {
  AppTestOptions,
  FlareBuildSnapshot,
  MockContainer,
  FlareTestReq,
  FlareTestRequestInput,
  MockContextOpts,
  TestAppHandle,
} from "@flare-ts/core/testing";
```

`TestAppHandle` is a runtime class; use `import type` when you only need it for annotations.

### `inspectBuild`

Read-only snapshot of host registrations, compiled router, and pipeline list. Callable before or after `build()`; pre-compile sections return empty or partial data. Pass `app` when you also have the built app instance.

### `mockContainer`

Constructs a minimal DI container that resolves tokens from a developer-provided map. `services` is a `ReadonlyMap<ServiceToken, FlareService>` of pre-built fakes. Missing tokens throw at resolve time with the standard `ServiceToken <name> not registered in container.` error.

Use `MockContainer` if you want an explicit return type for `mockContainer(...)` without importing the internal runtime `Container` class from deep paths.

### `mockContext`

Builds a `FlareHttpContext` with a synthetic `FlareRequest` and a zero-allocation mock adapter. Use for unit-testing controllers, middleware, and handler functions without the integration pipeline.

`MockContextOpts` fields (all optional):

| Field       | Default      | Behavior                                                                                                          |
| ----------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `method`    | `"GET"`      | HTTP method.                                                                                                      |
| `url`       | `"/"`        | Request URL (may include query string).                                                                           |
| `headers`   | none         | Request headers.                                                                                                  |
| `body`      | none         | Raw bytes only (`ArrayBuffer`, `Uint8Array`, or `null`). No auto-JSON; encode with `TextEncoder` for JSON bodies. |
| `params`    | none         | Route params as `Map<string, string>` when not driving the router.                                                |
| `state`     | none         | Pre-seeded request state as `Map<StateToken, unknown>`. Invalid keys throw `FlareTestError`.                      |
| `requestId` | `"mock-req"` | Synthetic request ID.                                                                                             |

The mock adapter provides a stable, non-aborted `AbortSignal` per context (unlike integration `fetch`, which uses the runtime adapter's per-request signal).

`FlareTestError` is thrown by the harness for invalid `fetch` targets, double `.test()`, failed replacement validation, and invalid `mockContext` state keys. See [Failure modes → Test mode extras](/core/failure-modes/#test-mode-extras).
