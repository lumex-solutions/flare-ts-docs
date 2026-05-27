---
title: Schema
description: "schema() and primitives: parse, validate, and coerce JSON for contracts, config, and standalone use."
sidebar:
  order: 1
---

`@flare-ts/lib/schema` validates JSON-shaped data. Declare leaf coercers with **primitives** (`str`, `int`, and the rest) and compose **schema tokens** with `schema()`. Call `safeParse` on any token to get either typed `data` or a `SchemaError` whose `fields` array lists every path that failed.

Import from `@flare-ts/lib/schema` for the full public surface — primitives, `schema`, `model`, `text`, `compileSerializer`, `toJsonSchema`, and every schema type. `@flare-ts/core` does not re-export any of these.

Accepted input: a JSON **string**, an **ArrayBuffer** (decoded as UTF-8 JSON), or a plain **object** / **array** `JsonValue` (typical in tests and in-process calls). When a field value is already a JSON boolean or number, the object parser stringifies it before the primitive runs, so `true` and `42` coerce the same way as `"true"` and `"42"`.

Primitives also coerce string forms from query strings and env vars: `"42"` becomes an integer for `int`, `"true"` / `"false"` become booleans, and comma-separated strings become arrays for `array(inner)`.

A schema token is a plain object with `safeParse` and `optional()`. It is not a class and cannot be extended. For a named, extendable DTO class on the same pipeline, use [`model()`](/lib/model/) instead.

## Primitives

Primitives are callable coercers used as leaves inside object descriptors. Each accepts a **string** at the coercer boundary; during `safeParse`, non-array JSON values are passed through `String(value)` first. Primitives **throw** on invalid input; `safeParse` catches those throws and turns them into `FieldError` entries.

Every primitive carries runtime metadata used by serializers and `toJsonSchema`:

