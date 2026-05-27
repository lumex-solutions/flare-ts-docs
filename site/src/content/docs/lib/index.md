---
title: Lib
description: "Reference for @flare-ts/lib: schema validation, primitives, and model."
sidebar:
  order: 0
---

`@flare-ts/lib` is a standalone TypeScript utility library with zero third-party runtime dependencies. Use it on its own in any TypeScript project, or alongside `@flare-ts/core` in a Flare app — schema and model symbols are always imported from this package, never from core. The package ships one public module today: schema validation and JSON serialization under `./schema`.

For HTTP contracts and Flare-specific composition, see [Core](/core/). The pages below cover the schema library itself.

## Topics in this section

- **[Schema](/lib/schema/)**: `schema()`, primitives, `safeParse`, discriminated unions, records, and serializers (`compileSerializer`, `toJsonSchema`).
- **[Model](/lib/model/)**: `model()` for named DTO classes with the same validation and serialization surface as `schema()`.

## Package exports

| Subpath       | Use for                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `.` (default) | Primitives, `schema()`, `model()`, serializers (`compileSerializer`, `toJsonSchema`), and all related types |
| `./schema`    | Same symbols as the default entry; prefer when the import path should name the module                       |

Both entries resolve to identical symbols. Prefer `./schema` when you want the import path to name the module explicitly; either path works.

```ts
import { schema, str, int, compileSerializer } from "@flare-ts/lib/schema";
// equivalent:
import { schema, str, int, compileSerializer } from "@flare-ts/lib";
```

## Public API

Everything below is exported from `@flare-ts/lib` and `@flare-ts/lib/schema`. `@flare-ts/core` does not re-export any of these — even in a Flare app, import them from this package.

### Builders

| Symbol   | Summary                                                                                                                                                                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema` | Creates a schema token. Overloads: object descriptor, top-level array `[ItemSchema]`, top-level record `[{ $record: ValueSchema }]`, and discriminated union `(discriminant, branches)`.                                                                                   |
| `model`  | Creates an extendable schema-token class. Overloads: existing `SchemaToken`, object descriptor, or discriminated union. For top-level array or record shapes, build `schema([...])` or `schema([{ $record: ... }])` first, then pass that token to `model(existingToken)`. |

Schema tokens (from `schema()` or `model()`) expose:

- `safeParse(raw: ArrayBuffer | string | JsonValue): SafeParseResult<T>`: on success you get typed `data`; on failure you get `{ success: false, error: SchemaError }`. The call never throws.
- `optional(): SchemaToken<T>`: marks this token optional when nested in a parent descriptor (see [Optional nested schemas](/lib/schema/#optional-nested-schemas) on the Schema page).

### Primitives and combinators

| Symbol      | Summary                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `str`       | String coercer; `.min`, `.max`, `.pattern`                                                             |
| `text`      | String coercer with full JSON escaping on serialize (multiline / untrusted text)                       |
| `int`       | Integer coercer; `.min`, `.max`                                                                        |
| `float`     | Number coercer; `.min`, `.max`                                                                         |
| `bool`      | Boolean coercer                                                                                        |
| `uuid`      | UUID v4 string coercer                                                                                 |
| `date`      | Date coercer; `.format("ISO" \| "YMD" \| "DMY" \| "MDY" \| "TIMESTAMP")`                               |
| `enums`     | Literal union from a readonly tuple of allowed strings                                                 |
| `array`     | Comma-separated or JSON-array coercer for a nested primitive or schema inner type                      |
| `optional`  | Wraps a **primitive** so absent, empty, or `null` input becomes `undefined`                            |
| `defaultTo` | Wraps a **primitive** with a fallback when absent, empty, or `null`; signature `(fallback, primitive)` |

Use `optional(innerPrimitive)` on primitive fields. Use `.optional()` on a nested `SchemaToken` when the whole nested object may be absent. See [Combinators](/lib/schema/#combinators) for examples and edge cases.

### Serialization

| Symbol              | Summary                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `compileSerializer` | `(token: OpaqueSchemaToken) => Serializer`: returns a function that turns a matching `JsonValue` into a JSON string |
| `toJsonSchema`      | `(token: OpaqueSchemaToken) => object`: returns a [JSON Schema](https://json-schema.org/) description of the token  |

### Types

| Symbol                | Summary                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| `ModelTokenBuilder`   | Extendable constructor intersected with `SchemaToken<T>`; return type of `model()` |
| `SchemaToken`         | Parsed schema with `safeParse` and `optional()`                                    |
| `OpaqueSchemaToken`   | Schema identity without output type (serializer / JSON Schema input)               |
| `DescriptorValue`     | Field value in a descriptor: `TypedPrimitive<T>` or `SchemaToken<T>`               |
| `DiscriminantValues`  | Union of discriminant literal values for discriminated schemas                     |
| `BranchShape`         | Branch field shape with discriminant key omitted                                   |
| `SafeParseResult`     | `{ success: true; data: T } \| { success: false; error: SchemaError }`             |
| `SchemaError`         | `{ fields: FieldError[] }`                                                         |
| `FieldError`          | `{ path, message, received }` per failed field                                     |
| `JsonValue`           | Any JSON-serializable value                                                        |
| `JsonObject`          | `{ [key: string]: JsonValue }`                                                     |
| `Serializer`          | `(doc: JsonValue) => string`                                                       |
| `Primitive`           | Opaque primitive coercer reference                                                 |
| `TypedPrimitive`      | Callable primitive with output type `(v: string) => T`                             |
| `ArrayTypedPrimitive` | Array-accepting primitive coercer                                                  |
| `PrimitiveJsonSchema` | JSON Schema fragment attached to a primitive                                       |

## Importing from a Flare app

`@flare-ts/core` owns Flare-specific composition (`FlareHost`, `FlareService`, `ControllerBase`, `flareContract`, `flareConfig`, …) and nothing else. Anything that describes a schema or model — primitives, combinators, `schema()`, `model()`, serializers, and the related types — is imported from `@flare-ts/lib/schema` (or the equivalent default entry `@flare-ts/lib`):

```ts
import { ControllerBase, flareContract } from "@flare-ts/core";
import {
  model,
  str,
  int,
  optional,
  schema,
  compileSerializer,
} from "@flare-ts/lib/schema";
```

This stays true whether the consumer is a Flare host, a standalone CLI, or a queue worker — there is exactly one place to import schema and model symbols from.
