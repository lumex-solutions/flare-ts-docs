---
title: Response
description: Handler return types, FlareResponse, headers, cookies, and contract serializers.
sidebar:
  order: 4
---

This page documents what Flare sends back to the client: the types handlers and middleware may return, how those values become bytes on the wire, and how contract response schemas shape JSON.

For matching semantics (404/405, HEAD, OPTIONS, CORS), see [Routing reference](/core/http/routing-reference/). For reading request data, see [Request](/core/http/request/).

## Public exports (`@flare-ts/core`)

| Symbol               | Kind  | Role                                                                                                |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| `FlareResponse`      | class | Framework response with status, headers, and body                                                   |
| `HandlerResult`      | type  | Union of values a route handler may return                                                          |
| `ResponseLike`       | type  | Outbound response the runtime writes (`FlareResponse` or web `Response`)                            |
| `MiddlewareOverride` | type  | Middleware hook return: any `HandlerResult` except `null` or `undefined`, or `void` to pass through |
| `ResponseHeaders`    | type  | Plain header map on `FlareResponse.headers` (`Record<string, string>`)                              |

Middleware hooks use `MiddlewareOverride`. Error handlers return `ResponseLike | void` only (not plain objects). See [Middleware](/core/http/middleware/) and [HTTP errors](/core/http/errors/).

Import the types and class from `@flare-ts/core`:

```ts
import { FlareResponse } from "@flare-ts/core";
import type {
  HandlerResult,
  MiddlewareOverride,
  ResponseHeaders,
  ResponseLike,
} from "@flare-ts/core";
```

## Types

### `HandlerResult`

Union of all permitted handler return values:

```ts
type HandlerResult =
  | FlareResponse
  | Response
  | AsyncIterable<unknown>
  | object
  | null
  | undefined;
```

