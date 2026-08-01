import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "introduction",
    "playground",
    {
      type: "category",
      label: "Démarrer",
      items: ["getting-started/quickstart", "getting-started/testing-without-api-keys"],
    },
    {
      type: "category",
      label: "Guides",
      items: ["guides/webhooks", "guides/refunds"],
    },
    {
      type: "category",
      label: "Providers",
      items: ["providers/capabilities"],
    },
    {
      type: "category",
      label: "Référence",
      items: ["reference/contract", "compatibility"],
    },
    "cli",
  ],
};

export default sidebars;
