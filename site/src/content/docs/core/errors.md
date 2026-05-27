---
title: Errors
description: FlareError, category-to-status mapping, flareErrorCodes, and errorSchema.
sidebar:
  order: 6
---

Flare models application failures with `FlareError`: stable symbolic names, category keys with default HTTP status codes, optional numeric codes, and optional typed detail payloads that can be serialized to JSON on client-safe paths when `expose` is `true`.

Import registry helpers and types from `@flare-ts/core/errors`. `FlareError` and `FlareValidationError` are also exported from `@flare-ts/core` when you only throw or catch instances and do not need the full errors subpath.

## Public exports (`@flare-ts/core/errors`)

| Symbol                 | Kind     | Role                                                                                                  |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `FlareError`           | class    | Thrown instance with `name`, `category`, optional `code`, and optional detail                         |
| `flareErrorCodes`      | function | Builds a frozen, branded registry from category-grouped descriptors                                   |
| `errorSchema`          | function | Declares the JSON shape of an optional detail payload                                                 |
| `FlareErrorCategories` | const    | Category keys and default HTTP status codes                                                           |
| `FlareErrorCategory`   | type     | Union of valid category keys (`keyof typeof FlareErrorCategories`)                                    |
| `ErrorCodesToken`      | type     | Branded marker on values returned by `flareErrorCodes`                                                |
| `CodeDescriptor`       | type     | Shape of a registry entry (and `FlareError` constructor token)                                        |
| `ErrorSchema`          | type     | Phantom marker returned by `errorSchema<T>()`                                                         |
| `FlareValidationError` | class    | Thrown by `host.build()` when validators report `severity: "error"` entries                           |
| `ValidationError`      | type     | Shape of each entry on `FlareValidationError.errors` (`code`, `message`, optional `hint`, `severity`) |
| `ValidationSeverity`   | type     | `"error"` \| `"warning"` on build validation entries                                                  |

Category keys are the keys of `FlareErrorCategories` (for example `not_found`, `conflict`). Use `FlareErrorCategory` when you need a category-typed parameter or variable. Values from `flareErrorCodes(...)` satisfy `ErrorCodesToken`; use that type when a helper accepts any registry without caring about its specific codes.

## `FlareError`

`FlareError` extends `Error`. The constructor takes a registry entry from `flareErrorCodes` (stamped with `name` and `category` when the registry is built) and, when that entry includes `detail: errorSchema<T>()`, a matching detail value as the second argument.

Thrown instances expose:

| Member          | Description                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`          | Symbolic code name (also `Error.message`)                                                                                                                    |
| `message`       | Same string as `name` (from `Error`)                                                                                                                         |
| `category`      | Category key from the registry group                                                                                                                         |
| `expose`        | When `true`, `detail` may leave the server on client-safe paths; when `false`, `detail` is `undefined` but `exposedDetail` still holds the value for logging |
| `code`          | Optional stable numeric code from the descriptor                                                                                                             |
| `detail`        | Attached detail when `expose` is `true`; otherwise `undefined`                                                                                               |
| `exposedDetail` | Attached detail regardless of `expose` (logging and diagnostics)                                                                                             |

## Categories

`FlareErrorCategories` maps category keys to default status codes:

| Category       | Status |
| -------------- | ------ |
| `invalid`      | 400    |
| `too_large`    | 413    |
| `rejected`     | 422    |
| `unauthorized` | 401    |
| `forbidden`    | 403    |
| `not_found`    | 404    |
| `conflict`     | 409    |
| `throttled`    | 429    |
| `unavailable`  | 503    |
| `fault`        | 500    |

## Defining error codes

Create a registry with `flareErrorCodes(...)` and throw `new FlareError(...)` from entries in that registry:

```ts
import {
  FlareError,
  errorSchema,
  flareErrorCodes,
} from "@flare-ts/core/errors";

const UserErrors = flareErrorCodes({
  not_found: {
    UserNotFound: { expose: true, code: 1001 },
  },
  conflict: {
    EmailTaken: {
      expose: true,
      code: 1002,
      detail: errorSchema<{ email: string; }>(),
    },
  },
});

throw new FlareError(UserErrors.conflict.EmailTaken, { email: "a@b.com" });
```

Each registry entry declares `expose`, optional `code`, and optional `detail`. `flareErrorCodes` stamps each entry with its symbolic `name` (the object key) and `category` (the group key). Returned registries and stamped entries are frozen.

When you call `flareErrorCodes`, it validates the descriptor at runtime:

- Unknown category keys → `TypeError`
- Non-object entries, missing boolean `expose`, or non-safe-integer `code` → `TypeError`
- Duplicate numeric `code` values across the registry → `Error`

`errorSchema<T>()` requires `T` to be JSON-serializable (`JsonValue` from [`@flare-ts/lib/schema`](/lib/schema/#exported-types)). When a descriptor includes `detail: errorSchema<T>()`, the `FlareError` constructor requires a matching detail value as the second argument. Omit the second argument when the descriptor has no detail schema.

## Stamped descriptors

On entries returned from `flareErrorCodes`:

| Field      | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| `name`     | Symbolic name (also used as `Error.message` when thrown)     |
| `category` | Category key from the enclosing group                        |
| `expose`   | Whether detail may leave the server in client-safe paths     |
| `code`     | Optional stable numeric code                                 |
| `detail`   | Optional `errorSchema<T>()` marker (not the runtime payload) |

`CodeDescriptor` describes this stamped shape for typing helpers and wrappers.

## HTTP interplay

In HTTP execution, `FlareError` categories map to status codes through the category table above. For registration, default fallback bodies, and paths that skip custom handlers, see [HTTP errors](/core/http/errors/).

## Related

- [Failure modes](/core/failure-modes/): where errors surface across registration/build/compile/request
- [HTTP errors](/core/http/errors/): pipeline error handling behavior
