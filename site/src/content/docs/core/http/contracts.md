---
title: Contracts
description: flareContract typed route, query, body, and response per method. ctx.extract returns coerced values, not raw strings.
sidebar:
  order: 6
---

A **contract** is a per-handler descriptor of route segments, query parameters, request body, and optional response shapes. For each matching request, Flare coerces and validates what you declared, then `ctx.extract(descriptor)` (or `this.ctx.extract` on controllers) returns typed `route`, `query`, and `body` fields. Declared `response` schemas remove properties not in the schema for matching status codes on the serialized response.

**Headers are not part of the contract.** Read inbound headers from `ctx.req.headers`. Only `route`, `query`, `body`, `response`, and `maxBodyBytes` are descriptor fields.

## Validation timing

```text
match route
  → coerce route params (400 on failure)
  → coerce query params (400 on failure)
  → attach stream body to context when body uses streaming
  → attach route/query (+ stream body) to context
  → before middleware
  → buffer + JSON validate body (400/413 on failure)
  → handler
  → response serializer (when declared)
```

Route and query validation run **before** `before` middleware. JSON body validation runs **after** `before`, immediately before the handler. In `before` hooks you can use `extract().route` and `extract().query`; for JSON `body` contracts, wait until the handler unless you read the raw body from `ctx.req`. When the descriptor opts into streaming, the inbound stream is attached before `before` runs. Use `ctx.req.stream()` or `extract().body` (cast) in middleware or the handler.

