import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";
import starlightLinksValidator from "starlight-links-validator";

export default defineConfig({
  site: "https://flare-ts.dev",
  integrations: [
    starlight({
      title: "Flare",
      description: "Composition-first TypeScript HTTP framework.",
      logo: {
        src: "./src/assets/flare-wordmark.svg",
        alt: "Flare",
        replacesTitle: true,
      },
      favicon: "/favicon.png",
      customCss: ["./src/styles/flare.css"],
      // Show an Edit-this-page link wired to GitHub and a per-page Last-updated
      // timestamp (Starlight reads it from git log per file).
      editLink: {
        baseUrl: "https://github.com/lumex-solutions/flare-ts-docs/edit/main/",
      },
      lastUpdated: true,
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
        Sidebar: "./src/components/Sidebar.astro",
        PageTitle: "./src/components/PageTitle.astro",
        PageSidebar: "./src/components/PageSidebar.astro",
        Banner: "./src/components/Banner.astro",
        Footer: "./src/components/Footer.astro",
      },
      plugins: [
        // Validate every internal link at build time — broken refs fail CI.
        starlightLinksValidator(),
        // Generate /llms.txt and /llms-full.txt so AI tools can ingest the docs.
        starlightLlmsTxt({
          projectName: "Flare",
          description:
            "Composition-first TypeScript HTTP framework. One application graph for Node and Cloudflare Workers, validated before traffic.",
        }),
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/lumex-solutions/flare-ts",
        },
        {
          icon: "discord",
          label: "Discord",
          href: "https://discord.gg/BpfrzKhhsV",
        },
      ],
      head: [
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" },
        },
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.gstatic.com",
            crossorigin: "",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap",
          },
        },
      ],
      sidebar: [
        { label: "Introduction", link: "/" },
        {
          label: "Getting Started",
          items: [{ autogenerate: { directory: "getting-started" } }],
        },
        {
          label: "Concepts",
          items: [{ autogenerate: { directory: "concepts" } }],
        },
        {
          label: "Core",
          items: [
            { label: "Overview", slug: "core" },
            { slug: "core/host" },
            {
              label: "HTTP",
              items: [
                { label: "Overview", slug: "core/http" },
                { slug: "core/http/routes" },
                { slug: "core/http/middleware" },
                { slug: "core/http/request" },
                { slug: "core/http/response" },
                { slug: "core/http/state" },
                { slug: "core/http/contracts" },
                { slug: "core/http/errors" },
                { slug: "core/http/routing-reference" },
              ],
            },
            { slug: "core/logger" },
            { slug: "core/config" },
            { slug: "core/testing" },
            { slug: "core/errors" },
            { slug: "core/failure-modes" },
          ],
        },
        {
          label: "Lib",
          items: [{ autogenerate: { directory: "lib" } }],
        },
      ],
    }),
  ],
});
