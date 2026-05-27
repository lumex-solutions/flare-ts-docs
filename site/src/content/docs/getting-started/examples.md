---
title: Examples
description: Copy-paste patterns for controllers, auth state, config-backed services, and Workers.
sidebar:
  order: 4
---

Each example is a small app you can paste into `src/main.ts` (Node) or `src/worker.ts` (Workers). Run the Node examples with `tsx`; deploy or preview the Workers example with Wrangler (see [Install → Workers](/getting-started/install/#workers)). They assume you've completed [Your First App](/getting-started/your-first-app/).

For full reference on contracts, middleware, config, and the host lifecycle, see [HTTP → Contracts](/core/http/contracts/), [HTTP → Middleware](/core/http/middleware/), [Core → Config](/core/config/), and [Core → Host](/core/host/).

## REST controller with a contract

**Outcome:** `GET /users/:id` receives `route.id` as a `number`, and `POST /users` receives a validated body object before your handler runs. Invalid inputs never reach the handler.

```ts
import { ControllerBase, flareContract, FlareHost } from "@flare-ts/core";
import { Get, Post } from "@flare-ts/core/decorators";
import { node } from "@flare-ts/core/node";
import { int, model, str } from "@flare-ts/lib/schema";

class CreateUser extends model({ name: str.min(1), email: str }) {}

const UsersContract = flareContract({
  getUser: { route: { id: int } },
  createUser: { body: CreateUser },
});

class UsersController extends ControllerBase {
  public static override deps = [];
  public static override state = [];
  public static override contract = UsersContract;

  @Get("/:id")
  getUser() {
    const { route } = this.ctx.extract(UsersContract.getUser);
    return this.ok({ id: route.id });
  }

  @Post("")
  createUser() {
    const { body } = this.ctx.extract(UsersContract.createUser);
    return this.ok({ id: 1, name: body.name, email: body.email });
  }
}

const host = new FlareHost(node);
host.http.controller("/users", UsersController);

const app = host.build();
app.run();
```

```bash
tsx src/main.ts
curl http://localhost:3000/users/42
# {"id":42}

curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com"}'
# {"id":1,"name":"Ada","email":"ada@example.com"}
```

**Contract keys must match handler method names.** A missing or mismatched key leaves that handler without contract validation at runtime, so inputs stay raw strings. Pass the matching entry to `this.ctx.extract()` (for example `UsersContract.getUser` in `getUser()`); a different entry throws at runtime. Extra contract keys with no matching handler produce an [`ORPHANED_CONTRACT_ENTRY`](/core/failure-modes/) warning at `build()`, not an error. See [HTTP → Contracts](/core/http/contracts/) for the full descriptor shape.

## Auth middleware with request state

**Outcome:** Routes that declare `state: [AuthUser]` receive a typed `{ id, role }` object after auth middleware runs. Requests without a token get `401` before the route handler executes.

```ts
import {
  FlareHost,
  FlareResponse,
  flareState,
  MiddlewareBase,
} from "@flare-ts/core";
import { node } from "@flare-ts/core/node";

const AuthUser = flareState<{ id: string; role: "admin" | "user"; }>(
  "AuthUser",
);

class AuthMiddleware extends MiddlewareBase {
  public static override deps = [];
  public static override state = [];
  public static override provides = [AuthUser];

  before() {
    const header = this.ctx.req.headers.get("authorization");
    if (!header) {
      return new FlareResponse(401, { error: "missing token" });
    }

    // Replace this stub with real token verification in your app.
    this.ctx.state.set(AuthUser, { id: "u1", role: "admin" });
  }
}

const host = new FlareHost(node);
host.http.use(AuthMiddleware);

host.http.get("/me", { state: [AuthUser] }, (ctx) => {
  const user = ctx.state.require(AuthUser);
  return new FlareResponse(200, user);
});

const app = host.build();
app.run();
```

```bash
tsx src/main.ts
curl http://localhost:3000/me
# 401 {"error":"missing token"}

curl http://localhost:3000/me -H 'authorization: Bearer demo'
# {"id":"u1","role":"admin"}
```

`static provides` on the middleware declares which tokens its `before()` hook writes. The `/me` route's `state: [AuthUser]` declares that it reads that token. Register `/me` without `AuthMiddleware` (or any middleware that `provides` `AuthUser`) and `build()` throws because nothing satisfies the route's `state` list. See [HTTP → State](/core/http/state/) for defaults, derivation, and logging hooks.

## Config and a singleton service

**Outcome:** One `Db` instance lives for the whole Node process. `onStart()` runs when you call `.run()`, reads `db.url` from config, and `/health` returns the active connection URL.

Node only: `host.singleton()` is not available on Cloudflare Workers. Use `host.scoped()` for per-request services on Workers, or platform bindings (D1, KV, Durable Objects) for shared persistence. See [Core → Host](/core/host/#registration).

```ts
import {
  flareConfig,
  FlareHost,
  FlareResponse,
  FlareService,
} from "@flare-ts/core";
import { node } from "@flare-ts/core/node";
import { str } from "@flare-ts/lib/schema";

const DbConfig = flareConfig("db", { url: str });

class Db extends FlareService {
  public static override deps = [];
  public static override config = [DbConfig];

  #pool: { url: string; } | undefined;

  override async onStart() {
    const { url } = this.config(DbConfig);
    this.#pool = { url };
  }

  override async onStop() {
    this.#pool = undefined;
  }

  query(): { ok: true; url: string; } {
    if (!this.#pool) throw new Error("Db not started");
    return { ok: true, url: this.#pool.url };
  }
}

const host = new FlareHost(node);
host.cfg(DbConfig);
host.singleton(Db);

host.http.get("/health", { inject: [Db] }, (_ctx, scope) => {
  return new FlareResponse(200, scope.inject(Db).query());
});

const app = host.build();
app.run();
```

Add `flare.json` next to your entry file:

```jsonc
{
  "$schema": "./node_modules/@flare-ts/core/flare.schema.json",
  "db": { "url": "postgres://localhost/myapp" }
}
```

Override at deploy time with `FLARE__db__url=postgres://prod/myapp`. See [Core → Config](/core/config/) for blocked keys and validation errors.

```bash
tsx src/main.ts
curl http://localhost:3000/health
# {"ok":true,"url":"postgres://localhost/myapp"}
```

## Cloudflare Workers

**Outcome:** Wrangler serves a Worker whose `fetch` handler is the compiled Flare app. Config comes from `wrangler.toml` `[vars]` via the `cf` adapter.

```ts
import { ControllerBase, FlareHost, Logger } from "@flare-ts/core";
import { cf } from "@flare-ts/core/cloudflare";
import { Get } from "@flare-ts/core/decorators";

class HealthController extends ControllerBase {
  public static override deps = [Logger];
  public static override state = [];

  private readonly logger = this.inject(Logger);

  @Get("")
  get() {
    this.logger.debug("health check");
    return this.ok({ ok: true });
  }
}

const host = new FlareHost(cf);
host.http.controller("/health", HealthController);

const app = host.build();
export default app.export();
```

Set config values in `wrangler.toml`:

```toml
[vars]
FLARE__log__level = "warn"
```

Requires `nodejs_compat` in your `wrangler.toml` compatibility flags. To bundle a `flare.json` instead, use `buildCf`:

```ts
import flareJson from "./flare.json" with { type: "json" };
import { buildCf } from "@flare-ts/core/cloudflare";

const host = new FlareHost(buildCf(flareJson));
```

See [Install → Workers](/getting-started/install/#workers).

Do not call `host.singleton()` on this adapter: TypeScript types it as `never`, and calling it throws at registration time. Register per-request services with `host.scoped()`, or use Cloudflare storage bindings for data that outlives a single request.
