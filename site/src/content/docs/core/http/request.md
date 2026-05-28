---
title: Request
description: "ctx.req (FlareRequest): method, URL, headers, route and query params, body readers, and abort signals."
sidebar:
  order: 3
---

Every HTTP handler and middleware hook receives a `FlareHttpContext` (`ctx` in inline routes; `this.ctx` on controller classes). The inbound message is `ctx.req`, a `FlareRequest` exported from `@flare-ts/core`.

For route matching (404/405, HEAD, OPTIONS, CORS), see [Routing reference](/core/http/routing-reference/). For handler return values, see [Response](/core/http/response/). For contract descriptors and validation timing, see [Contracts](/core/http/contracts/).

## `FlareRequest` on `ctx.req`

`FlareRequest` is exported from `@flare-ts/core` as a read-mostly wrapper around what arrived on the wire. Pipeline concerns (parsed contract values, request state, cookies) live on `FlareHttpContext`, not on the request object. `CookieOptions` is the type for `ctx.cookies.set()` on the context, not a field on `FlareRequest`.

### Read-only fields

| Field            | Type                     | Meaning                                                                                                                                     |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`         | `string`                 | HTTP verb as received (for example `"GET"`, `"POST"`)                                                                                       |
| `url`            | `string`                 | Full request URL string                                                                                                                     |
| `path`           | `string`                 | URL path without the query string (derived from `url`)                                                                                      |
| `headers`        | `Headers`                | Request headers (standard Web [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers))                                        |
| `rawRouteParams` | `Record<string, string>` | Decoded `:segment` and `*rest` values from the matched route; `{}` when the route has no params                                             |
| `rawQueryParams` | `URLSearchParams`        | Parsed query string from `url`                                                                                                              |
| `requestId`      | `string`                 | Framework-assigned id for this request (also sent as `X-Request-Id` on responses when [request id headers](/core/config/) are enabled)      |
| `rawBody`        | `ArrayBuffer \| null`    | Bytes already buffered by `buffer()`, `text()`, or `json()`, or `null` before any of those run                                              |
| `signal`         | `AbortSignal`            | Client disconnect / abort signal from the runtime adapter                                                                                   |
| `startTime`      | `number \| undefined`    | Present when [Config](/core/config/) `host.requestTiming` is enabled: a `Date.now()` snapshot captured when the adapter created the request |
| `nativeRequest`  | `unknown`                | Adapter-specific raw request object (for example Node `IncomingMessage`, or Workers `Request`)                                              |

`nativeRequest` is adapter-specific: on the Node adapter it is the underlying Node `IncomingMessage`, and on the Cloudflare/fetch adapter it is a platform `Request`. The exact type depends on the adapter you pass to [`new FlareHost(...)`](/core/host/).

### Body readers

`buffer()`, `text()`, and `json()` return promises. `stream()` is synchronous and returns an [`AsyncIterable`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator) of chunks.

The three buffered readers share one in-flight read: the first call buffers the body into `rawBody`; later calls reuse those bytes without reading the wire again.

| Method              | Returns                        | Behavior                                                                                                                                                                |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buffer(maxBytes?)` | `Promise<ArrayBuffer \| null>` | Reads the full body into memory. Resolves `null` when there is no body or the body is empty. The optional `maxBytes` overrides the route/host limit for this call only. |
| `text()`            | `Promise<string \| null>`      | UTF-8 text of the buffered body; `null` when the body is missing or empty.                                                                                              |
| `json()`            | `Promise<unknown \| null>`     | Parses JSON from the buffered body; `null` when the body is missing or empty. Rejects with `SyntaxError` (`"Invalid JSON body"`) when bytes are not valid JSON.         |
| `stream()`          | `AsyncIterable<Uint8Array>`    | Iterates the inbound body without going through `buffer()`. Throws if `buffer()`, `text()`, or `json()` have started or finished reading the body.                      |

**Size limit.** When a route matches, the effective cap is the route descriptor's `maxBodyBytes` or `host.maxBodyBytes` (default 2 MiB). `buffer()` enforces that cap (and any per-call `maxBytes` you pass). Bodies over the limit throw `FlareError` with name `ContentTooLarge`, which the pipeline turns into **413** and `{ error: "ContentTooLarge", code: 413, detail: { maxBytes } }`. See [Failure modes](/core/failure-modes/).

**Buffered vs streaming.** Pick one strategy per request. `buffer()`, `text()`, and `json()` consume the inbound body stream. After any of them has started or finished (including an empty body), `stream()` throws:

