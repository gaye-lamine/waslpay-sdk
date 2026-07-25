import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateEnvExample, type Provider } from "../src/generators/env.js";
import { generateNodeBoilerplate, type NodeFramework } from "../src/generators/boilerplates/node.js";
import { generatePhpBoilerplate, type PhpFramework } from "../src/generators/boilerplates/php.js";
import { generatePythonBoilerplate, type PythonFramework } from "../src/generators/boilerplates/python.js";

const providers: readonly Provider[] = ["orange-money", "wave", "mtn-momo"];

const providerEnvironmentLines: Readonly<Record<Provider, readonly string[]>> = {
  "orange-money": ["ORANGE_MONEY_CLIENT_ID=", "ORANGE_MONEY_ENVIRONMENT=sandbox"],
  wave: ["WAVE_API_KEY=", "WAVE_WEBHOOK_SECRET="],
  "mtn-momo": ["MTN_MOMO_SUBSCRIPTION_KEY=", "MTN_MOMO_DEFAULT_CURRENCY=XOF"],
};

function verifyNodeSyntax(code: string): void {
  // Strip TS experimental decorator annotations for node --check compatibility
  const cleanCode = code.replace(/@[A-Za-z0-9_]+(?:\([^)]*\))?/g, "");
  const file = join(tmpdir(), `test_generated_${Date.now()}_${Math.random().toString(36).substring(2)}.mjs`);
  try {
    writeFileSync(file, cleanCode, "utf8");
    execSync(`node --check "${file}"`, { stdio: "pipe" });
  } finally {
    try { unlinkSync(file); } catch {}
  }
}

function verifyPhpSyntax(code: string): void {
  const file = join(tmpdir(), `test_generated_${Date.now()}_${Math.random().toString(36).substring(2)}.php`);
  try {
    writeFileSync(file, code, "utf8");
    execSync(`php -l "${file}"`, { stdio: "pipe" });
  } catch (err: any) {
    if (err.code === "ENOENT" || err.message?.includes("not found") || err.message?.includes("n'est pas reconnu")) {
      return; // PHP CLI not installed on environment
    }
    throw err;
  } finally {
    try { unlinkSync(file); } catch {}
  }
}

function verifyPythonSyntax(code: string): void {
  const file = join(tmpdir(), `test_generated_${Date.now()}_${Math.random().toString(36).substring(2)}.py`);
  try {
    writeFileSync(file, code, "utf8");
    execSync(`python -m py_compile "${file}"`, { stdio: "pipe" });
  } catch (err: any) {
    if (err.code === "ENOENT" || err.message?.includes("not found") || err.message?.includes("n'est pas reconnu")) {
      return; // Python CLI not installed on environment
    }
    throw err;
  } finally {
    try { unlinkSync(file); } catch {}
  }
}

describe("generateEnvExample", () => {
  it.each(providers)("includes the expected variables for %s", (provider) => {
    const generated = generateEnvExample([provider]);

    expect(generated).toContain("# WaslPay SDK configuration");
    for (const expectedLine of providerEnvironmentLines[provider]) {
      expect(generated).toContain(expectedLine);
    }
  });

  it("preserves provider order when generating multiple sections", () => {
    const generated = generateEnvExample(["wave", "mtn-momo"]);

    expect(generated.indexOf("# Wave Sénégal Checkout")).toBeLessThan(generated.indexOf("# MTN MoMo Collection"));
  });
});

const nodeFrameworks: readonly NodeFramework[] = ["express", "fastify", "nestjs"];

describe("generateNodeBoilerplate", () => {
  it.each(nodeFrameworks.flatMap((framework) => providers.map((provider) => [framework, provider] as const)))
  ("generates %s boilerplate for %s", (framework, provider) => {
    const generated = generateNodeBoilerplate(framework, [provider]);

    expect(generated).toContain(`// Generated for ${framework}. Selected providers: ${provider}`);
    expect(generated).toContain("new WaslPay(provider);");

    // Syntax validation check (node --check)
    expect(() => verifyNodeSyntax(generated)).not.toThrow();
  });
});

const phpFrameworks: readonly PhpFramework[] = ["laravel", "symfony", "native"];

describe("generatePhpBoilerplate", () => {
  it.each(phpFrameworks.flatMap((framework) => providers.map((provider) => [framework, provider] as const)))
  ("generates %s boilerplate for %s", (framework, provider) => {
    const generated = generatePhpBoilerplate(framework, [provider]);

    expect(generated).toContain(`// Generated for ${framework}. Selected providers: ${provider}`);
    expect(generated).toContain("new WaslPay($provider);");

    // Syntax validation check (php -l)
    expect(() => verifyPhpSyntax(generated)).not.toThrow();
  });
});

const pythonFrameworks: readonly PythonFramework[] = ["fastapi", "django"];

describe("generatePythonBoilerplate", () => {
  it.each(pythonFrameworks.flatMap((framework) => providers.map((provider) => [framework, provider] as const)))
  ("generates %s boilerplate for %s", (framework, provider) => {
    const generated = generatePythonBoilerplate(framework, [provider]);

    expect(generated).toContain(`# Generated for ${framework}. Selected providers: ${provider}`);
    expect(generated).toContain("waslpay = WaslPay(provider)");

    // Syntax validation check (python -m py_compile)
    expect(() => verifyPythonSyntax(generated)).not.toThrow();
  });
});
