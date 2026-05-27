---
title: Model
description: "model(): a named, extendable schema-token class for DTOs, contracts, and JSON serialization on responses."
sidebar:
  order: 2
---

`model()` returns a **`ModelTokenBuilder<T>`**: an extendable class whose instances are typed as `T`, with the same `safeParse` and `optional()` surface as a [`schema()`](/lib/schema/) token. Static `safeParse` yields a **plain object** typed as `T`, not a class instance.

Import `model`, `ModelTokenBuilder`, `schema`, `compileSerializer`, and the serializer types from `@flare-ts/lib/schema`. `@flare-ts/core` does not re-export any schema or model symbols.

Use `model()` when a shape needs a **named identifier** (DTOs, contract types, shared test fixtures) instead of an anonymous `schema({...})` value. Validation rules and wire coercion match `schema()` exactly.

## `ModelTokenBuilder<T>`

```ts
type ModelTokenBuilder<T> =
  & (abstract new(...args: never[]) => T)
  & SchemaToken<T>;
```

| Capability                             | Meaning                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abstract new (...args: never[]) => T` | TypeScript treats instances as `T`. There is **no runtime-validating constructor**; do not expect `new MyModel({ ... })` to parse or coerce. Call `MyModel.safeParse(input)` instead.                                                                                                                             |
| `SchemaToken<T>`                       | Usable anywhere a schema token is accepted: contract `body` / `response`, nested fields inside another `schema({ ... })` descriptor, and manual `safeParse`.                                                                                                                                                      |
| Static `safeParse`                     | Returns a **plain object** typed as `T` on success (not a class instance). Failures use the same `FieldError[]` paths and messages as the equivalent `schema()` token.                                                                                                                                            |
| Static `optional()`                    | Returns a **`SchemaToken<T>`** (not another `ModelTokenBuilder`). Marks the field optional when nested in a parent descriptor.                                                                                                                                                                                    |
| Response serialization                 | When the token is on a contract `response` entry, outbound plain objects serialize with the same schema-aware rules as `schema()` ([contract response serializers](/core/http/response/#contract-response-serializers)). Outside HTTP, call [`compileSerializer(MyModel)`](/lib/schema/#compileserializerschema). |

Related types exported from `@flare-ts/lib/schema`: `SchemaToken`, `SafeParseResult`, `SchemaError`, `FieldError`, `JsonValue`, `DescriptorValue`, `BranchShape`, `DiscriminantValues`, `Serializer`.

## Overloads

`model()` has three public forms. It does **not** support the top-level array or record overloads that `schema()` accepts. Use `schema([ItemSchema])` or `schema([{ $record: ValueSchema }])` for those, then pass the token to `model(existingToken)` if you need a named class.

### 1. Inline descriptor

```ts
import { model, str, int, optional } from "@flare-ts/lib/schema";

class CreateUser extends model({
  name: str.min(1),
  email: str,
  age: optional(int),
}) {}
```

Equivalent without subclassing:

```ts
const CreateUser = model({
  name: str.min(1),
  email: str,
  age: optional(int),
});
```

Both forms expose the same static API and contract usage. Subclassing gives you a named `class` for grouping or documentation; the bare assignment is enough when you only need the token.

An empty descriptor is valid: `model<Record<string, never>>({})` parses `{}` successfully.

### 2. Promote an existing schema token

```ts
import { schema, model, uuid, str } from "@flare-ts/lib/schema";

const UserSchema = schema({ id: uuid, name: str });
class UserModel extends model(UserSchema) {}
```

Parsing, failure shapes, and nested composition match the source `schema()` token.

Top-level array and record tokens use this same overload. There is no `model([ItemSchema])` form; build the array or record with `schema()` first:

```ts
const World = schema({ id: uuid, name: str });
class Worlds extends model(schema([World])) {}
```

### 3. Discriminated union

```ts
import { model, int, str } from "@flare-ts/lib/schema";

type Pet = { kind: "cat"; lives: number; } | { kind: "dog"; breed: string; };