Handlers may return these synchronously or inside a `Promise`. `AsyncIterable<unknown>` is its own union member (not part of `object`). The `object` arm covers plain objects, arrays, branded `model()` instances, and other object values. `Error` instances also match `object` at runtime but are re-thrown instead of serialized (see [Return values](#return-values)).

Do not return `null` from middleware overrides; the framework rejects it the same way as a missing handler return. Return `void` or `undefined` to pass through.

### `ResponseLike`

```ts
type ResponseLike = Response | FlareResponse;
```

Plain objects, arrays, branded models, and streams in a `HandlerResult` become a `FlareResponse` before the runtime writes the response. Web `Response` values pass through unchanged for fetch-style interop.

## Return values

These rules apply after the handler and middleware hooks (`after`, `finally`) resolve, before the runtime writes bytes.

| Return                                           | Handling                                                                                                                                                                   | Client outcome                                                                                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FlareResponse`                                  | Pass through. JSON still on `jsonBody` is serialized with the route's per-status serializer for that status (when declared), then moved to `body`.                         | Your status, headers, and body (or stream).                                                                                                                                                                         |
| `Response` (web)                                 | Pass through unchanged.                                                                                                                                                    | Whatever the `Response` carries. `Set-Cookie` from `ctx.cookies` is merged in by the adapter when present.                                                                                                          |
| Plain object or array                            | Wrapped as `new FlareResponse(200, value)` and serialized.                                                                                                                 | **200** JSON. Uses the route's `200` response serializer when declared; otherwise `JSON.stringify`.                                                                                                                 |
| Branded `model()` instance                       | Serialized with the route's `200` serializer when declared, otherwise the model's compiled serializer, otherwise `JSON.stringify`. Wrapped as **200** JSON.                | **200** JSON.                                                                                                                                                                                                       |
| Other object (custom class, not a branded model) | Same outcome as plain objects: **200** JSON via per-status serializer or `JSON.stringify`.                                                                                 | **200** JSON.                                                                                                                                                                                                       |
| `AsyncIterable`                                  | Wrapped in a streaming `FlareResponse(200, …)`. Each chunk becomes `Uint8Array` (`Uint8Array` as-is, `string` UTF-8-encoded, anything else `JSON.stringify` then encoded). | **200** chunked stream.                                                                                                                                                                                             |
| Returned `Error` instance                        | Re-thrown (not serialized as 200 JSON).                                                                                                                                    | Not handled by `host.http.error`. Production adapters return **500** `{ error: "Internal Server Error" }`; `app.fetch()` rejects in test mode. **Throw** errors to reach [HTTP error handlers](/core/http/errors/). |
| `null` / `undefined`                             | Throws `"Handler returned null/undefined. Did you forget to return a response?"`                                                                                           | Not handled by `host.http.error`. Production adapters return **500** JSON; fix the handler return. See [Failure modes → Runtime throws](/core/failure-modes/#runtime-throws).                                       |
| Primitives, functions, symbols                   | Throws `"Handler returned an unsupported type. Use a response helper or return a FlareResponse."`                                                                          | Same outcome as `null` / `undefined`: not handled by `host.http.error`; return a `FlareResponse`, web `Response`, or serializable object instead.                                                                   |

Common patterns:

```ts
import { FlareResponse } from "@flare-ts/core";

host.http.get("/ping", () => new FlareResponse(200, { ok: true }));
host.http.get("/version", () => ({ version: "1" }));
```

A plain object return is always **200**. For **404**, **400**, or other statuses, return `new FlareResponse(status, body)`, a controller helper such as `this.notFound(...)`, or another value that sets the status explicitly.

Values that are already `ResponseLike` pass through without object wrapping (for example a `FlareResponse` from a `before()` short-circuit or a controller helper). Plain objects and other non-`ResponseLike` results, including middleware overrides, follow the same rules as handler returns.

## FlareResponse

`FlareResponse` is the framework response type exported from `@flare-ts/core`.

### Fields

| Member       | Type                                | Meaning                                                                                                |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `status`     | `number`                            | HTTP status code.                                                                                      |
| `headers`    | `ResponseHeaders`                   | Outbound headers (plain record, not the web `Headers` API).                                            |
| `body`       | `Uint8Array \| string \| null`      | Materialized body after serialization, or `null` for empty responses.                                  |
| `jsonBody`   | `JsonValue \| null`                 | JSON object (or scalar) held before the per-status serializer runs; `null` once finalized into `body`. |
| `bodyStream` | `AsyncIterable<Uint8Array> \| null` | Chunked body for streaming responses; `null` for buffered bodies.                                      |

Cookies are **not** a field on `FlareResponse`. Set outbound cookies with `ctx.cookies.set(...)` on the request context; the runtime drains them into `Set-Cookie` when the response is written. See [Cookies](#cookies).

### Constructor

```ts
new FlareResponse(status);
new FlareResponse(status, body, init?);
```

`init` is `{ headers?: ResponseHeaders }`. Header keys from `init` are merged into `headers` (body-derived headers such as `Content-Type` and `Content-Length` are set by the constructor based on body kind).

Body overloads (second argument):

| Body argument                                                       | `body` / `bodyStream`                                                 | Headers set by constructor                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Omitted, `null`, or `undefined`                                     | Empty (`body` and `bodyStream` are `null`)                            | Only headers from `init`.                                                 |
| JSON value (`JsonValue`: object, array, number, boolean, or `null`) | Stored on `jsonBody` until serialized; then `body` is the JSON string | `Content-Type: application/json`, `Content-Length` filled when serialized |
| `string`                                                            | `body` as UTF-8 text (not `jsonBody`)                                 | `Content-Type: text/plain`, `Content-Length`                              |
| `Uint8Array`                                                        | `body`                                                                | `Content-Length`                                                          |
| `AsyncIterable<Uint8Array>`                                         | `bodyStream`                                                          | No `Content-Length` (chunked)                                             |

JSON objects and arrays keep their object form on `jsonBody` until the per-status serializer runs. Strings passed as the second argument are sent as **text/plain**, not JSON. Use a JSON object (for example `{ message: "ok" }`) or a controller helper when you want `application/json`.

```ts
import { FlareResponse } from "@flare-ts/core";

host.http.get("/me", () => {
  const res = new FlareResponse(200, { id: "u1" });
  res.headers["cache-control"] = "no-store";
  return res;
});

new FlareResponse(200, { ok: true }, {
  headers: { "cache-control": "no-store" },
});
new FlareResponse(204); // no body
new FlareResponse(200, new Uint8Array([0x89, 0x50])); // binary
```

Streaming from a handler can also return an `AsyncIterable` directly (see [Return values](#return-values)); constructing `new FlareResponse(200, asyncIterable)` is equivalent.

### Controller and middleware helpers

`ControllerBase` and `MiddlewareBase` expose **protected** helpers that return `ResponseLike` (each wraps `new FlareResponse(...)`):

| Helper                         | Status      | Notes                                                                |
| ------------------------------ | ----------- | -------------------------------------------------------------------- |
| `ok(body)`                     | 200         | JSON or text (`JsonValue`)                                           |
| `created(body)`                | 201         | JSON or text                                                         |
| `noContent()`                  | 204         | Empty body                                                           |
| `redirect(location, options?)` | 302 default | `RedirectOptions`: `permanent` → 301/308; `preserveMethod` → 307/308 |
| `badRequest(body)`             | 400         |                                                                      |
| `unauthorized(body)`           | 401         |                                                                      |
| `forbidden(body)`              | 403         |                                                                      |
| `notFound(body)`               | 404         |                                                                      |
| `tooManyRequests(body)`        | 429         |                                                                      |
| `error(body)`                  | 500         | HTTP response helper; not `host.http.error`                          |

Controllers include the full set above; middleware includes the error-status helpers (400–429, 500) but not `ok`, `created`, `noContent`, or `redirect`. See [Routes](/core/http/routes/#response-helpers) for controller usage.

## Headers

Assign on `FlareResponse.headers` with bracket notation, or pass `headers` in the constructor `init`:

```ts
host.http.get("/download", () => {
  const res = new FlareResponse(200, { ok: true });
  res.headers["x-content-type-options"] = "nosniff";
  return res;
});
```

For CORS response headers on normal traffic, Flare applies the compiled CORS policy after the handler returns. Preflight `OPTIONS` responses are synthesized separately. See [Routing reference](/core/http/routing-reference/).

When [request id headers](/core/config/) are enabled, the runtime adds `x-request-id` on the way out.

## Cookies

Outbound cookies are set on `ctx.cookies` (`FlareHttpContext`), not on `FlareResponse`:

```ts
host.http.post("/login", (ctx) => {
  ctx.cookies.set("session", token, { httpOnly: true, sameSite: "Lax" });
  return { ok: true };
});
```

`ctx.cookies.get(name)` and `ctx.cookies.getAll()` read the inbound `Cookie` header (lazy, cached). `ctx.cookies.set(name, value, options?)` accumulates `Set-Cookie` values; the adapter appends them when writing the final response (including when you return a web `Response`). `sameSite: "None"` requires `secure: true` at compile time and throws at runtime otherwise.

## Contract response serializers

When a route declares `contract.response`, Flare compiles a per-status serializer. On the way out, fields not in the schema for that status are dropped from JSON.

```ts
import { schema, str } from "@flare-ts/lib/schema";

const me = {
  response: {
    200: schema({ id: str, name: str }),
  },
};

host.http.get("/me", { contract: me }, () => {
  return { id: "u1", name: "Alice", password: "secret" };
  // password is omitted from the serialized 200 response
});
```

For `FlareResponse` with a JSON body, the serializer for **`response.status`** runs (not always 200). Plain object and model returns always become **200**, so only the `200` schema applies to those shapes.

See [Contracts](/core/http/contracts/) for response descriptor shape, per-status error schemas, and validation failure bodies.

## Error handlers

`host.http.error` handlers return `ResponseLike | void`, not arbitrary `HandlerResult` values. Return `new FlareResponse(...)`, a web `Response`, or `void` to defer to the next handler. Plain objects defer like `void` (error handlers must return `ResponseLike`). See [HTTP errors](/core/http/errors/).

## Framework-generated responses

Some responses never pass through your handler or `host.http.error()`:

- **404** when nothing matches (plain `"Not Found"` body)
- **405** when the path matches but the method does not
- Contract input **400** responses (route, query, or body validation)
- **503** when the host is not built

These are built directly in the HTTP arc. Custom error handlers do not run for contract validation failures.

See [Failure modes](/core/failure-modes/) for the full catalog and shapes.

## Related

- [Contracts](/core/http/contracts/): response descriptors and validation failures
- [Middleware](/core/http/middleware/): short-circuit, `after` transforms, and `finally`
- [HTTP errors](/core/http/errors/): error handler return types
- [Failure modes](/core/failure-modes/): 404/405/400/413/503 and error mapping behavior
