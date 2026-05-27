---
title: Logger
description: Default logger, levels, formats, transports, and DI access.
---

Every Flare app gets a structured `Logger` during `host.build()`. Each log call produces a `LogRecord` (timestamp, level, message, and optional `meta`, `error`, `context`, and `state`) and sends it to every registered transport. Minimum level comes from the `log` section of resolved config (`flare.json` plus `FLARE__*` overrides); `log.format` applies to the framework default console transport only. Resolve the logger from [DI](/concepts/dependency-injection/) as the `Logger` token, or read `host.logger` after build.

## Public exports (`@flare-ts/core`)

| Symbol               | Kind  | Role                                                                                                     |
| -------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| `Logger`             | class | Structured logger; resolve via DI or `host.logger`                                                       |
| `LoggerTransport`    | class | Base class for log transports on Node.js                                                                 |
| `CFWLoggerTransport` | class | Base class for log transports on Cloudflare Workers                                                      |
| `LogLevel`           | type  | `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`                                 |
| `LogRecord`          | type  | Payload passed to every transport's `write()`                                                            |
| `HttpErrorContext`   | type  | HTTP request context for error handlers (see below)                                                      |
| `LOG_CONFIG`         | token | Config token for the `log` section; use with `static config` and `this.config(LOG_CONFIG)` on transports |

