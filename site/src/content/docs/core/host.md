---
title: Host
description: FlareHost runtime adapter, service registration, build(), and the lifecycle state machine.
---

`FlareHost` is the composition root: one object that holds your config tokens, services, routes, and runtime adapter. Call `host.build()` to get a compiled app. Then call the entrypoint that matches your runtime: `app.run()` on Node, `app.export()` on Cloudflare Workers, or `await app.test()` when `FLARE_MODE=test` is set in the test runner.

## Constructor

```ts
import { FlareHost } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";

const host = new FlareHost(node);
```

The constructor takes a runtime adapter:

| Adapter              | Import                                                | Use for                                                                                                              |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `node`               | `import { node } from "@flare-ts/core/node"`          | Node.js 22+; reads `flare.json` from the project root (missing file → defaults + env)                                |
| `cf`                 | `import { cf } from "@flare-ts/core/cloudflare"`      | Cloudflare Workers; reads `FLARE__*` overrides from `adapter.env` (`process.env`), e.g. via `wrangler.toml` `[vars]` |
| `buildCf(flareJson)` | `import { buildCf } from "@flare-ts/core/cloudflare"` | Cloudflare Workers; config from a bundled `flare.json` import                                                        |
| `bun`                | `import { bun } from "@flare-ts/core/bun"`            | Stub only; `build()` throws when the adapter creates the app                                                         |
| `deno`               | `import { deno } from "@flare-ts/core/deno"`          | Stub only; `build()` throws when the adapter creates the app                                                         |

For Workers with `FLARE__*` values in `wrangler.toml` `[vars]`:

```ts
import { FlareHost } from "@flare-ts/core";
import { cf } from "@flare-ts/core/cloudflare";

const host = new FlareHost(cf);
```

For Workers with a bundled `flare.json`:

```ts
import flareJson from "./flare.json" with { type: "json" };
import { FlareHost } from "@flare-ts/core";
import { buildCf } from "@flare-ts/core/cloudflare";

const host = new FlareHost(buildCf(flareJson));
```

:::caution[Bun / Deno]
The `bun` and `deno` adapters are exported for forward compatibility but throw when `build()` instantiates the runtime app (`"Bun runtime is not yet supported"` / `"Deno runtime is not yet supported"`). Use `node` or `cf` / `buildCf` for production apps.
:::

## FlareHost API

### Registration

| Method                                | Registers                          | Notes                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host.cfg(...tokens)`                 | Config tokens from `flareConfig()` | Required for any class declaring `static config`. Returns `host` for chaining. See [Config](/core/config/).                                                                                                                                                              |
| `host.scoped(ServiceClass)`           | A per-request service              | Class must have `static deps` (may be `[]`); throws if missing.                                                                                                                                                                                                          |
| `host.singleton(ServiceClass)`        | A per-process service              | Throws on Cloudflare Workers at registration; use `host.scoped()` there instead. In production mode, instances are created at `build()`; in test mode, creation is deferred until `app.test()`. `onStart()` runs when the app starts (`run()`, `export()`, or `test()`). |
| `host.http.get/post/put/patch/delete` | Inline HTTP route                  | See [Routes](/core/http/routes/)                                                                                                                                                                                                                                         |
| `host.http.controller(prefix, Cls)`   | A `ControllerBase` at a prefix     | See [Routes](/core/http/routes/)                                                                                                                                                                                                                                         |
| `host.http.use(Cls)`                  | A global `MiddlewareBase`          | See [Middleware](/core/http/middleware/)                                                                                                                                                                                                                                 |
| `host.http.before/after/finally`      | Inline global middleware hooks     | See [Middleware](/core/http/middleware/)                                                                                                                                                                                                                                 |
| `host.http.group(prefix, fn)`         | A route group with a shared prefix | See [Routes](/core/http/routes/)                                                                                                                                                                                                                                         |
| `host.http.cors(config)`              | Arc-level CORS policy              | See [HTTP](/core/http/)                                                                                                                                                                                                                                                  |
| `host.http.error(fn)`                 | HTTP error mapper                  | Catches thrown errors and maps them to responses. See [Middleware](/core/http/middleware/)                                                                                                                                                                               |
| `host.logging.transport(Cls)`         | A logger transport                 | See [Logger](/core/logger/)                                                                                                                                                                                                                                              |

Register everything in the host module before the first `host.build()` call. A second `build()` returns the cached app and does not recompile, so registrations added after the first `build()` never reach the running app. If you need more routes or services, add them above `host.build()` in the same module (or split registration into an imported setup function that runs before `build()`).

### `build()`

```ts
const app = host.build();
```

`host.build()` is synchronous. It resolves config, bootstraps the logger, runs the service/HTTP/config validator suites, and compiles the HTTP arc. In production mode it also compiles scoped and singleton registrations into the DI graph. Validator failures throw [`FlareValidationError`](/core/failure-modes/) before anything binds a port or exports a handler. Config parse failures throw a plain `Error` earlier in the same call. A second call returns the same cached `app` with no extra work.

The return type depends on the adapter and test mode:

| Runtime / mode                  | `host.build()` return value                             | Entrypoint method  |
| ------------------------------- | ------------------------------------------------------- | ------------------ |
| Node (production)               | App with `run()`                                        | `app.run()`        |
| Cloudflare (production)         | App with `export()`                                     | `app.export()`     |
| Any adapter + `FLARE_MODE=test` | Test app with `test()`, plus no-op `run()` / `export()` | `await app.test()` |

### Inspection (read-only)

| Accessor                 | What it gives you                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `host.config`            | Resolved config snapshot. Empty `{}` before `build()`.                                                                                     |
| `host.logger`            | Bootstrapped `Logger` after `build()`. Reading it earlier throws a plain `Error`; call `host.build()` before accessing `host.logger`.      |
| `host.state`             | Current lifecycle state string. See [Lifecycle state](#lifecycle-state).                                                                   |
| `host.scopedServices`    | Read-only view of the scoped service registry (`get`, `tokens`, `length`).                                                                 |
| `host.singletonServices` | Read-only map of compiled singleton instances. In test mode before `app.test()`, only pre-built singletons (such as `Logger`) appear here. |

## Compiled app entrypoints

### Node: `app.run()`

```ts
import type { NodeRunHandle, NodeRunOptions } from "@flare-ts/core/node";

