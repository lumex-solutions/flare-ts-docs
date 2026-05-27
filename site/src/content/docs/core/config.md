---
title: Config
description: flareConfig tokens, flare.json sections, environment overrides, and how config reaches your services.
---

`flareConfig("section", { ... })` creates a **typed config token**: a small object keyed to a top-level section in `flare.json`. Register tokens with `host.cfg()`, list them on classes that read config, and resolve values with `this.config(token)` or `scope.config(token)` after `host.build()`. The built host also exposes parsed sections on `host.config` (for example `host.config.db`).

## Public API

These symbols are exported from `@flare-ts/core`:

| Symbol            | Kind     | Role                                                             |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `flareConfig`     | function | Creates a config token for a top-level `flare.json` section      |
| `HOST_CONFIG`     | token    | Built-in token for the `host` section (auto-registered)          |
| `LOG_CONFIG`      | token    | Built-in token for the `log` section (auto-registered)           |
| `ConfigToken<T>`  | type     | Token type; carries section type `T` via a phantom `_type` field |
| `FlareHostConfig` | type     | Resolved shape of `host.config.host`                             |
| `FlareLogConfig`  | type     | Resolved shape of `host.config.log`                              |

Descriptor primitives (`str`, `int`, `bool`, `date`, `float`, `uuid`, `array`, `enums`, `optional`, `defaultTo`) are also exported from `@flare-ts/core`. Nested object shapes use `schema({ ... })` from `@flare-ts/lib`.

Import path for editor JSON Schema autocomplete:

```jsonc
{
  "$schema": "./node_modules/@flare-ts/core/flare.schema.json"
}
```

