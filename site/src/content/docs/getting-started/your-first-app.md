---
title: Your First App
description: One route, build(), and a working curl in under a minute.
sidebar:
  order: 2
---

Three steps get you a running server:

1. Create a **`FlareHost`** with a runtime adapter.
2. Register one route on **`host.http`**.
3. Call `host.build()`, then `.run()` on Node or `.export()` on Workers.

## The app

Create `src/main.ts`:

```ts
import { FlareHost, FlareResponse } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";

const host = new FlareHost(node);

host.http.get("/ping", () => new FlareResponse(200, { ok: true }));

const app = host.build();
app.run();
```

Run it:

```bash
tsx src/main.ts
```

Then request the route:

```bash
curl http://localhost:3000/ping
# {"ok":true}
```

The Node adapter binds **port 3000** by default. Override it in `flare.json` (`host.port`) or with `FLARE__host__port=4000`. See [Install](/getting-started/install/) for the full config pipeline.

## What `build()` does

`host.build()` finalizes your registrations into a runnable app. It runs synchronously: this is composition, not bundling. On success you get an app instance. Call `.run()` on Node, `.export()` on Workers, or `.test()` on the built app when test mode is active. A second call to `build()` returns the same cached instance.

If anything is misconfigured, `build()` throws before the server listens or exports a handler. See [Failure modes](/core/failure-modes/) for the error catalog and [Core → Host](/core/host/) for the full build sequence.

Set `FLARE_MODE=test` before importing the host module to get a test app whose `.test()` method returns a `TestAppHandle` from `@flare-ts/core/testing`. See [Core → Testing](/core/testing/).

## A route with a typed parameter

Without a contract, matched path segments are plain strings on `ctx.req.rawRouteParams` (`Record<string, string>`). With a contract, `ctx.extract(descriptor)` returns typed `route`, `query`, and `body` fields: declare `{ route: { id: int } }` and `route.id` is a `number` in the handler after the pipeline validates the segment. See [Contracts](/core/http/contracts/) for the full descriptor shape.

`host.http.get` accepts an optional options object before the handler:

```ts
import { FlareHost, FlareResponse } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";
import { int } from "@flare-ts/lib/schema";

const getUser = { route: { id: int } };

const host = new FlareHost(node);

host.http.get("/users/:id", { contract: getUser }, (ctx) => {
  const { route } = ctx.extract(getUser);
  // route.id is `number`, already validated
  return new FlareResponse(200, { id: route.id });
});

const app = host.build();
app.run();
```

```bash
curl http://localhost:3000/users/42
# {"id":42}

curl http://localhost:3000/users/banana
# 400 {"error":"Invalid route parameters. Check that your URL path matches the expected format."}
```

When coercion fails, the handler never runs. The response is HTTP 400 with an `error` string describing the failure. Body validation failures can also include a `details` object with field-level errors; route and query param failures return the `error` message only.

## Next

- **[Examples](/getting-started/examples/)**: controllers, middleware with state, services, Workers.
- **[Concepts → Composition](/concepts/composition/)**: what the validators actually check.
- **[Core → HTTP → Routes](/core/http/routes/)**: every shape `host.http.get` supports.