const PetBase = model<Pet, "union">("kind", {
  cat: { lives: int },
  dog: { breed: str },
});
```

TypeScript rejects `class X extends PetBase` when the instance type is a union (`Base constructor return type 'Pet' is not an object type`). Use the **cast pattern** below to keep static methods such as `safeParse`.

## Static API

### `safeParse(raw)`

```ts
safeParse(raw: ArrayBuffer | string | JsonValue): SafeParseResult<T>
```

Accepted input matches `schema()`: a JSON **string**, an **ArrayBuffer** (UTF-8 JSON, what the HTTP pipeline passes for buffered bodies), or a plain **object** / **array** `JsonValue`.

On success, `data` is a plain object matching `T`. On failure, `error.fields` is a `FieldError[]` with the same paths and messages as the equivalent `schema()` token would produce.

```ts
const result = CreateUser.safeParse(requestBody);
if (!result.success) {
  // result.error.fields: same shape as schema()
  return;
}
const user = result.data; // typed as CreateUser's shape
```

Validation does **not** run through `new CreateUser(...)`. Call **`CreateUser.safeParse(input)`**, or rely on the HTTP pipeline when the model is on a contract `body` (see [In contracts](#in-contracts)).

### `optional()`

```ts
optional(): SchemaToken<T>
```

Returns an optional schema token suitable for nested fields (for example `schema({ profile: UserModel.optional() })`). The result is **not** extendable as a model class.

For optional **primitive** fields inside a descriptor, use the `optional()` combinator on the primitive (`optional(int)`), not on the model.

### Serialization

In handlers, schema-aware JSON output applies when the model token is declared on the route contract's `response` map and you return a plain object via `this.ok(body)` or `new FlareResponse(status, body)`. See [Contract response serializers](/core/http/response/#contract-response-serializers).

Outside HTTP, call [`compileSerializer`](/lib/schema/#compileserializerschema) on the model class:

```ts
import { compileSerializer } from "@flare-ts/lib/schema";

const serialize = compileSerializer(UserModel);
serialize({ id: "...", name: "Ada" }); // JSON string
```

Supported shapes and fallbacks are documented on the [schema page](/lib/schema/#compileserializerschema).

## What you cannot do

| Limitation                                            | Alternative                                                                                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| No validating constructor                             | `MyModel.safeParse(input)`; put the model on contract `body` and read fields from `extract()`; wrap the parsed plain object in your own domain helper |
| Cannot `extends` a discriminated-union model directly | Cast pattern below                                                                                                                                    |
| `optional()` does not return a model builder          | Keep the base model class; call `.optional()` only when nesting in a parent descriptor                                                                |
| No array/record top-level overload                    | Build with `schema([...])` or `schema([{ $record: ... }])`, then `model(token)`                                                                       |
| Inbound `extract().body` is never a class instance    | Attach behavior with plain functions or wrappers over the parsed object                                                                               |

## Discriminated unions: `extends` cast pattern

```ts
type PetModelStatics = typeof PetBase;
const PetModel = class
  extends (PetBase as unknown as new() =>
  object) {} as unknown as PetModelStatics;

const cat = PetModel.safeParse({ kind: "cat", lives: 9 });
```

`PetModel` keeps the full static surface (`safeParse`, `optional`) while satisfying TypeScript's constructor rules.

## Nested in other schemas

A model class is a `SchemaToken` at runtime. Nest it as a field value inside another descriptor:

```ts
const Envelope = schema({
  user: UserModel,
});

Envelope.safeParse({ user: { id: "...", name: "Ada" } });
// nested failures surface as path-prefixed FieldError entries, e.g. "user.id"
```

## In contracts

Models slot into [`flareContract`](/core/http/contracts/) `body` and `response` the same way as `schema(...)` tokens:

```ts
import { ControllerBase, flareContract } from "@flare-ts/core";
import { Post } from "@flare-ts/core/decorators";
import { int, model, str } from "@flare-ts/lib/schema";

