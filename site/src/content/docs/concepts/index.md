---
title: Concepts
description: "How Flare thinks: arcs, composition, dependency injection, and shared vocabulary."
sidebar:
  order: 0
---

These pages explain how Flare is structured before you read API tables. Start here after [Install](/getting-started/install/); use [Core](/core/) for signatures, validator codes, and request-time behavior.

Read them in order: [Arc Model](/concepts/arc-model/) sets up the vocabulary, [Composition](/concepts/composition/) explains what `build()` validates, [Dependency Injection](/concepts/dependency-injection/) covers how services wire together, and [Glossary](/concepts/glossary/) is a reference you return to.

## Mental model

Flare is composition-first. You register three things on a `FlareHost`:

1. **Config** (`host.cfg(...)`) for typed `flare.json` sections.
2. **Services** (`host.scoped()` / `host.singleton()`) for DI-resolvable classes.
3. **HTTP surface** (`host.http.*`) for routes, controllers, middleware, and contracts.

Calling `host.build()` returns a compiled app ready to run: config is parsed and merged, the logger is bootstrapped, service/HTTP/config validator suites run, then scoped and singleton registries compile and the HTTP arc builds its router and per-route pipelines. On Node, call `app.run()`; on Workers, call `app.export()`; in test mode, call `app.test()`. Nothing in that graph is inferred at request time.

Failures surface before traffic:

- Invalid config schema types throw a plain `Error` during config compile (before validators).
- Validator failures throw [`FlareValidationError`](/core/failure-modes/) with structured entries on `err.errors` (`code`, `message`, optional `hint`).
- HTTP compile gaps (for example a `state` token no middleware `provides`) throw a plain `Error` after validators pass.

Routing decorators (`@Get`, `@Post`, and similar from `@flare-ts/core/decorators`) follow the [TC39 standard](https://github.com/tc39/proposal-decorators), not the legacy `experimentalDecorators` / [reflect-metadata](https://github.com/rbuckton/reflect-metadata) mechanism. They record method and path metadata at class definition time and do not participate in DI.

## Arc model

An **arc** is a transport capability on the host. Today only **`host.http`** exists: routing, middleware (`before` / `after` / `finally`), request state, contracts, and CORS. Arcs own transport; services and config stay on the host so the same `FlareService` can serve HTTP now and future arcs (background workers, WebSockets, and similar) without rewriting business logic.

Future arc surfaces are not implemented yet. The composition model is designed to stay the same when they land. See [Arc Model](/concepts/arc-model/) for the HTTP registration surface and request pipeline.

## Composition and startup validation

Registration is explicit. A class without `static deps` throws when you call `host.scoped()`, `host.singleton()`, `host.http.use()`, or `host.http.controller()`, not on first request. Controllers and middleware also need `static state` (may be `[]`) when you register them.

`host.build()` then runs the service, HTTP, and config validator suites, followed by DI and HTTP compile (router, pipelines, state provisioning order).

Validator failures throw [`FlareValidationError`](/core/failure-modes/). HTTP compile failures (such as a state token no middleware `provides`) throw a plain `Error`. See [Composition](/concepts/composition/) for what each validator checks and [Failure modes](/core/failure-modes/) for the full error catalog.

## Dependency injection

DI is static: every service, controller, and middleware declares `static deps` (may be `[]`). `this.inject(Token)` only resolves tokens listed in `deps`; calling `inject()` with an unlisted token throws at the call site with a message naming the class and token. Listing a token in `deps` that you never registered with the host fails at `host.build()` as `UNDECLARED_DEPENDENCY` (services) or `CONTROLLER_UNREGISTERED_DEP` / `MIDDLEWARE_UNREGISTERED_DEP` (HTTP classes).

| Lifetime                         | When created                                                                  | Workers?                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Scoped** (`host.scoped`)       | First `inject()` in a request; `dispose()` after the response                 | Yes                                                                       |
| **Singleton** (`host.singleton`) | Instantiated at `host.build()` in production; `onStart()` when the app starts | No: use `host.scoped()` instead (`host.singleton()` throws on Cloudflare) |

A singleton that lists a scoped service in `static deps` fails at `build()` with `CAPTIVE_DEPENDENCY`. Register the dependency as a singleton too, make the dependent scoped, or pass request-scoped data into methods instead of holding a scoped instance on a singleton. See [Dependency Injection](/concepts/dependency-injection/) for resolution order, token types, and runtime guardrails. In test mode, singleton compile timing differs; see [Core → Testing](/core/testing/).

## Where to go next

| Goal                                 | Page                                                     |
| ------------------------------------ | -------------------------------------------------------- |
| API reference for `FlareHost`        | [Core → Host](/core/host/)                               |
| Routes, middleware, state, contracts | [Core → HTTP](/core/http/)                               |
| When errors surface                  | [Core → Failure modes](/core/failure-modes/)             |
| Copy-paste patterns                  | [Getting Started → Examples](/getting-started/examples/) |
| Term definitions                     | [Glossary](/concepts/glossary/)                          |