```txt
[flare] stream() cannot be called after buffer(), text(), or json() have read the request body. Pick one read strategy per request.
```

Call `stream()` first when you need a streaming read; call `buffer()`, `text()`, or `json()` when you need the full body in memory.

### Abort and `signal`

`ctx.req.signal` is an [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) from the runtime adapter.

If the client might disconnect while you read the body, read `ctx.req.signal` before calling `buffer()`, `text()`, or `json()`. While buffering, Flare checks the signal before and during chunk iteration. An abort rejects the promise with `signal.reason` when the runtime set one, otherwise `new Error("Request aborted.")`. There is no separate Flare error type for disconnects.

`stream()` does not consult `signal` inside `FlareRequest`. When you stream manually, listen for `abort` on `ctx.req.signal` or handle errors from the iterable.

## Route params and query

### Raw strings on `ctx.req`

Without a contract (or for keys you did not declare), read the wire form:

```ts
host.http.get("/users/:id", (ctx) => {
  const id = ctx.req.rawRouteParams["id"]; // string
  const include = ctx.req.rawQueryParams.get("include"); // string | null
  return { id, include };
});
```

`rawRouteParams` is filled as soon as a route matches, before `before` middleware runs. Values are `decodeURIComponent` of the matched segments. Catch-all routes (`*name`) store the rest of the path under that key.

`rawQueryParams` is always available from `url`; it is not validated until you declare a `query` contract.

### Coerced values and contracts

When the route registers a contract, Flare validates `route` and `query` descriptors before `before` middleware. Coerced values are available through `ctx.extract(descriptor)` (same object identity as in route options or `flareContract`). Invalid route or query shapes short-circuit with **400** and the framework error bodies in [Contracts → Validation failures](/core/http/contracts/#validation-failures).

```ts
import { int } from "@flare-ts/lib/schema";

const getUser = { route: { id: int } };

host.http.get("/users/:id", { contract: getUser }, (ctx) => {
  const { route } = ctx.extract(getUser);
  return { id: route.id }; // number
});
```

| Input         | Without contract                             | With contract                                          |
| ------------- | -------------------------------------------- | ------------------------------------------------------ |
| Path segments | `ctx.req.rawRouteParams` (`string`)          | `ctx.extract(…).route` (coerced primitives)            |
| Query keys    | `ctx.req.rawQueryParams` (`URLSearchParams`) | `ctx.extract(…).query` (coerced primitives)            |
| JSON body     | `ctx.req.buffer()` / `text()` / `json()`     | `ctx.extract(…).body` after the pre-handler body stage |

JSON `body` contracts are validated later: after `before` middleware, immediately before the handler. In `before` hooks you can rely on `extract().route` and `extract().query`, but not on a parsed JSON `body` yet. See [Contracts](/core/http/contracts/) for the stage diagram and error shapes.

## Headers

Request headers are `ctx.req.headers`, a standard `Headers` instance:

```ts
host.http.get("/me", (ctx) => {
  const auth = ctx.req.headers.get("authorization");
  return { hasAuth: Boolean(auth) };
});
```

## Bodies and contracts

How Flare handles the body depends on the route descriptor:

### No `body` in the contract

Flare does not parse JSON for you. Use `ctx.req.buffer()`, `text()`, `json()`, or `stream()` as needed. Each buffered read respects the effective `maxBodyBytes` for that route.

### JSON `body` schema or model

In the handler, read the validated payload from `ctx.extract(descriptor).body` (typed to your schema). The pipeline buffers via `ctx.req.buffer()`, parses JSON, and validates in a pre-handler stage after `before` middleware. Validation failures return **400** with `{ error: "Invalid request body", details: … }`.

With a JSON body contract, an empty or missing body becomes `extract().body === null` (not `undefined`).

### `body: stream` in the contract

Flare does not buffer JSON for stream body contracts. The inbound stream is available when the route matches, before `before` middleware runs. Iterate `ctx.req.stream()` or consume `ctx.extract(descriptor).body`; both reference the same stream iterable. Import the marker from `@flare-ts/core` and see [Contracts → Streaming request bodies](/core/http/contracts/#streaming-request-bodies) for examples.

## Related

- [Contracts](/core/http/contracts/): descriptors, `ctx.extract`, and validation timing
- [Middleware](/core/http/middleware/): `before` / `after` / `finally` and request-scoped `scope`
- [State](/core/http/state/): per-request tokens on `ctx.state`
- [Config](/core/config/): `host.maxBodyBytes`, `host.requestTiming`, `host.requestIdHeader`
