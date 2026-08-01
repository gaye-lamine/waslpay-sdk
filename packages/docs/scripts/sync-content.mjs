import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const source = resolve(packageRoot, "..", "..", "COMPATIBILITY.md");
const docsDirectory = resolve(packageRoot, "docs");
const compatibilityDestination = resolve(docsDirectory, "compatibility.md");
const capabilitiesDestination = resolve(docsDirectory, "providers", "capabilities.md");

await mkdir(dirname(compatibilityDestination), { recursive: true });
await mkdir(dirname(capabilitiesDestination), { recursive: true });
const content = await readFile(source, "utf8");
const publicContent = content.replace(
  "](spec/provider-interface.md)",
  "](https://github.com/gaye-lamine/waslpay-sdk/blob/main/spec/provider-interface.md)",
);
const capabilitiesMatch = content.match(
  /^## Capacités par provider \(identiques dans les 3 langages\)\r?\n\r?\n(?<table>(?:\|.*\r?\n)+)/m,
);

if (!capabilitiesMatch?.groups?.table) {
  throw new Error("Unable to extract the provider capabilities table from COMPATIBILITY.md.");
}

const capabilitiesContent = `---
sidebar_position: 1
---

# Capacités des providers

${capabilitiesMatch.groups.table.trimEnd()}

Les limites et différences entre runtimes sont documentées dans la page de
[compatibilité](../compatibility.md).
`;

await writeFile(compatibilityDestination, publicContent);
await writeFile(capabilitiesDestination, capabilitiesContent);