Resolved `log` field shapes are typed as `FlareLogConfig` on `host.config.log`. See [Config → LOG_CONFIG](/core/config/#log_config-and-flarelogconfig).

## Default behavior

```jsonc
// flare.json
{
  "host": { "env": "development" },
  "log": {
    "level": "info", // "trace" | "debug" | "info" | "warn" | "error" | "fatal"
    "format": "json", // "json" | "pretty"; default console transport only
    "enableContext": false // attach framework log context to each record when available
  }
}
```

Schema defaults are `info` / `json` / `enableContext: false`. When merged `host.env` is `"development"` and `log.level` or `log.format` are still unset, Flare promotes them to `debug` / `pretty` before validation. In any other environment, omitted fields keep the schema defaults.

Optional per-transport level overrides:

```jsonc
{
  "log": {
    "transports": {
      "console": { "level": "debug" },
      "metrics": { "level": "error" }
    }
  }
}
```

Keys under `log.transports` must match each transport class's `static transportName`. A transport with no entry uses the global `log.level`.

Override at runtime with environment variables (same keys as `flare.json`; nested paths use `__`):

```bash
FLARE__log__level=warn
FLARE__log__format=json
FLARE__log__enableContext=true
```

See [Config](/core/config/) for how `FLARE__` overlays merge into resolved config.

## Reading the logger

`Logger` is a framework singleton compiled during `build()`. Register nothing extra: declare `Logger` in `static deps` and resolve it with `this.inject(Logger)`:

```ts
import { FlareService, Logger } from "@flare-ts/core";

class OrderService extends FlareService {
  public static override deps = [Logger];

  readonly #log = this.inject(Logger);

  place(order: { id: string; }) {
    this.#log.info("placing order", { orderId: order.id });
  }
}
```

In inline HTTP routes, list `Logger` in the route `inject` array and call `scope.inject(Logger)`:

```ts
import { FlareHost, FlareResponse, Logger } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";

const host = new FlareHost(node);

host.http.post("/orders", { inject: [Logger] }, (ctx, scope) => {
  scope.inject(Logger).info("got order", { path: ctx.req.path });
  return new FlareResponse(201, { id: 1 });
});
```

After `build()`, you can also call `host.logger` directly. Reading `host.logger` before `build()` throws a plain `Error`. Call `host.build()` first. See [Host](/core/host/).

## Levels

Each method emits a `LogRecord`. Every transport receives the same assembled record. Records below a transport's effective minimum level are dropped before `write()` runs, so transports never see filtered-out levels.

```ts
log.trace("very chatty");
log.debug("debug");
log.info("normal");
log.warn("notable");
log.error(err, "failed"); // sets record.error from the thrown value
log.fatal(err, "unrecoverable");
```

Signatures:

- `trace` / `debug` / `info` / `warn`: `(message, meta?)`
- `error` / `fatal`: `(message, meta?)` or `(error, message, meta?)` where `error` is any value

When the first argument is an error value and `message` is omitted, the message defaults to `"Error"` (`error`) or `"Fatal error"` (`fatal`).

For `Error` instances, `record.error` is `{ name, message, stack? }`. The `name` field uses the constructor name when `err.name` is the generic `"Error"`. Any other thrown value becomes `{ message: string }` via `String(error)`.

`meta` merges into `LogRecord.meta` as structured JSON-safe fields. See [Context propagation](#context-propagation) for when `context` and `state` appear on the record.

## LogRecord

Every transport receives the same assembled record:

| Field       | Type                                                 | When present                                                                                                |
| ----------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `timestamp` | `number`                                             | Always (Unix ms from `Date.now()`)                                                                          |
| `level`     | `LogLevel`                                           | Always                                                                                                      |
| `message`   | `string`                                             | Always                                                                                                      |
| `meta`      | `Record<string, JsonValue>`                          | When passed to the log call                                                                                 |
| `error`     | `{ name?: string; message: string; stack?: string }` | When `error()` / `fatal()` receive an error value                                                           |
| `context`   | object (see below)                                   | When `log.enableContext` is `true` and the framework has active log context                                 |
| `state`     | `Record<string, JsonValue>`                          | When `log.enableContext` is `true`, the framework has active log context, and that context includes `state` |

When `context` is present, it is either host-scoped (`source: "flare:host"`) or HTTP-scoped (`source: "flare:http"` with `requestId`, `method`, `url`). See [Context propagation](#context-propagation).

## HttpErrorContext

`HttpErrorContext` is exported alongside logger types because HTTP error handlers receive it as their context argument. It extends the HTTP log context with optional pipeline fields `stage` and `target`. It is not passed to `Logger` methods directly; use it in error handlers and spread relevant fields into log `meta` when needed. Full field reference: [HTTP errors → HttpErrorContext](/core/http/errors/#httperrorcontext).

## Custom transports

A **transport** is a class with:

- **`static transportName`**: must match the key in `log.transports` when you override per-transport level
- **`static deps`** (optional, default `[]`): service tokens the transport needs at construction
- **`static config`** (optional): config tokens available via `this.config()` in lifecycle hooks
- **`write(record: LogRecord): void`**: required; receives filtered records only
- **`onStart?()` / `onStop?()`** (optional): lifecycle hooks called by the logger in registration order (shutdown in reverse)

Subclass `LoggerTransport` on Node or `CFWLoggerTransport` on Workers:

```ts
import { CFWLoggerTransport, LOG_CONFIG } from "@flare-ts/core";
import type { LogRecord } from "@flare-ts/core";

class MetricsTransport extends CFWLoggerTransport {
  public static override readonly transportName = "metrics";
  public static override readonly config = [LOG_CONFIG];

  public write(record: LogRecord): void {
    if (record.level === "error" || record.level === "fatal") {
      // forward to your sink
    }
  }
}

// Register before build(); post-build registration does not update the live logger (see Transport rules).
host.logging.transport(MetricsTransport);
```

Name transports in `flare.json` under `log.transports`. Keys must match each class's `transportName`:

```jsonc
{
  "log": {
    "transports": {
      "console": { "level": "debug" },
      "metrics": { "level": "error" }
    }
  }
}
```

Per-transport `level` overrides the global `log.level` for that transport only. The runtime's default transport is wired in first; transports you register with `host.logging.transport()` follow in registration order.

### Transport rules

- **Register before `build()`.** The live logger snapshots its transport list during `build()`. Calls to `host.logging.transport()` after `build()` still append to the host's registration list but do not change the running logger. Register every custom transport before the first `build()`. See [Host](/core/host/).
- **No `this.inject()` in transports.** Transports cannot resolve services from the container. Open clients in `onStart()` and read settings with `this.config()`. Calling `inject()` throws an error naming the transport class and the requested token.
- **Node: async lifecycle allowed.** `LoggerTransport.onStart` and `onStop` may return `Promise<void>`; the logger awaits them.
- **Workers: synchronous lifecycle.** `CFWLoggerTransport.onStart` and `onStop` must not return a `Promise`; the Workers logger calls them without awaiting.

## Context propagation

With `log.enableContext: true`, the framework copies active log context onto each record (`record.context`, and `record.state` when present). On Cloudflare Workers, enable **`nodejs_compat`** in `wrangler.toml` (required for Flare on Workers generally).

| Context                                                  | When it appears on `record.context`                           |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `source: "flare:host"`                                   | During `host.build()` on every runtime.                       |
| `source: "flare:http"` with `requestId`, `method`, `url` | **Node adapter only:** each incoming request before dispatch. |

On Cloudflare Workers, HTTP handlers do not receive automatic `flare:http` fields from config alone. Host-scoped context during `build()` still applies.

Request-scoped context does not propagate into Cloudflare Workers [`waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil) callbacks. Log from deferred work with explicit fields in the log call's `meta` argument (for example `requestId`) instead of relying on `record.context`.

## Workers vs Node

| Runtime            | Transport base class | Default output                                                          |
| ------------------ | -------------------- | ----------------------------------------------------------------------- |
| Node.js            | `LoggerTransport`    | Framework default transport; `log.format` selects pretty or JSON lines. |
| Cloudflare Workers | `CFWLoggerTransport` | Same `log.format` contract as Node.                                     |

Use `import { cf } from "@flare-ts/core/cloudflare"` (or `buildCf` when bundling `flare.json`) as the host adapter; see [Host](/core/host/).
