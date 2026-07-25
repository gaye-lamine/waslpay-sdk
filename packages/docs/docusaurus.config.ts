import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const coreNodePackage = JSON.parse(
  readFileSync(resolve(configDirectory, "../core-node/package.json"), "utf8"),
) as { version: string };

const config: Config = {
  title: "WaslPay",
  tagline: "Documentation du SDK de paiement mobile unifié",
  favicon: "img/favicon.svg",
  url: "https://gaye-lamine.github.io",
  baseUrl: "/waslpay-sdk/",
  organizationName: "gaye-lamine",
  projectName: "waslpay-sdk",
  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  i18n: {
    defaultLocale: "fr",
    locales: ["fr"],
  },
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/gaye-lamine/waslpay-sdk/tree/main/packages/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    navbar: {
      title: "WaslPay",
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Documentation" },
        { to: "/cli", label: "CLI", position: "left" },
        { to: "/", label: `SDK v${coreNodePackage.version}`, position: "right" },
        { href: "https://github.com/gaye-lamine/waslpay-sdk", label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "SDK",
          items: [
            { label: "Node.js", href: "https://www.npmjs.com/package/@waslpay/core-node" },
            { label: "PHP", href: "https://packagist.org/packages/waslpay/core-php" },
            { label: "Python", href: "https://pypi.org/project/waslpay-sdk/" },
          ],
        },
        {
          title: "Projet",
          items: [
            { label: "GitHub", href: "https://github.com/gaye-lamine/waslpay-sdk" },
            { label: "Changelog", href: "https://github.com/gaye-lamine/waslpay-sdk/blob/main/CHANGELOG.md" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} WaslPay. MIT License.`,
    },
    prism: {
      additionalLanguages: ["php", "python"],
    },
    docs: {
      sidebar: {
        hideable: true,
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
