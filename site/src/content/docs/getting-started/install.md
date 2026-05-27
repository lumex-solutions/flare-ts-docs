---
title: Install
description: Packages, runtime requirements, project layout, flare.json, and environment overrides.
sidebar:
  order: 1
---

## Packages

```bash
pnpm add @flare-ts/core @flare-ts/lib
```

Works with `npm install`, `yarn add`, or `bun add` as well.

`@flare-ts/core` is the framework entry point (host, HTTP arc, DI, config). Import most symbols from there. Add `@flare-ts/lib` when you import schema helpers directly (for example `schema()` from `@flare-ts/lib/schema`).

`@flare-ts/lib` ships with **no runtime dependencies** in its published package. `@flare-ts/core` depends only on `@flare-ts/lib`, so Flare does not pull other third-party packages into your app's `node_modules`.

## Runtimes

| Runtime            | Adapter import                                   | Status                            |
| ------------------ | ------------------------------------------------ | --------------------------------- |
| Node.js ≥ 22       | `import { node } from "@flare-ts/core/node"`     | Supported                         |
| Cloudflare Workers | `import { cf } from "@flare-ts/core/cloudflare"` | Supported                         |
| Bun                | `import { bun } from "@flare-ts/core/bun"`       | Stub: `host.build()` throws today |
| Deno               | `import { deno } from "@flare-ts/core/deno"`     | Stub: `host.build()` throws today |

:::caution[Bun / Deno adapters]
The Bun and Deno adapters exist so import paths stay stable, but `host.build()` fails when the adapter tries to create the app (`"Bun runtime is not yet supported"` / `"Deno runtime is not yet supported"`). Use the Node or Cloudflare Workers adapters for production apps until those runtimes ship.
:::

## Project layout

A minimal Flare project is one entry module plus an optional `flare.json`:

```
my-app/
├── src/
│   └── main.ts      # FlareHost, routes, host.build(), then run() or export()
├── flare.json       # optional: port, logging, custom config sections
├── package.json
└── tsconfig.json
```

Run the entry file with any TypeScript runner:

```bash
node --import tsx/esm src/main.ts
# or
tsx src/main.ts
```

On Node, call `host.build()` and then `run()` on separate lines (see [Your first app](/getting-started/your-first-app/)).

## `flare.json`

`flare.json` lives at the **project root** (the directory you run from on Node). Every field is optional; when a key is absent, built-in defaults fill the value on `host.config` after build. Built-in defaults include `host.port` **3000**, `host.env` **development**, `log.level` **info**, and `log.format` **json** (development can override unset log fields; see below).

```jsonc
{
  "$schema": "./node_modules/@flare-ts/core/flare.schema.json",
  "host": { "port": 4000, "env": "development" },
  "log": { "level": "debug", "format": "pretty" }
}
```

`$schema` points at the bundled JSON Schema so editors autocomplete the built-in `host` and `log` sections. The same file is also importable as `@flare-ts/core/flare.schema.json`. Built-in host and log sections register automatically; call `host.cfg(...)` only for custom sections. Define custom tokens with `flareConfig("section", { ... })`, register them with `host.cfg(...)`, and read them from `host.config` after build. See [Core → Config](/core/config/).

### Environment overrides

Override any `flare.json` field with an environment variable using a **double-underscore** path:

```bash
FLARE__host__port=4000
FLARE__log__level=warn
FLARE__db__url="postgres://..."   # custom `db` section (register host.cfg(DbConfig) first)
```

Env keys whose path contains `__proto__`, `prototype`, or `constructor` are ignored (prototype-pollution guard). Overrides for sections you never registered with `host.cfg()` are dropped during validation and do not appear on `host.config`.

At `host.build()`, config is resolved in this order:

1. `flare.json` from the adapter (or `{}` when the file is missing; a missing file on Node is logged, not fatal).
2. `FLARE__*` environment variables merged into that object.
3. When `host.env` in the merged object is `"development"` (from `flare.json` or `FLARE__host__env`), unset `log.level` and `log.format` become `"debug"` and `"pretty"` before validation.
4. Validation for each section registered with `host.cfg()` (remaining fields get descriptor defaults).

See [Core → Config](/core/config/) for nested env paths, validators, and error types.

## Workers

Use the `cf` adapter for Cloudflare Workers. It reads configuration from `process.env` at runtime; set `FLARE__`-prefixed values in `wrangler.toml` `[vars]`:

```ts
import { FlareHost } from "@flare-ts/core";
import { cf } from "@flare-ts/core/cloudflare";

const host = new FlareHost(cf);

// ... routes, services ...

const app = host.build();
export default app.export();
```

```toml
# wrangler.toml
[vars]
FLARE__host__port = "8787"
FLARE__log__level = "warn"
```

Enable **`nodejs_compat`** in `wrangler.toml` `compatibility_flags`. Flare imports [`node:async_hooks`](https://nodejs.org/api/async_hooks.html) ([`AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage)) for logger infrastructure; without the flag the worker fails to start. For secrets, use `wrangler secret put` instead of `[vars]`.

To bundle a `flare.json` with the Worker instead of `[vars]`, use `buildCf`:

```ts
import { FlareHost } from "@flare-ts/core";
import { buildCf } from "@flare-ts/core/cloudflare";
import flareJson from "./flare.json" with { type: "json" };

const host = new FlareHost(buildCf(flareJson));

// ... routes, services ...

const app = host.build();
export default app.export();
```

`host.singleton()` is **not supported on Workers**. With a `cf` or `buildCf` adapter, TypeScript types the `singleton` argument as `never`; calling it throws immediately with `[flare] host.singleton() is not supported on Cloudflare Workers`. Register per-request services with `host.scoped()` instead.

### Package exports

For entry points and subpaths, see [Core](/core/) and [Lib](/lib/).
