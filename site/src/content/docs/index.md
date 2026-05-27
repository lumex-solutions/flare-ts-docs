---
title: Flare
description: Composition-first TypeScript HTTP framework. One application graph for Node and Cloudflare Workers, validated before traffic.
---

**Flare** is a composition-first TypeScript HTTP framework. You register config, services, and routes on a `FlareHost`, then call `host.build()` to get a runtime app you can `.run()` on Node or `.export()` on Cloudflare Workers. At build time the framework resolves config, bootstraps the logger, validates your registrations, and compiles route pipelines. Build failures throw before any port binds or `fetch` handler is exported — see [Failure modes](/core/failure-modes/).

The same registrations run on **Node.js** and **Cloudflare Workers**. Swap the runtime adapter; routes, services, contracts, and middleware stay the same.

**Zero third-party runtime dependencies.** `@flare-ts/lib` ships with none; `@flare-ts/core` depends only on `@flare-ts/lib`.

## Install

```bash
pnpm add @flare-ts/core @flare-ts/lib
```

See [Install](/getting-started/install/) for Node.js version requirements, project layout, and `flare.json`.

## Hello, Flare

```ts
import { FlareHost, FlareResponse } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";

const host = new FlareHost(node);

host.http.get("/ping", () => new FlareResponse(200, { ok: true }));

const app = host.build();
app.run();
```

On Node, the `node` adapter reads `flare.json` from the project root when the file exists (if it is missing, defaults apply plus `FLARE__*` env overrides). Call `app.run()` to bind the HTTP server; the listen port comes from `flare.json` `host.port` (default **3000**).

Continue with [Your First App](/getting-started/your-first-app/) for `curl` and project layout.

## Cloudflare Workers

The `cf` adapter supplies an empty bundled config and reads overrides from `process.env` at runtime. Set `FLARE__`-prefixed values in `wrangler.toml` `[vars]` (or via `wrangler secret put` for secrets) instead of shipping a `flare.json` file:

```ts
import { FlareHost, FlareResponse } from "@flare-ts/core";
import { cf } from "@flare-ts/core/cloudflare";

const host = new FlareHost(cf);

host.http.get("/ping", () => new FlareResponse(200, { ok: true }));

const app = host.build();
export default app.export();
```

```toml
[vars]
FLARE__log__level = "warn"
```

Enable **`nodejs_compat`** in `wrangler.toml` `compatibility_flags`. Without it, Workers deployments fail at startup when the logger needs Node.js compatibility APIs. Per-request log context on Node requires `log.enableContext: true` in `flare.json`; on Workers, see [Logger](/core/logger/) for what context is available today.

If you need bundled `flare.json` settings in the Worker artifact, use `buildCf`:

```ts
import flareJson from "./flare.json" with { type: "json" };
import { FlareHost } from "@flare-ts/core";
import { buildCf } from "@flare-ts/core/cloudflare";

const host = new FlareHost(buildCf(flareJson));

const app = host.build();
export default app.export();
```

## Where to go next

| Goal                                       | Page                                               |
| ------------------------------------------ | -------------------------------------------------- |
| Package imports and subpaths               | [Core](/core/) (package exports table)             |
| Install, `flare.json`, Workers setup       | [Install](/getting-started/install/)               |
| First runnable app                         | [Your First App](/getting-started/your-first-app/) |
| Copy-paste patterns                        | [Examples](/getting-started/examples/)             |
| Arcs, composition, DI mental model         | [Concepts](/concepts/)                             |
| `FlareHost`, HTTP, config, logger, testing | [Core](/core/)                                     |
| When errors surface (build vs request)     | [Failure modes](/core/failure-modes/)              |
| Schema primitives and `model()`            | [Lib](/lib/)                                       |

:::note[Pre-release]
Flare is at `0.1.x`. Expect breaking changes before `1.0`. Snippets match exports from `@flare-ts/core` and `@flare-ts/lib`.
:::
