# Flare documentation

**Single source of truth:** all user-facing docs live in the Starlight content tree:

[`site/src/content/docs/`](site/src/content/docs/)

The legacy [`md/`](md/) folder only contains a pointer README — do not add pages there.

| Path                                               | Purpose                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`site/src/content/docs/`](site/src/content/docs/) | Markdown pages (edit here)                                                     |
| [`site/`](site/)                                   | [Astro Starlight](https://starlight.astro.build/) site — theme, sidebar, build |
| [`audit/`](audit/)                                 | Doc accuracy audits (source-of-truth cross-checks)                             |

The docs site is part of the pnpm workspace at the repo root.

## Local preview

```bash
pnpm install              # from the repo root
pnpm --filter flare-docs-site dev
```

Or from `docs/site/`:

```bash
pnpm dev
```

Content is loaded by Starlight's default `docsLoader()` (see [`site/src/content.config.ts`](site/src/content.config.ts)).

## Production build (local verify)

```bash
pnpm --filter flare-docs-site build
```

Output lands in `docs/site/dist/`. Use this to catch broken links or MDX errors before publishing.

## Branding

Logo and favicon are copied from [`../branding/`](../branding/) into `site/public/` and `site/src/assets/`. Re-copy after updating brand assets.