const app = host.build();
const handle: NodeRunHandle = app.run(
  {
    port: 3000,
    host: "0.0.0.0",
    shutdownTimeout: 10_000,
  } satisfies NodeRunOptions,
);

// graceful shutdown:
await handle.stop();
```

`app.run()` starts the HTTP server and returns a handle:

| Property / method | Description                                   |
| ----------------- | --------------------------------------------- |
| `handle.server`   | The underlying Node `http.Server`.            |
| `handle.stop()`   | Graceful shutdown; returns a `Promise<void>`. |

Options fall back to `host.config.host` (`port`, `host`, `shutdownTimeout`), then framework defaults (`3000`, `"localhost"`, `10000` ms). `app.run()` may be called only once per app instance; a second call throws. To listen again, create a new `FlareHost` and call `build()` / `run()` in a fresh process or test module.

`await handle.stop()` (or SIGTERM / SIGINT) sets `host.state` to `"draining"`, answers new requests with **503** while in-flight work finishes, runs `onStop()` hooks, closes the server, and sets `"stopped"`.

#### Node shutdown

During drain (after `handle.stop()`, SIGTERM, or SIGINT), the Node adapter rejects **new** inbound connections before the HTTP pipeline runs. Those requests get:

- Status **503**
- Body `{ error: "Service Unavailable" }`
- Header `Connection: close`

In-flight requests already inside the HTTP pipeline continue until they finish or the shutdown timeout elapses. This path does not enter `host.http.error` handlers; it is host lifecycle, not pipeline dispatch. See [HTTP errors → What bypasses handlers](/core/http/errors/#what-bypasses-handlers).

Use `/ready` (or similar) with `host.state === "ready"` if load balancers should stop sending traffic before drain begins. During `"draining"`, new socket accepts still receive the shutdown **503** above even if a route handler would return 200.

### Workers: `app.export()`

```ts
import type { CFWExportedHandle } from "@flare-ts/core/cloudflare";

const app = host.build();
const worker: CFWExportedHandle = app.export();
export default worker;
```

`app.export()` runs startup hooks, sets `host.state` to `"ready"`, and returns `{ fetch }` for the Workers module entrypoint. Your worker receives a standard `fetch(request)` handler.

### Test mode: `app.test()`

:::note[Test mode compile timing]
Set `FLARE_MODE=test` in the test runner before the host module is imported. `build()` still validates config and HTTP and compiles the HTTP arc, but defers scoped and singleton instantiation until `app.test({ replace })` so `replace` can substitute classes before constructors run. Service validation runs again inside `app.test()` against the post-replacement graph. In test mode, `run()` and `export()` are no-op shims that return `null`, so `app.run()` or `export default app.export()` at the bottom of `main.ts` stays harmless when tests import the module.
:::

`await app.test()` returns a `TestAppHandle` (from `@flare-ts/core/testing`) with `fetch()`, `stop()`, and `reset()`. See [Testing](/core/testing/) for the full harness API.

Calling `app.test()` on a production app (without `FLARE_MODE=test`) throws a plain `Error` (`[flare] app.test() called on a non-test app...`). Set `FLARE_MODE=test` in the test runner env before importing the host module instead.

## Lifecycle state

```ts
host.state; // "starting" | "ready" | "draining" | "stopped"
```

`host.state` is read-only. The compiled app advances it at lifecycle transitions. Use it in readiness probes:

```ts
import { FlareHost, FlareResponse } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";

const host = new FlareHost(node);

host.http.get("/ready", () => {
  return host.state === "ready"
    ? new FlareResponse(200, { state: host.state })
    : new FlareResponse(503, { state: host.state });
});
```

| Transition   | Node                                                                                                    | Workers                                 | Test                                          |
| ------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------- |
| `"starting"` | From construction until the server listens                                                              | From construction until `export()` runs | From construction until `app.test()` resolves |
| `"ready"`    | After the HTTP server is listening                                                                      | Inside `export()` after startup         | When `app.test()` finishes startup            |
| `"draining"` | When `handle.stop()` is called; new requests get shutdown **503** (see [Node shutdown](#node-shutdown)) | N/A (per-request model)                 | During `handle.reset()` only                  |
| `"stopped"`  | After server close and service teardown                                                                 | N/A                                     | N/A (`handle.stop()` does not set this)       |