- `_type`: discriminator string (`"string"`, `"int"`, `"enum"`, and so on)
- `_required`: `true` by default; `optional()` / `defaultTo()` set this to `false`
- `jsonSchema`: a [JSON Schema Draft 7](https://json-schema.org/draft-07/json-schema-release-notes.html) fragment for this primitive's constraints

Chain methods (`.min`, `.max`, `.pattern`, `.format`) return a **new** primitive; they never mutate the original.

| Token           | Callable input                                                                  | Output                  | Chain methods                                              | Notes                                                                                                   |
| --------------- | ------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `str`           | string (numbers coerced with `String()`)                                        | `string`                | `.min(n)`, `.max(n)`, `.pattern(/…/)`                      | Serialized without escape scanning; unsafe characters can break JSON on output                          |
| `text`          | same coercion as `str`                                                          | `string`                | `.min(n)`, `.max(n)`, `.pattern(/…/)`                      | Always escaped on serialize; use for multiline or untrusted content                                     |
| `int`           | integer string or number                                                        | `number` (integer)      | `.min(n)`, `.max(n)`                                       | Rejects non-integer forms (`1.5`), overflow, and non-safe-integer values                                |
| `float`         | numeric string or number                                                        | `number`                | `.min(n)`, `.max(n)`                                       | Accepts decimal and scientific notation; rejects non-finite values                                      |
| `bool`          | boolean, or `"true"` / `"false"` / `"1"` / `"0"` (case-insensitive)             | `boolean`               | none                                                       |                                                                                                         |
| `uuid`          | UUID v4 string (8-4-4-4-12, version nibble `4`, variant nibble `8`/`9`/`a`/`b`) | `string`                | none                                                       |                                                                                                         |
| `date`          | format-specific string (see below)                                              | `Date`                  | `.format("ISO" \| "YMD" \| "DMY" \| "MDY" \| "TIMESTAMP")` | Defaults to ISO; `.format(...)` sets accepted input and serialized output                               |
| `enums(values)` | string in the allowed set                                                       | union of tuple literals | none                                                       | Pass a `readonly` tuple; use `as const` for literal inference                                           |
| `array(inner)`  | comma-separated string, `string[]`, or JSON array (via `safeParse`)             | `inner[]`               | none                                                       | `""` → `[]`; inherits `inner._required`; use `schema([ItemSchema])` for a top-level JSON array document |

### `str` vs `text`

Both parse identically. On **serialize**, `str` and `uuid` are concatenated raw (no escape scan). Values containing quotes, backslashes, control characters, or newlines can produce **invalid JSON**. Use `text` when the value may contain those characters; it always routes through full JSON escaping.

### `date` formats

| Format            | Accepted input examples                     | Parsed result                                           |
| ----------------- | ------------------------------------------- | ------------------------------------------------------- |
| `"ISO"` (default) | `2024-03-22`, `2024-03-22T14:30:00Z`        | UTC-anchored `Date` (date-only inputs get midnight UTC) |
| `"YMD"`           | `2024/03/22`, `20240322`                    | UTC midnight                                            |
| `"DMY"`           | `22/03/2024`, `22032024`                    | UTC midnight; two-digit years → 2000+                   |
| `"MDY"`           | `03/22/2024`, `03222024`                    | UTC midnight; two-digit years → 2000+                   |
| `"TIMESTAMP"`     | 10-, 13-, or 16-digit Unix timestamp string | Normalised to milliseconds                              |

Invalid input throws `Invalid <format> date: "<raw>"`.

### `array(inner)`

- Comma-separated: `"a,b,c"` → map each segment through `inner` (trimmed).
- String array: `["a", "b"]` → same result.
- JSON array in `safeParse`: `[1, 2, 3]` is passed as `value.map(String)` when the field primitive is `array(int)`.
- Empty string `""` → `[]`.
- Any item failure throws with the inner primitive's message (surfaced at the field path in `safeParse`).

## Combinators

```ts
import { str, int, optional, defaultTo, array } from "@flare-ts/lib/schema";

const Name = str.min(1);
const MaybeName = optional(str); // string | undefined when absent
const RetryCount = defaultTo(3, int); // fallback when absent; note argument order
const Tags = array(str); // string[] from "a,b,c" or ["a","b"]
```

`optional` and `defaultTo` wrap **primitives only** (`TypedPrimitive<T>`). They do not wrap schema tokens or `array(...)` at the type level, though `array(int)` is itself a `TypedPrimitive<number[]>` and can be wrapped.

For an optional **nested object** backed by a schema token, call `.optional()` on that token instead (see [Optional nested schemas](#optional-nested-schemas)).

### `optional(primitive)`

When a field is **absent** or **`""`**, the wrapper returns `undefined` without running the inner primitive's validators. The key is **omitted** from the parsed result object.

When a non-empty value is present, the inner primitive runs normally (including `.min` / `.pattern` constraints).

### `defaultTo(fallback, primitive)`

**Argument order** is `(fallback, primitive)`, for example `defaultTo(3000, int)`, not `(int, 3000)`.

When a field is absent, empty (`""`), `defaultTo` returns `fallback` **without** running the inner primitive's validators. For example, `defaultTo(0, int.min(10))` still yields `0`. Non-empty values below a constraint still fail: `defaultTo(0, int.min(10))` rejects `"3"`.

Wrapping does not mutate the original primitive's `_required`, `_type`, or `jsonSchema`.

## `schema()` overloads

`schema(...)` returns a `SchemaToken<T>`. All overloads share the same runtime API: `safeParse` and `optional()`.

### Object descriptor

```ts
import { schema, str, int, optional } from "@flare-ts/lib/schema";

const User = schema({
  id: int,
  name: str.min(1),
  email: optional(str),
});

const result = User.safeParse({ id: 1, name: "Ada" });
if (result.success) {
  result.data; // { id: number; name: string; email?: string }
}
```

Accepts a record of primitives or nested schema tokens. Nest the token in another descriptor, use it as a field-level value, or pass it as a [contract](/core/http/contracts/) `body` / `response` schema.

`safeParse` materialises **only keys declared in the descriptor**. Extra properties in the input object are ignored.

### Top-level JSON array

Wrap the item schema in a **one-element tuple**. `schema([])` or `schema([a, b])` throws at creation time:

```
Top-level array schemas must be declared with exactly one item schema.
```

Use exactly one item schema instead:

```ts
const World = schema({ id: int });
const Worlds = schema([World]); // parses JSON arrays of World
```

Accepts JSON string, ArrayBuffer, or plain `JsonValue[]`. Wrong root type (object, primitive) yields a single root `FieldError` with `path: ""` and a `message` containing `Expected array`.

### String-keyed records

Uniform values across dynamic string keys:

```ts
const Row = schema({ n: int });
const Table = schema([{ $record: Row }]); // Record<string, Row>
```

- Parsed result is `Object.create(null)` (no inherited `Object.prototype` methods).
- Unsafe keys are rejected with `message: "Unsafe record key"`: `__proto__`, `prototype`, `constructor`.
- Nested value errors use dotted paths: `"myKey.n"`.
- Empty input `{}` → `{ success: true, data: {} }`.

### Discriminated unions

Branch on a string (or numeric) discriminant. Pass `"union"` as the second generic argument:

```ts
type Pet = { kind: "cat"; lives: number; } | { kind: "dog"; breed: string; };

const PetSchema = schema<Pet, "union">("kind", {
  cat: { lives: int },
  dog: { breed: str },
});
```

Every discriminant value in the union type must have a matching branch key. Numeric discriminants (e.g. `kind: 1`) select branches keyed `"1"`, `"2"`, and so on.

Failure modes on the discriminant field:

| Condition                                   | `path`                      | `message`                                                          |
| ------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| Discriminant missing or not a string/number | `"kind"` (discriminant key) | `"Missing or invalid discriminant field"`                          |
| Unknown discriminant value                  | `"kind"`                    | `"Invalid discriminant value"` (`received` is the offending value) |

Branch field failures use the branch field name as `path` (e.g. `"lives"`), not the discriminant path.

### Optional nested schemas

```ts
const Profile = schema({ bio: str }).optional(); // whole object optional on parent

const Account = schema({
  user: User,
  profile: Profile,
});
```

Calling `.optional()` on a schema token marks the entire nested object as optional on the parent. When the field is absent, parsing succeeds and the key is omitted. `.optional()` returns a new token; it does not mutate the original.

Use `optional(primitive)` when the field is a single primitive value.

## `SchemaToken`

```ts
type SchemaToken<T> = {
  safeParse(raw: ArrayBuffer | string | JsonValue): SafeParseResult<T>;
  optional(): SchemaToken<T>;
};
```

`OpaqueSchemaToken` is the type-erased form accepted by `compileSerializer` and `toJsonSchema`.

## Parsing and errors

The public parse API is **`safeParse` only**. Schema tokens do not expose a throwing `parse()`. Unwrap the result, or throw yourself when invalid input is a programmer error:

```ts
const ok = User.safeParse(input);
if (!ok.success) {
  throw new Error(ok.error.fields[0]?.message);
}
// ok.data is T
```

```ts
// { success: true, data: T } | { success: false, error: { fields: FieldError[] } }
```

### `FieldError` / `SchemaError`

```ts
type FieldError = {
  path: string; // "email", "address.street", "items[0].id"
  message: string; // verbatim primitive or parser message
  received: string; // JSON-stringified snapshot of the bad value
};

type SchemaError = { fields: FieldError[]; };
type SafeParseResult<T> =
  | { success: true; data: T; }
  | { success: false; error: SchemaError; };
```

Behavior:

- **Multiple errors** are collected in one `SchemaError`; parsing does not short-circuit on the first failure.
- **Nested paths** use dot notation; nested `schema([Item])` fields prefix item errors with bracket indices (`"items[0].id"`). Top-level `schema([Item])` roots use `"[0].id"`. Primitive `array(...)` field failures use the field key only (e.g. `"tags"`), not per-item indices.
- **Malformed JSON**, wrong root type, or other input-resolution failures return `success: false` with a single field error at `path: ""`, `received: ""`, and `message` starting with `Failed to parse JSON: …`. They do not throw.
- **Primitive given a non-array object** → `message: "Expected primitive value, got object"`.

### Accepted `safeParse` inputs

| Schema shape               | String / ArrayBuffer | Plain value    |
| -------------------------- | -------------------- | -------------- |
| Object descriptor          | JSON object          | `{ … }` object |
| `schema([Item])`           | JSON array           | `JsonValue[]`  |
| `schema([{ $record: … }])` | JSON object          | `{ … }` object |

## Serialization

Validation and serialization are separate. Call the helpers below when you need encoded output or schema export. Everyday request handling only needs `safeParse`.

### `compileSerializer(schema)`

```ts
type Serializer = (doc: JsonValue) => string;

function compileSerializer(token: OpaqueSchemaToken): Serializer;
```

Returns a function that serialises a matching `JsonValue` to a JSON string.

**Dedicated serializers** (emit **only declared fields**; shape-aware coercion for dates, enums, `text`, and primitive arrays):

- Flat object descriptors
- Top-level `schema([Item])` array schemas
- Nested schema tokens and `schema([Item])` field values inside object descriptors
- Primitive `array(...)` fields (`str`, `int`, `float`, `bool`, `date` item types)

**`JSON.stringify` on the whole document** (valid JSON; extra keys on the input are not stripped):

- Record schemas: `schema([{ $record: … }])`
- Discriminated-union schemas

**Rules when calling `compileSerializer`:**

- Descriptor keys must be valid JavaScript identifiers (`/^[a-zA-Z_$][a-zA-Z0-9_$]*$/`); otherwise `compileSerializer` throws `flareSchema: invalid field key "…" - must be a valid JS identifier`. Use camelCase or snake_case keys.
- Optional fields (`optional(...)`, `.optional()` schema tokens) are omitted when the runtime value is `undefined`.
- `str` / `uuid`: written without escape scanning (can emit invalid JSON if values contain special characters). Prefer `text` for those fields.
- `text`: JSON-escaped output.
- `date`: ISO → full ISO string; `YMD` / `DMY` / `MDY` → `"YYYY-MM-DD"`; `TIMESTAMP` → numeric epoch ms; invalid `Date` → `null`.
- `enums`: serialized as JSON string literals from the allowed set.

[HTTP `response` contracts](/core/http/contracts/) call `compileSerializer` on supported shapes at route build time. [`model()`](/lib/model/) caches a compiled serializer on the class (built on first use).

### `toJsonSchema(schema)`

Emits a [JSON Schema Draft 7](https://json-schema.org/draft-07/json-schema-release-notes.html) object for OpenAPI or tooling:

| Schema shape               | Output                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Flat object                | `{ type: "object", properties, required? }`; optional fields omitted from `required`; no `required` key when every field is optional |
| Nested schema token field  | Nested `{ type: "object", … }`                                                                                                       |
| `schema([Item])`           | `{ type: "array", items: … }`                                                                                                        |
| `schema([{ $record: V }])` | `{ type: "object", additionalProperties: <V's schema> }` (not `patternProperties`)                                                   |
| Discriminated union        | `{ anyOf: [ … ] }`; discriminant forced to `{ type: "string" }` in each branch                                                       |

Each primitive's `jsonSchema` property flows through verbatim (including `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `enum`, `format`).

Accepts `OpaqueSchemaToken` (same tokens as `compileSerializer`).

## Exported types

From `@flare-ts/lib/schema`:

| Category        | Symbols                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Functions       | `schema`, `model`, `optional`, `defaultTo`, `compileSerializer`, `toJsonSchema`                                 |
| Primitives      | `str`, `text`, `int`, `float`, `bool`, `uuid`, `date`, `enums`, `array`                                         |
| Schema types    | `SchemaToken`, `OpaqueSchemaToken`, `DescriptorValue`, `BranchShape`, `DiscriminantValues`, `ModelTokenBuilder` |
| Parse types     | `SafeParseResult`, `SchemaError`, `FieldError`, `JsonValue`, `JsonObject`                                       |
| Primitive types | `Primitive`, `TypedPrimitive`, `ArrayTypedPrimitive`, `PrimitiveJsonSchema`                                     |
| Serializer      | `Serializer`                                                                                                    |

## Outside HTTP

Flare uses the same schema package for [`flare.json`](/core/config/), [route contracts](/core/http/contracts/), and compiled response serializers. Use it standalone for CLIs, queue consumers, or config loaders:

```ts
import { schema, str, defaultTo, int } from "@flare-ts/lib/schema";

const Env = schema({
  PORT: defaultTo(3000, int),
  LOG_LEVEL: defaultTo("info", str),
});

const parsed = Env.safeParse({
  PORT: process.env.PORT,
  LOG_LEVEL: process.env.LOG_LEVEL,
});
if (!parsed.success) throw new Error(parsed.error.fields[0]?.message);
// parsed.data.PORT is number; parsed.data.LOG_LEVEL is string
```