class CreateUser extends model({ name: str.min(1), email: str }) {}
class UserResponse extends model({ id: int, name: str, email: str }) {}

const ApiContract = flareContract({
  create: {
    body: CreateUser,
    response: { 201: UserResponse },
  },
});

class ApiController extends ControllerBase {
  public static override deps = [];
  public static override state = [];
  public static override contract = ApiContract;

  @Post("/users")
  create() {
    const { body } = this.ctx.extract(ApiContract.create);
    // body: parsed plain object typed as CreateUser's shape, not `new CreateUser`
    // empty or missing inbound body → body is `null`; guard before reading fields
    return this.created({ id: 1, name: body!.name, email: body!.email });
  }
}
```

**Inbound:** handlers receive a parsed plain object (or `null` when the body is empty) typed from the contract. The pipeline validates the body once with `bodyContract.safeParse` before the handler runs. Failures become **400** with a `details` array of field errors ([framework-generated responses](/core/http/response/#framework-generated-responses)). **413** when the body exceeds `maxBodyBytes`. `extract()` is a typed view over stored values; it does not construct class instances or re-parse.

**Outbound:** declare the model on the contract's `response` map (as `response: { 201: UserResponse }` above). The usual pattern is a **plain object** through `this.created(body)`, `this.ok(body)`, a bare object return, or `new FlareResponse(status, body)`. Flare serializes with the per-status schema for that status. Without a matching `response` entry, the body uses `JSON.stringify` ([fallback rules](/lib/schema/#compileserializerschema)).

You can also return a **branded `model()` instance** directly (an object whose constructor carries the schema brand). That path always becomes **200** JSON and uses the route's `200` response serializer when declared, otherwise the model's compiled serializer, otherwise `JSON.stringify`. It does not pick up non-200 contract entries — use plain objects with controller helpers or `FlareResponse` when you need **201**, **404**, or other statuses. See [Response → Return values](/core/http/response/#return-values).

Do not use `new MyModel({ ... })` for outbound data: there is no runtime-validating constructor. Parse inbound data with `MyModel.safeParse` and return plain objects (or a branded instance only when you intentionally want the direct-return path above).

See [Response → Contract response serializers](/core/http/response/#contract-response-serializers) and [Return values](/core/http/response/#return-values).

## Model vs schema

|                              | `schema({...})`                                      | `model({...})`                                        |
| ---------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Runtime shape                | Plain token object                                   | Extendable class + token                              |
| TypeScript name              | Inferred from variable                               | Class name or `const` binding                         |
| `extends`                    | Not supported                                        | Supported (except discriminated unions without cast)  |
| Top-level array / record     | Supported                                            | Use `schema` first, then `model(token)`               |
| Contract `body` / `response` | Yes                                                  | Yes                                                   |
| Nested in descriptors        | Yes                                                  | Yes                                                   |
| HTTP outbound serializer     | When token is on contract `response` (same for both) | When token is on contract `response`                  |
| Manual parse                 | `Token.safeParse(raw)`                               | `ModelClass.safeParse(raw)` (identical failure shape) |

Same validation rules and coercion. `model()` wraps a `schema()` token in an extendable class.

## Side-by-side

```ts
import { FlareHost, FlareResponse } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";
import { model, schema, str } from "@flare-ts/lib/schema";

const host = new FlareHost(node);

// schema: anonymous token; reuse one object for route options and extract
const echoContract = { body: schema({ msg: str }) };

host.http.post(
  "/echo",
  { contract: echoContract },
  (ctx) => {
    const { body } = ctx.extract(echoContract);
    return new FlareResponse(200, body);
  },
);

// model: named class + token
class EchoBody extends model({ msg: str }) {}
const echoModelContract = { body: EchoBody };

host.http.post(
  "/echo-model",
  { contract: echoModelContract },
  (ctx) => {
    const { body } = ctx.extract(echoModelContract);
    return new FlareResponse(200, body);
  },
);
```

The named form pays off when `EchoBody` is shared across a contract, tests, and services: one identifier instead of repeating `schema({ msg: str })`.