The schema is also addressable as `@flare-ts/core/flare.schema.json` (see [package exports](https://www.npmjs.com/package/@flare-ts/core)).

### `flareConfig(key, descriptor)`

```ts
function flareConfig<T extends Record<string, unknown>>(
  key: string,
  descriptor: T,
): ConfigToken<> /* section shape inferred from descriptor */;
```

- **`key`**: top-level property name in `flare.json` (for example `"db"`).
- **`descriptor`**: map of field names to schema primitives from `@flare-ts/core` or nested `schema({ ... })` from `@flare-ts/lib`.
- **Return value**: `{ key, descriptor? }`. The same object reference must flow through `host.cfg()`, `static config`, and `this.config()` / `scope.config()`.

#### Descriptor behavior

| Call                                                            | Runtime token shape                                                                 | Field validation at `host.build()`                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `flareConfig("db", { url: str, … })`                            | `{ key, descriptor }` with your field map                                           | Required fields must appear in merged config              |
| `flareConfig("empty", {})`                                      | `{ key, descriptor: {} }` — empty object is **truthy**, so this is **not** key-only | Runs field checks over zero keys (no required fields)     |
| Falsy second argument (e.g. `undefined as never` in tests only) | `{ key }` only — no `descriptor` property                                           | Section key presence only; no per-field schema validation |

There is no public overload that omits the second argument in TypeScript. For complex or nested shapes where you only want the top-level section key validated, use a typed `ConfigToken<T>` with a manual `{ key }` token in tests, or pass `{}` when you want an empty field map (not the same as key-only).

### `ConfigToken<T>`

- **`key: string`**: section name in `flare.json`.
- **`descriptor?`**: field schema used during `host.build()`; omitted on key-only tokens.
- **`_type?: T`**: compile-time phantom only.

### `HOST_CONFIG` and `FlareHostConfig`

`HOST_CONFIG` is registered automatically in the `FlareHost` constructor. Resolved fields on `host.config.host`:

| Field              | Type      | Default                     |
| ------------------ | --------- | --------------------------- |
| `env`              | `string`  | `"development"`             |
| `port`             | `number`  | `3000`                      |
| `host`             | `string`  | `"localhost"`               |
| `shutdownTimeout`  | `number`  | `10000` (ms)                |
| `maxBodyBytes`     | `number`  | `2097152` (2 MiB)           |
| `requestIdHeader`  | `boolean` | `true`                      |
| `requestTiming`    | `boolean` | `false`                     |
| `keepAliveTimeout` | `number`  | `65000` (ms)                |
| `headersTimeout`   | `number`  | `60000` (ms)                |
| `requestTimeout`   | `number`  | `300000` (ms; `0` disables) |

See [Host](/core/host/) for how the Node and Cloudflare runtimes apply listen and timeout settings.

### `LOG_CONFIG` and `FlareLogConfig`

`LOG_CONFIG` is registered automatically in the `FlareHost` constructor. Resolved fields on `host.config.log`:

| Field           | Type                                                           | Default                                                                            |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `level`         | `"trace" \| "debug" \| "info" \| "warn" \| "error" \| "fatal"` | `"info"` (`"debug"` when `host.env` is `"development"` and `log.level` is unset)   |
| `format`        | `"pretty" \| "json"`                                           | `"json"` (`"pretty"` when `host.env` is `"development"` and `log.format` is unset) |
| `enableContext` | `boolean`                                                      | `false`                                                                            |
| `transports`    | `Record<string, { level: LogLevel }>`                          | optional; keys are a transport's static `transportName`                            |

`LogLevel` is exported from `@flare-ts/core`. See [Logger](/core/logger/) for levels, formats, and transports.

## Defining a token

Declare tokens at module scope:

```ts
import { flareConfig } from "@flare-ts/core";
import { bool, defaultTo, int, schema, str } from "@flare-ts/lib/schema";

const DbConfig = flareConfig("db", {
  url: str,
  password: str,
});

const MixedConfig = flareConfig("mixed", {
  url: str,
  retries: int,
  opts: schema({ host: str, port: int }),
});

const FeatureConfig = flareConfig("feature", {
  enabled: defaultTo(false, bool),
  motd: str,
});
```

TypeScript infers the section type from the descriptor. `DbConfig` resolves to `{ url: string; password: string }` wherever you call `this.config(DbConfig)` or read `host.config.db` after build.

Required descriptor fields must be present in the merged config (from `flare.json`, env, or `defaultTo` / `optional`). Build failures for missing sections or fields are documented in [Failure modes](/core/failure-modes/).

## Registering on the host

Every token a class lists in `static config` must be registered before `host.build()`.

```ts
import { FlareHost, flareConfig } from "@flare-ts/core";
import { node } from "@flare-ts/core/node";
import { int, schema, str } from "@flare-ts/lib/schema";

const DbConfig = flareConfig("db", { url: str, password: str });
const MixedConfig = flareConfig("mixed", {
  url: str,
  retries: int,
  opts: schema({ host: str, port: int }),
});

const host = new FlareHost(node);
host.cfg(DbConfig, MixedConfig);
```

`host.cfg` is variadic: pass one or more tokens in a single call, or call `host.cfg()` again to add more. `HOST_CONFIG` and `LOG_CONFIG` are registered automatically in the `FlareHost` constructor.

Only sections whose tokens are registered with `host.cfg()` appear on `host.config` after build, even if the same keys exist in `flare.json` or env overrides.

## Reading from classes

Services, controllers, middleware, and error handlers extend `FlareBase` and declare which tokens they use:

```ts
import { FlareService, flareConfig } from "@flare-ts/core";
import { str } from "@flare-ts/lib/schema";

const DbConfig = flareConfig("db", { url: str, password: str });

class Db extends FlareService {
  public static override deps = [];
  public static override config = [DbConfig];

  getUrl() {
    return this.config(DbConfig).url;
  }
}
```

`this.config(Token)` returns the typed section object. The same protected method exists on `ControllerBase`, `MiddlewareBase`, and `ErrorHandlerBase`.

**Referential identity:** the `Token` argument must be the **same object** you passed to `host.cfg()` and listed in `static config`. A new object with the same `key` and `descriptor` shape is not accepted.

**Runtime guard:** if `Token` is not in `static config`, `this.config(Token)` throws before resolution.

**Build guard:** if a class lists a token in `static config` but you never called `host.cfg(Token)`, `host.build()` fails during startup validation. See [Failure modes](/core/failure-modes/) for codes and fixes.

## Reading from inline routes

Inline handlers have no `static config` array. Use the handler `scope` (`FlareHandlerScope`) instead:

```ts
host.http.get("/db", (_ctx, scope) => scope.config(DbConfig));
```

`scope.config(Token)` resolves from the built host config and does not check `static config`. The token must still be registered with `host.cfg()` so the section exists after build.

## `flare.json`

```jsonc
{
  "$schema": "./node_modules/@flare-ts/core/flare.schema.json",
  "host": { "port": 4000, "env": "development" },
  "log": { "level": "debug", "format": "pretty" },
  "db": { "url": "postgres://localhost/app", "password": "${SECRET}" },
  "mixed": {
    "url": "https://x",
    "retries": 3,
    "opts": { "host": "x", "port": 9 }
  }
}
```

### `flare.schema.json`

The bundled schema documents **`host`** and **`log`** for editor autocomplete. Custom sections from `flareConfig` are validated at `host.build()` against your descriptors; they are not fixed properties in the published schema file. The root schema sets `"additionalProperties": true` so extra top-level keys do not break the editor.

Both `host` and `log` sections in the schema set `"additionalProperties": false` and list the same fields as `FlareHostConfig` and `FlareLogConfig` above (with matching defaults in schema metadata).

## Environment overrides

Set `FLARE__section__field` in the process environment (or adapter `env` on Workers) to override values before schema validation. Nested paths use extra `__` segments:

```bash
FLARE__host__port=4000
FLARE__log__level=warn
FLARE__db__url="postgres://prod-host/app"
FLARE__mixed__opts__port=10
```

For registered sections, field names in the env path are matched case-insensitively to descriptor keys, so `FLARE__db__URL` sets `db.url` the same as `FLARE__db__url`.

Overrides for sections you never registered with `host.cfg()` are merged into the raw pre-parse object but omitted from **`host.config`** after parsing. The same applies to extra keys in `flare.json` with no matching `host.cfg()` token.

Env values are strings; numeric and boolean fields are coerced during schema parse.

## Missing `flare.json` and empty sections

If the adapter cannot read `flare.json` (`ENOENT`), build continues with `{}` plus env overrides (a log line notes the missing file). Non-`ENOENT` read errors abort build.

For each token registered with `host.cfg()`, if the section is still missing after merge, the host inserts `{}` so descriptor `defaultTo(...)` and schema defaults can apply during parse.

## Resolution order

At `host.build()`, config compilation applies layers in this order:

1. `flare.json` from the adapter (or `{}` when the file is missing).
2. `FLARE__*` env overrides merged into that raw object.
3. Each registered section still absent from the raw object is set to `{}`.
4. When merged `host.env` is `"development"`, unset `log.level` / `log.format` become `"debug"` / `"pretty"` (only if those fields are still `undefined` after step 2).
5. Schema validation per registered descriptor (`defaultTo(...)` fills defaults here). The result becomes `host.config`.
6. Startup validation (for example undeclared tokens on classes). See [Failure modes](/core/failure-modes/).

Invalid types or shapes in step 5 throw a plain `Error` with message `Config validation failed: …`. `HOST_CONFIG` and `LOG_CONFIG` receive framework defaults in step 5 when their sections are absent or partial.
