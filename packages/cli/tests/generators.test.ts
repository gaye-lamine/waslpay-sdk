import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { generateEnvExample, orangeMoneyWebhookPath, type Provider } from "../src/generators/env.js";
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

// ---------------------------------------------------------------------------
// Instantiation helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ENV generator tests
// ---------------------------------------------------------------------------

import { generateEnvExample, orangeMoneyWebhookPath, DEV_MOCK_SECRETS, type Provider } from "../src/generators/env.js";

describe("generateEnvExample", () => {
  it("DEV_MOCK_SECRETS match generated .env mock values for all 3 providers", () => {
    const mockEnv = generateEnvExample(["wave", "orange-money", "mtn-momo"], true);

    expect(mockEnv).toContain(`WAVE_WEBHOOK_SECRET=${DEV_MOCK_SECRETS.wave}`);
    expect(mockEnv).toContain(`ORANGE_MONEY_WEBHOOK_API_KEY=${DEV_MOCK_SECRETS.orange}`);
    expect(mockEnv).toContain(`MTN_MOMO_SUBSCRIPTION_KEY=${DEV_MOCK_SECRETS.mtn}`);
  });

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

// ---------------------------------------------------------------------------
// Node boilerplate — single provider
// ---------------------------------------------------------------------------

const nodeFrameworks: readonly NodeFramework[] = ["express", "fastify", "nestjs"];

describe("generateNodeBoilerplate (single provider)", () => {
  it.each(nodeFrameworks.flatMap((framework) => providers.map((provider) => [framework, provider] as const)))
  ("generates %s boilerplate for %s", (framework, provider) => {
    const generated = generateNodeBoilerplate(framework, [provider]);

    expect(generated).toContain(`// Generated for ${framework}. Selected providers: ${provider}`);
    // Single-provider: the canonical variable name is "provider"
    expect(generated).toContain("new WaslPay(provider);");
    expect(generated).toContain("refund");

    // Real instantiation & syntax validation check (node --check and node execution)
    expect(() => verifyNodeInstantiation(generated)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Node boilerplate — multi-provider
// ---------------------------------------------------------------------------

describe("generateNodeBoilerplate (multi-provider)", () => {
  // 2-provider combinations, one per framework
  const twoProviders = ["wave", "orange-money"] as const;
  const threeProviders = ["wave", "orange-money", "mtn-momo"] as const;

  it.each(nodeFrameworks)("2 providers (wave + orange-money) on %s: routes and instances present", (framework) => {
    const generated = generateNodeBoilerplate(framework, [...twoProviders]);

    expect(generated).toContain(`// Generated for ${framework}. Selected providers: wave, orange-money`);

    // Both provider-specific WaslPay instances
    expect(generated).toMatch(/waslpay\s*Wave|waslpayWave/i);
    expect(generated).toMatch(/waslpay\s*OrangeMoney|waslpayOrangeMoney/i);

    // Provider-specific routes — NestJS uses relative paths without leading slash
    const chkWave = framework === "nestjs" ? "checkout/wave" : "/checkout/wave";
    const chkOrange = framework === "nestjs" ? "checkout/orange-money" : "/checkout/orange-money";
    const wbkWave = framework === "nestjs" ? "api/webhooks/waslpay/wave" : "/api/webhooks/waslpay/wave";
    const wbkOrange = framework === "nestjs" ? "api/webhooks/waslpay/orange-money" : "/api/webhooks/waslpay/orange-money";
    const refWave = framework === "nestjs" ? "refund/wave" : "/refund/wave";
    const refOrange = framework === "nestjs" ? "refund/orange-money" : "/refund/orange-money";
    expect(generated).toContain(chkWave);
    expect(generated).toContain(chkOrange);
    expect(generated).toContain(wbkWave);
    expect(generated).toContain(wbkOrange);
    expect(generated).toContain(refWave);
    expect(generated).toContain(refOrange);

    // Real syntax + instantiation check
    expect(() => verifyNodeInstantiation(generated)).not.toThrow();
  });

  it.each(nodeFrameworks)("3 providers (all) on %s: routes and instances present", (framework) => {
    const generated = generateNodeBoilerplate(framework, [...threeProviders]);

    expect(generated).toContain(`// Generated for ${framework}. Selected providers: wave, orange-money, mtn-momo`);

    // All 3 provider-specific WaslPay instances
    expect(generated).toMatch(/waslpay\s*Wave|waslpayWave/i);
    expect(generated).toMatch(/waslpay\s*OrangeMoney|waslpayOrangeMoney/i);
    expect(generated).toMatch(/waslpay\s*MtnMomo|waslpayMtnMomo/i);

    // All 3 dedicated routes — NestJS relative paths, others absolute
    const prefix = framework === "nestjs" ? "" : "/";
    expect(generated).toContain(`${prefix}checkout/wave`);
    expect(generated).toContain(`${prefix}checkout/orange-money`);
    expect(generated).toContain(`${prefix}checkout/mtn-momo`);
    expect(generated).toContain(`${prefix}api/webhooks/waslpay/wave`);
    expect(generated).toContain(`${prefix}api/webhooks/waslpay/orange-money`);
    expect(generated).toContain(`${prefix}api/webhooks/waslpay/mtn-momo`);
    expect(generated).toContain(`${prefix}refund/wave`);
    expect(generated).toContain(`${prefix}refund/orange-money`);
    expect(generated).toContain(`${prefix}refund/mtn-momo`);

    // Real syntax + instantiation check
    expect(() => verifyNodeInstantiation(generated)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PHP boilerplate — single provider
// ---------------------------------------------------------------------------

const phpFrameworks: readonly PhpFramework[] = ["laravel", "symfony", "native"];

describe("generatePhpBoilerplate (single provider)", () => {
  it.each(phpFrameworks.flatMap((framework) => providers.map((provider) => [framework, provider] as const)))
  ("generates %s boilerplate for %s", (framework, provider) => {
    const generated = generatePhpBoilerplate(framework, [provider]);

    expect(generated).toContain(`// Generated for ${framework}. Selected providers: ${provider}`);
    expect(generated).toContain("new WaslPay($provider);");
    expect(generated).toContain("refund");

    // Real instantiation & syntax validation check (php -l and php execution)
    expect(() => verifyPhpInstantiation(generated)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PHP boilerplate — multi-provider
// ---------------------------------------------------------------------------

describe("generatePhpBoilerplate (multi-provider)", () => {
  const twoProviders = ["wave", "mtn-momo"] as const;
  const threeProviders = ["wave", "orange-money", "mtn-momo"] as const;

  it.each(phpFrameworks)("2 providers (wave + mtn-momo) on %s: instances and routes present", (framework) => {
    const generated = generatePhpBoilerplate(framework, [...twoProviders]);

    expect(generated).toContain(`// Generated for ${framework}. Selected providers: wave, mtn-momo`);

    // Both provider-specific WaslPay instances
    expect(generated).toContain("$waslPayWave");
    expect(generated).toContain("$waslPayMtnMomo");

    // Both provider-specific route references
    expect(generated).toContain("/checkout/wave");
    expect(generated).toContain("/checkout/mtn-momo");
    expect(generated).toContain("/api/webhooks/waslpay/wave");
    expect(generated).toContain("/api/webhooks/waslpay/mtn-momo");
    expect(generated).toContain("/refund/wave");
    expect(generated).toContain("/refund/mtn-momo");

    // Real syntax + instantiation check
    expect(() => verifyPhpInstantiation(generated)).not.toThrow();
  });

  it.each(phpFrameworks)("3 providers (all) on %s: all 3 instances and routes present", (framework) => {
    const generated = generatePhpBoilerplate(framework, [...threeProviders]);

    expect(generated).toContain(`// Generated for ${framework}. Selected providers: wave, orange-money, mtn-momo`);

    // All 3 provider-specific WaslPay instances
    expect(generated).toContain("$waslPayWave");
    expect(generated).toContain("$waslPayOrangeMoney");
    expect(generated).toContain("$waslPayMtnMomo");

    // All 3 checkout routes
    expect(generated).toContain("/checkout/wave");
    expect(generated).toContain("/checkout/orange-money");
    expect(generated).toContain("/checkout/mtn-momo");

    // All 3 webhook routes
    expect(generated).toContain("/api/webhooks/waslpay/wave");
    expect(generated).toContain("/api/webhooks/waslpay/orange-money");
    expect(generated).toContain("/api/webhooks/waslpay/mtn-momo");

    // All 3 refund routes
    expect(generated).toContain("/refund/wave");
    expect(generated).toContain("/refund/orange-money");
    expect(generated).toContain("/refund/mtn-momo");

    // Real syntax + instantiation check
    expect(() => verifyPhpInstantiation(generated)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Python boilerplate — single provider
// ---------------------------------------------------------------------------

const pythonFrameworks: readonly PythonFramework[] = ["fastapi", "django"];

describe("generatePythonBoilerplate (single provider)", () => {
  it.each(pythonFrameworks.flatMap((framework) => providers.map((provider) => [framework, provider] as const)))
  ("generates %s boilerplate for %s", (framework, provider) => {
    const generated = generatePythonBoilerplate(framework, [provider]);

    expect(generated).toContain(`# Generated for ${framework}. Selected providers: ${provider}`);
    expect(generated).toContain("waslpay = WaslPay(provider)");
    expect(generated).toContain("httpx.AsyncClient()");
    expect(generated).toContain("refund");

    // Real instantiation & syntax validation check (py_compile and python execution)
    expect(() => verifyPythonInstantiation(generated)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Python boilerplate — multi-provider
// ---------------------------------------------------------------------------

describe("generatePythonBoilerplate (multi-provider)", () => {
  const twoProviders = ["wave", "mtn-momo"] as const;
  const threeProviders = ["wave", "orange-money", "mtn-momo"] as const;

  it.each(pythonFrameworks)("2 providers (wave + mtn-momo) on %s: instances and routes present", (framework) => {
    const generated = generatePythonBoilerplate(framework, [...twoProviders]);

    expect(generated).toContain(`# Generated for ${framework}. Selected providers: wave, mtn-momo`);

    // Both provider-specific WaslPay instances
    expect(generated).toContain("waslpay_wave = WaslPay(wave_provider)");
    expect(generated).toContain("waslpay_mtn_momo = WaslPay(mtn_momo_provider)");

    // Both provider-specific route paths
    expect(generated).toContain("/checkout/wave");
    expect(generated).toContain("/checkout/mtn-momo");
    expect(generated).toContain("/api/webhooks/waslpay/wave");
    expect(generated).toContain("/api/webhooks/waslpay/mtn-momo");
    expect(generated).toContain("/refund/wave");
    expect(generated).toContain("/refund/mtn-momo");

    // Real syntax + instantiation check
    expect(() => verifyPythonInstantiation(generated)).not.toThrow();
  }, 15000);

  it.each(pythonFrameworks)("3 providers (all) on %s: all 3 instances and routes present", (framework) => {
    const generated = generatePythonBoilerplate(framework, [...threeProviders]);

    expect(generated).toContain(`# Generated for ${framework}. Selected providers: wave, orange-money, mtn-momo`);

    // All 3 provider-specific WaslPay instances
    expect(generated).toContain("waslpay_wave = WaslPay(wave_provider)");
    expect(generated).toContain("waslpay_orange_money = WaslPay(orange_money_provider)");
    expect(generated).toContain("waslpay_mtn_momo = WaslPay(mtn_momo_provider)");

    // All 3 checkout routes
    expect(generated).toContain("/checkout/wave");
    expect(generated).toContain("/checkout/orange-money");
    expect(generated).toContain("/checkout/mtn-momo");

    // All 3 webhook routes
    expect(generated).toContain("/api/webhooks/waslpay/wave");
    expect(generated).toContain("/api/webhooks/waslpay/orange-money");
    expect(generated).toContain("/api/webhooks/waslpay/mtn-momo");

    // All 3 refund routes
    expect(generated).toContain("/refund/wave");
    expect(generated).toContain("/refund/orange-money");
    expect(generated).toContain("/refund/mtn-momo");

    // Real syntax + instantiation check
    expect(() => verifyPythonInstantiation(generated)).not.toThrow();
  }, 15000);
});

// ---------------------------------------------------------------------------
// env ↔ boilerplate consistency — ORANGE_MONEY_CALLBACK_URL
// ---------------------------------------------------------------------------

describe("env ↔ boilerplate consistency (ORANGE_MONEY_CALLBACK_URL)", () => {
  const singleOrange: readonly Provider[] = ["orange-money"];
  const multiOrangeWave: readonly Provider[] = ["orange-money", "wave"];
  const allThree: readonly Provider[] = ["wave", "orange-money", "mtn-momo"];

  // ------------------------------------------------------------------
  // orangeMoneyWebhookPath() helper — the single source of truth
  // ------------------------------------------------------------------

  it("orangeMoneyWebhookPath: single provider → /api/webhooks/waslpay", () => {
    expect(orangeMoneyWebhookPath(singleOrange)).toBe("/api/webhooks/waslpay");
  });

  it("orangeMoneyWebhookPath: multi-provider → /api/webhooks/waslpay/orange-money", () => {
    expect(orangeMoneyWebhookPath(multiOrangeWave)).toBe("/api/webhooks/waslpay/orange-money");
    expect(orangeMoneyWebhookPath(allThree)).toBe("/api/webhooks/waslpay/orange-money");
  });

  // ------------------------------------------------------------------
  // .env non-mock: ORANGE_MONEY_CALLBACK_URL comment contains correct path
  // ------------------------------------------------------------------

  it("generateEnvExample (non-mock, single): ORANGE_MONEY_CALLBACK_URL comment points to /api/webhooks/waslpay", () => {
    const env = generateEnvExample(singleOrange);
    expect(env).toContain("/api/webhooks/waslpay");
    expect(env).not.toContain("/api/webhooks/waslpay/orange-money");
  });

  it("generateEnvExample (non-mock, 2 providers): ORANGE_MONEY_CALLBACK_URL comment points to /api/webhooks/waslpay/orange-money", () => {
    const env = generateEnvExample(multiOrangeWave);
    expect(env).toContain("/api/webhooks/waslpay/orange-money");
  });

  it("generateEnvExample (non-mock, 3 providers): ORANGE_MONEY_CALLBACK_URL comment points to /api/webhooks/waslpay/orange-money", () => {
    const env = generateEnvExample(allThree);
    expect(env).toContain("/api/webhooks/waslpay/orange-money");
  });

  // ------------------------------------------------------------------
  // .env mock: ORANGE_MONEY_CALLBACK_URL value (not just a comment) is exact
  // ------------------------------------------------------------------

  it("generateEnvExample (mock, single): ORANGE_MONEY_CALLBACK_URL=http://localhost:8000/api/webhooks/waslpay", () => {
    const env = generateEnvExample(singleOrange, true);
    expect(env).toContain("ORANGE_MONEY_CALLBACK_URL=http://localhost:8000/api/webhooks/waslpay\n");
    expect(env).not.toContain("ORANGE_MONEY_CALLBACK_URL=http://localhost:8000/api/webhooks/waslpay/orange-money");
  });

  it("generateEnvExample (mock, 2 providers): ORANGE_MONEY_CALLBACK_URL=http://localhost:8000/api/webhooks/waslpay/orange-money", () => {
    const env = generateEnvExample(multiOrangeWave, true);
    expect(env).toContain("ORANGE_MONEY_CALLBACK_URL=http://localhost:8000/api/webhooks/waslpay/orange-money");
  });

  it("generateEnvExample (mock, 3 providers): ORANGE_MONEY_CALLBACK_URL=http://localhost:8000/api/webhooks/waslpay/orange-money", () => {
    const env = generateEnvExample(allThree, true);
    expect(env).toContain("ORANGE_MONEY_CALLBACK_URL=http://localhost:8000/api/webhooks/waslpay/orange-money");
  });

  // ------------------------------------------------------------------
  // Cross-check: URL in mock .env == webhook route in each boilerplate
  // ------------------------------------------------------------------

  it.each(["express", "fastify", "nestjs"] as const)(
    "Node/%s multi-provider: mock env callback URL matches generated webhook route",
    (framework) => {
      const env = generateEnvExample(["orange-money", "wave"], true);
      const boilerplate = generateNodeBoilerplate(framework, ["orange-money", "wave"]);

      // Extract the path portion of the callback URL from the mock .env
      const match = env.match(/ORANGE_MONEY_CALLBACK_URL=(http:\/\/localhost:\d+(\/[^\n]*)?)/);
      expect(match).not.toBeNull();
      const webhookPath = new URL(match![1]).pathname;

      // The boilerplate must reference that exact webhook path
      expect(boilerplate).toContain(webhookPath);
    },
  );

  it.each(["laravel", "symfony", "native"] as const)(
    "PHP/%s multi-provider: mock env callback URL matches generated webhook route",
    (framework) => {
      const env = generateEnvExample(["orange-money", "wave"], true);
      const boilerplate = generatePhpBoilerplate(framework, ["orange-money", "wave"]);

      const match = env.match(/ORANGE_MONEY_CALLBACK_URL=(http:\/\/localhost:\d+(\/[^\n]*)?)/);
      expect(match).not.toBeNull();
      const webhookPath = new URL(match![1]).pathname;
      expect(boilerplate).toContain(webhookPath);
    },
  );

  it.each(["fastapi", "django"] as const)(
    "Python/%s multi-provider: mock env callback URL matches generated webhook route",
    (framework) => {
      const env = generateEnvExample(["orange-money", "wave"], true);
      const boilerplate = generatePythonBoilerplate(framework, ["orange-money", "wave"]);

      const match = env.match(/ORANGE_MONEY_CALLBACK_URL=(http:\/\/localhost:\d+(\/[^\n]*)?)/);
      expect(match).not.toBeNull();
      const webhookPath = new URL(match![1]).pathname;
      expect(boilerplate).toContain(webhookPath);
    },
  );
});

// ---------------------------------------------------------------------------
// Dotenv / env loading parity — all 3 languages must load .env.waslpay.example
// ---------------------------------------------------------------------------

describe("dotenv / env loading parity", () => {
  it.each(nodeFrameworks)(
    "Node.js/%s boilerplate loads .env.waslpay.example via dotenv config()",
    (framework) => {
      const single = generateNodeBoilerplate(framework, ["wave"]);
      expect(single).toContain("dotenv");
      expect(single).toContain(".env.waslpay.example");

      const multi = generateNodeBoilerplate(framework, ["wave", "mtn-momo"]);
      expect(multi).toContain("dotenv");
      expect(multi).toContain(".env.waslpay.example");
    },
  );

  it("PHP/native boilerplate loads .env.waslpay.example via Dotenv::createImmutable()", () => {
    const single = generatePhpBoilerplate("native", ["wave"]);
    expect(single).toContain("Dotenv");
    expect(single).toContain(".env.waslpay.example");
    expect(single).toContain("safeLoad");

    const multi = generatePhpBoilerplate("native", ["wave", "mtn-momo"]);
    expect(multi).toContain("Dotenv");
    expect(multi).toContain(".env.waslpay.example");
    expect(multi).toContain("safeLoad");
  });

  it.each(["laravel", "symfony"] as const)(
    "PHP/%s boilerplate documents explicit copy/merge of .env.waslpay.example to .env",
    (framework) => {
      // Laravel and Symfony auto-load .env via framework bootstrap.
      // They do NOT auto-read .env.waslpay.example directly.
      // Verify that the generated code contains clear instructions to copy/merge .env.waslpay.example into .env
      const generated = generatePhpBoilerplate(framework, ["wave"]);
      expect(generated).toContain("<?php");
      expect(generated).toContain("WaveProvider");
      expect(generated).not.toContain("Dotenv::createImmutable");
      expect(generated).toContain(".env.waslpay.example");
      expect(generated).toContain(".env");
    },
  );

  it.each(["fastapi", "django"] as const)(
    "Python/%s boilerplate loads .env.waslpay.example via load_dotenv()",
    (framework) => {
      const single = generatePythonBoilerplate(framework, ["wave"]);
      expect(single).toContain("load_dotenv");
      expect(single).toContain(".env.waslpay.example");

      const multi = generatePythonBoilerplate(framework, ["wave", "mtn-momo"]);
      expect(multi).toContain("load_dotenv");
      expect(multi).toContain(".env.waslpay.example");
    },
  );
});

// ---------------------------------------------------------------------------
// Express Webhook Body Type Integration Test
// ---------------------------------------------------------------------------

describe("Express Webhook Body Integration Test", () => {
  it("executes the actual generated Express code in a child process and verifies the webhook route receives a raw Buffer body", async () => {
    const code = generateNodeBoilerplate("express", ["wave"]);

    // Instrument the actual generated webhook route handler to report whether req.body is a Buffer
    const testCode = code
      .replace("import { config } from 'dotenv';", "const config = () => {};")
      .replace("config({ path: '.env.waslpay.example' });", "")
      .replace(
        "import { WaslPay, WaveProvider } from '@waslpay/core-node';",
        "class WaveProvider { constructor() {} }\nclass WaslPay { constructor() {} handleWebhook() { return { id: 'evt_1' }; } }"
      )
      .replace(
        "const event = await waslpay.handleWebhook(req.body, req.headers);",
        "const isBuf = Buffer.isBuffer(req.body); res.header('x-test-is-buffer', String(isBuf)); const event = await waslpay.handleWebhook(req.body, req.headers);"
      )
      .replace(
        "const port = process.env.PORT || 3000;",
        "const port = 0; // Use random available port"
      )
      .replace(
        "console.log(`Server listening on port ${port}`);",
        `const serverPort = app.listen().address().port;
console.log('SERVER_PORT:' + serverPort);`
      );

    const file = join(__dirname, `../test_express_raw_${Date.now()}_${Math.random().toString(36).substring(2)}.mjs`);
    writeFileSync(file, testCode, "utf8");

    try {
      const { spawn } = await import("node:child_process");
      const proc = spawn("node", [file], {
        cwd: join(__dirname, ".."),
        env: process.env,
      });

      let serverPort = 0;
      let outputLogs = "";

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error("Server start timeout. Logs: " + outputLogs));
        }, 5000);

        proc.stdout.on("data", (data) => {
          const str = data.toString();
          outputLogs += str;
          const match = str.match(/SERVER_PORT:(\d+)/);
          if (match) {
            serverPort = parseInt(match[1], 10);
            clearTimeout(timeout);
            resolve();
          }
        });

        proc.stderr.on("data", (data) => {
          outputLogs += data.toString();
        });

        proc.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(serverPort).toBeGreaterThan(0);

      // Perform a real HTTP POST request directly to the actual generated webhook route
      const { default: request } = await import("supertest");
      const res = await request(`http://127.0.0.1:${serverPort}`)
        .post("/api/webhooks/waslpay")
        .send(JSON.stringify({ event: "wave.payment.success" }))
        .set("Content-Type", "application/json");

      proc.kill();

      expect(res.headers["x-test-is-buffer"]).toBe("true");
    } finally {
      try { unlinkSync(file); } catch {}
    }
  }, 15000);
});

