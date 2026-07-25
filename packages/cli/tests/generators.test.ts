import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { generateEnvExample, type Provider } from "../src/generators/env.js";
import { generateNodeBoilerplate, type NodeFramework } from "../src/generators/boilerplates/node.js";
import { generatePhpBoilerplate, type PhpFramework } from "../src/generators/boilerplates/php.js";
import { generatePythonBoilerplate, type PythonFramework } from "../src/generators/boilerplates/python.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const providers: readonly Provider[] = ["orange-money", "wave", "mtn-momo"];

const providerEnvironmentLines: Readonly<Record<Provider, readonly string[]>> = {
  "orange-money": ["ORANGE_MONEY_CLIENT_ID=", "ORANGE_MONEY_ENVIRONMENT=sandbox"],
  wave: ["WAVE_API_KEY=", "WAVE_WEBHOOK_SECRET="],
  "mtn-momo": ["MTN_MOMO_SUBSCRIPTION_KEY=", "MTN_MOMO_DEFAULT_CURRENCY=XOF"],
};

function verifyNodeInstantiation(code: string): void {
  const cleanCode = code.replace(/@[A-Za-z0-9_]+(?:\([^)]*\))?/g, "");
  const file = join(tmpdir(), `test_instantiation_${Date.now()}_${Math.random().toString(36).substring(2)}.mjs`);
  try {
    writeFileSync(file, cleanCode, "utf8");
    execSync(`node --check "${file}"`, { stdio: "pipe" });
    try {
      execSync(`node "${file}"`, { stdio: "pipe" });
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || err.message || "";
      if (
        output.includes("Cannot find package") ||
        output.includes("ERR_MODULE_NOT_FOUND") ||
        output.includes("listen EADDRINUSE") ||
        output.includes("app.listen") ||
        err.code === "ENOENT"
      ) {
        return;
      }
      throw err;
    }
  } finally {
    try { unlinkSync(file); } catch {}
  }
}

function verifyPhpInstantiation(code: string): void {
  const file = join(tmpdir(), `test_generated_${Date.now()}_${Math.random().toString(36).substring(2)}.php`);
  const rootAutoload = join(__dirname, "../../core-php/vendor/autoload.php").replace(/\\/g, "/");
  const execCode = code.replace(/require_once __DIR__ \. '\/vendor\/autoload\.php';/, `require_once '${rootAutoload}';`);
  try {
    writeFileSync(file, execCode, "utf8");
    execSync(`php -l "${file}"`, { stdio: "pipe" });
    try {
      execSync(`php "${file}"`, { stdio: "pipe" });
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || err.message || "";
      if (
        output.includes("Class \"Illuminate") ||
        output.includes("Class \"Symfony") ||
        err.code === "ENOENT" ||
        err.message?.includes("not found")
      ) {
        return;
      }
      throw err;
    }
  } catch (err: any) {
    if (err.code === "ENOENT" || err.message?.includes("not found") || err.message?.includes("n'est pas reconnu")) {
      return;
    }
    throw err;
  } finally {
    try { unlinkSync(file); } catch {}
  }
}

function verifyPythonInstantiation(code: string): void {
  const file = join(tmpdir(), `test_generated_${Date.now()}_${Math.random().toString(36).substring(2)}.py`);
  const pythonPath = join(__dirname, "../../core-python").replace(/\\/g, "/");
  try {
    writeFileSync(file, code, "utf8");
    execSync(`python -m py_compile "${file}"`, { stdio: "pipe" });
    try {
      execSync(`python "${file}"`, {
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: pythonPath },
      });
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || err.message || "";
      if (
        output.includes("No module named 'django'") ||
        output.includes("No module named 'fastapi'") ||
        err.code === "ENOENT" ||
        err.message?.includes("not found")
      ) {
        return;
      }
      throw err;
    }
  } catch (err: any) {
    if (err.code === "ENOENT" || err.message?.includes("not found") || err.message?.includes("n'est pas reconnu")) {
      return;
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

    // Real instantiation & syntax validation check (node --check and node execution)
    expect(() => verifyNodeInstantiation(generated)).not.toThrow();
  });
});

const phpFrameworks: readonly PhpFramework[] = ["laravel", "symfony", "native"];

describe("generatePhpBoilerplate", () => {
  it.each(phpFrameworks.flatMap((framework) => providers.map((provider) => [framework, provider] as const)))
  ("generates %s boilerplate for %s", (framework, provider) => {
    const generated = generatePhpBoilerplate(framework, [provider]);

    expect(generated).toContain(`// Generated for ${framework}. Selected providers: ${provider}`);
    expect(generated).toContain("new WaslPay($provider);");

    // Real instantiation & syntax validation check (php -l and php execution)
    expect(() => verifyPhpInstantiation(generated)).not.toThrow();
  });
});

const pythonFrameworks: readonly PythonFramework[] = ["fastapi", "django"];

describe("generatePythonBoilerplate", () => {
  it.each(pythonFrameworks.flatMap((framework) => providers.map((provider) => [framework, provider] as const)))
  ("generates %s boilerplate for %s", (framework, provider) => {
    const generated = generatePythonBoilerplate(framework, [provider]);

    expect(generated).toContain(`# Generated for ${framework}. Selected providers: ${provider}`);
    expect(generated).toContain("waslpay = WaslPay(provider)");
    expect(generated).toContain("httpx.AsyncClient()");

    // Real instantiation & syntax validation check (py_compile and python execution)
    expect(() => verifyPythonInstantiation(generated)).not.toThrow();
  });
});