Contract validation failures return **400** or **413** with the bodies in [Validation failures](#validation-failures). They never enter `host.http.error` dispatch. See [HTTP errors → What bypasses handlers](/core/http/errors/#what-bypasses-handlers).

## Per-route, inline

For one inline route, pass a descriptor in route options:

```ts
import { FlareHost, FlareResponse } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";
import { int, str } from "@flare-ts/lib/schema";

const getUser = {
  route: { id: int },
  query: { include: str.optional() },
};

const host = new FlareHost(node);
host.http.get("/users/:id", { contract: getUser }, (ctx) => {
  const { route, query } = ctx.extract(getUser);
  // route.id: number   query.include: string | undefined
  return new FlareResponse(200, { id: route.id, include: query.include });
});
```

Pass the **same descriptor object reference** to `ctx.extract` that you passed in `{ contract: … }`. A freshly created literal with the same shape fails the identity check. On controllers, pass the matching method entry (for example `ApiContract.getUser`), not the whole contract token.

Without `extract`, the pipeline still validates when a contract is registered, but the handler reads raw strings from `ctx.req.rawRouteParams` and `ctx.req.rawQueryParams`. Prefer `extract` whenever you declared a contract.

## `flareContract` and controller `static contract`

When several controller methods share descriptors, group them with `flareContract` and attach the token on the controller class:

```ts
import { ControllerBase, flareContract } from "@flare-ts/core";
import { Get, Post } from "@flare-ts/core/decorators";
import { int, model, str } from "@flare-ts/lib/schema";

class CreateUser extends model({ name: str.min(1), email: str }) {}

const ApiContract = flareContract({
  getUser: { route: { id: int } },
  createUser: { body: CreateUser },
});

class ApiController extends ControllerBase {
  public static override deps = [];
  public static override state = [];
  public static override contract = ApiContract;

  @Get("/users/:id")
  getUser() {
    const { route } = this.ctx.extract(ApiContract.getUser);
    return this.ok({ id: route.id });
  }

  @Post("/users")
  createUser() {
    const { body } = this.ctx.extract(ApiContract.createUser);
    return this.ok({ id: 1, name: body.name });
  }
}
```

At `host.build()`, Flare resolves `contract[handler.name]` for each decorated route (for example `getUser` for method `getUser()`). Pass a **single method entry** to `this.ctx.extract` (for example `ApiContract.getUser`), not the whole contract token.

**Keys must match handler method names.** A missing or mismatched key leaves that handler without contract validation at runtime, so inputs stay raw strings. Extra contract keys with no handler emit an [`ORPHANED_CONTRACT_ENTRY`](/core/failure-modes/) warning at `host.build()` (does not fail the build).

## Descriptor shape

Each handler descriptor can declare any combination of:

| Key            | Type                                                                                   | Validates                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `route`        | `{ field: int or str, ... }`                                                           | Coerces **named** `:id` / `:slug` segments to `number` or `string`. `*wildcards` stay decoded strings (see [Routing reference](/core/http/routing-reference/)). |
| `query`        | `{ field: query primitive, ... }`                                                      | Coerces query-string fields (see parser limits below).                                                                                                          |
| `body`         | A `model()` class, a `schema(...)` token, or a streaming body                          | Parses and validates JSON, or passes the raw inbound stream through.                                                                                            |
| `response`     | `Partial<Record<number, SchemaToken>>` (e.g. `{ 200: schema(...), 404: schema(...) }`) | Per-status response serializer; strips fields not in the schema for matching status codes. Statuses without a registered schema pass through.                   |
| `maxBodyBytes` | `number`                                                                               | Per-route body size cap; overrides `host.maxBodyBytes`. Returns **413** when exceeded.                                                                          |

All fields are optional. Declare only what the handler uses.

### HTTP edge parser limits

The **route** and **query** parsers only coerce a subset of schema primitives. **`body`** accepts the full schema surface via `model()`, `schema(...)`, or streaming.

**`route`:** `int` and `str` only.

- `float` in a route segment makes `host.build()` fail. See [Failure modes → HTTP compile](/core/failure-modes/#phase-3-http-compile).
- Other primitives (`uuid`, `bool`, `date`, `enums`, and so on) are not valid on the route edge: requests fail with the route **400** in [Validation failures](#validation-failures). Use `str` or `int` on the route and parse in the handler, or move validation to `query` / `body`.

**`query`:** `str`, `int`, `bool`, `date`, and `array<str|int|bool|date>` (including `optional(...)` forms).

- `uuid`, `float`, and `enums` are not supported at the edge. Declare `str` or `int` and coerce in the handler instead. Unsupported query primitives yield the query **400** in [Validation failures](#validation-failures).
- `optional(...)` keys absent from the URL are omitted from the coerced map (typed as `T | undefined` in `extract()`).
- `defaultTo(...)` on query fields does **not** apply defaults when the key is missing at the HTTP edge; use `optional(...)` or handle defaults in the handler. `defaultTo` applies normally inside `body` schemas.

Values are percent-decoded (`+` as space) before coercion. Duplicate values for a single-value primitive (e.g. `?limit=1&limit=2`) fail query validation.

**`body`:** full schema surface. An empty or missing JSON body resolves to `extract().body === null` (not `undefined`).

## Schema primitives from `@flare-ts/lib/schema`

Every descriptor leaf — primitives, combinators, `schema(...)`, and `model(...)` — is imported from `@flare-ts/lib/schema`. `@flare-ts/core` does not re-export them.

| Export      | Role                                                   |
| ----------- | ------------------------------------------------------ |
| `str`       | String primitive                                       |
| `int`       | Integer primitive                                      |
| `float`     | Float primitive                                        |
| `bool`      | Boolean primitive                                      |
| `uuid`      | UUID string primitive                                  |
| `date`      | Date primitive                                         |
| `array`     | Array combinator (`array(int)`, etc.)                  |
| `enums`     | Enum primitive                                         |
| `optional`  | Marks a primitive optional (`str.optional()`)          |
| `defaultTo` | Default when input is absent/empty in **body** schemas |
| `model`     | Class-based schema token                               |
| `schema`    | Inline object/array schema tokens                      |
| `text`      | Unbounded string variant                               |

See [Lib → Schema](/lib/schema/) for composition rules, constraints (`.min()`, etc.), and nested objects.

### Inline `body` with `schema(...)`

Small POST bodies can skip a named `model()` class:

```ts
import { flareContract } from "@flare-ts/core";
import { schema, str } from "@flare-ts/lib/schema";

const Item = schema({ id: str });

const ApiContract = flareContract({
  echo: { body: schema({ name: str.min(1) }) },
  nested: { body: schema({ items: schema([Item]) }) },
});
```

After validation the handler receives a plain object from `safeParse`, not a `new Model(...)` instance. A bare object literal (`{ name: str }`) is not accepted for `body`; wrap it in `schema(...)` or extend `model({...})`. Route and query descriptors use plain `{ field: primitive }` records.

### Body size limits

Per-route override on the descriptor:

```ts
export const FeedbackContract = flareContract({
  submitFeedback: {
    body: FeedbackBody,
    maxBodyBytes: 51200,
  },
});
```

Global default: `host.maxBodyBytes` in `flare.json` (default 2 MiB). Bodies over the limit return **413** with `{ error: "ContentTooLarge", code: 413, detail: { maxBytes } }`, not the contract-input **400** table below.

## `ctx.extract()`

```ts
const { route, query, body } = ctx.extract(descriptor);
```

| Behavior           | Detail                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **When**           | After the pipeline stage for each field (see [Validation timing](#validation-timing)).                                                                                                                                                                                         |
| **Return shape**   | `{ route, query, body }`. Only declared fields are typed; undeclared fields resolve to `never` at compile time.                                                                                                                                                                |
| **Runtime cost**   | `extract` reads values already on the context (no second parse). Coercion runs once in the pipeline before the handler.                                                                                                                                                        |
| **Identity check** | `descriptor` must be the **same object reference** registered on the route or in `flareContract`. A different entry throws: `[flare] ctx.extract() was called with a descriptor that does not match the current handler. Are you passing the wrong method from your contract?` |
| **No contract**    | Throws: `[flare] ctx.extract() was called on a handler that has no contract. Ensure the controller has a contract and this method is declared in it.`                                                                                                                          |

Typed coercions:

- **`route`:** `number` or `string` per `int` / `str` descriptor.
- **`query`:** primitive output types (`string`, `number`, `boolean`, `Date`, or arrays thereof), with `undefined` for optional absent keys.
- **`body`:** schema output type for JSON contracts; `null` for empty JSON body; streaming descriptors attach the inbound stream (see below).

## Response shape

`response` is keyed by HTTP status code:

```ts
import { schema } from "@flare-ts/lib";

const meContract = {
  response: {
    200: schema({ id: str, name: str }),
  },
};

host.http.get("/me", { contract: meContract }, () => {
  // password is dropped from the serialized 200 response
  return { id: "u1", name: "Alice", password: "secret" };
});
```

Per-status schemas model error shapes too:

```ts
const getUser = {
  route: { id: int },
  response: {
    200: schema({ id: int, name: str }),
    404: schema({ error: str }),
  },
};
```

A **plain object** return is normalized as **200**, so only the `200` schema applies unless you set status explicitly (`this.notFound()`, `new FlareResponse(404, …)`, etc.).

## Streaming request bodies

Flare can skip JSON buffering and pass the native inbound stream through when the descriptor declares a streaming body. The handler (and `before` middleware on those routes) can iterate `ctx.req.stream()`.

There is no `stream` primitive on the `@flare-ts/core` export surface yet. Until it ships, prefer `ctx.req.stream()` without a body contract, or omit body validation on raw upload routes.

At runtime on Node adapters, `extract().body` is the same async iterable as `ctx.req.stream()`. On Workers-style adapters it is the full `Request` object while `ctx.req.stream()` returns `Request.body`; prefer `ctx.req.stream()` for portable streaming. TypeScript types for `extract().body` on streaming descriptors may be incomplete; cast when needed.

## Validation failures

Contract coercion failures become **400** responses with framework messages (not `FlareError`). They bypass `host.http.error`.

| Input                            | Status | Body                                                                                                     |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Route params                     | 400    | `{ "error": "Invalid route parameters. Check that your URL path matches the expected format." }`         |
| Query string                     | 400    | `{ "error": "Invalid query parameters. Check that your URL query string matches the expected format." }` |
| JSON body (schema failure)       | 400    | `{ "error": "Invalid request body", "details": [ … field errors … ] }`                                   |
| JSON body (parse/buffer failure) | 400    | `{ "error": "Invalid request body" }`                                                                    |
| Body too large                   | 413    | `{ "error": "ContentTooLarge", "code": 413, "detail": { "maxBytes": … } }`                               |

Query failures include: missing a **required** key, duplicate values for a single-value primitive, malformed coercion, and unsupported primitive types at the edge.

To customize error shapes, return your own `FlareResponse` from middleware after inspecting `ctx.req`, or throw/handle `FlareError` in handlers. The built-in contract path does not dispatch through `host.http.error`.

## Related

- [Request](/core/http/request/): `FlareRequest`, raw params, body readers, stream timing
- [HTTP errors](/core/http/errors/): what bypasses error handlers
- [Failure modes](/core/failure-modes/): `ORPHANED_CONTRACT_ENTRY` and unsupported route primitives at `host.build()`
- [Lib → Schema](/lib/schema/): full primitive and `schema(...)` reference
