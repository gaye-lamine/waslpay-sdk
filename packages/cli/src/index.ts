import { Command } from "commander";

import { devCommand, parsePort } from "./commands/dev.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand, type InitCommandOptions } from "./commands/init.js";
import { triggerCommand } from "./commands/trigger.js";

const program = new Command();

program
  .name("waslpay")
  .description("Generate a WaslPay payment integration starter")
  .version("1.0.3");

program
  .command("init")
  .description("Interactively generate WaslPay configuration and integration code")
  .option("--language <language>", "Backend language: node, php, or python")
  .option("--framework <framework>", "Framework compatible with the selected language")
  .option("--providers <providers>", "Comma-separated providers: orange-money, wave, mtn-momo")
  .option("--mock", "Generate local mock credentials and provider base URLs")
  .action((options: InitCommandOptions) => initCommand(options));

program
  .command("dev")
  .description("Start the local WaslPay checkout and webhook simulator")
  .option("-p, --port <number>", "Port for the local simulator", parsePort, 4004)
  .option("-t, --target <url>", "Webhook receiver URL", "http://localhost:8000/api/webhooks/waslpay")
  .option("--provider <provider>", "Provider to simulate: wave, orange, or mtn (affects webhook payload and auth header)", "wave")
  .action(devCommand);

program
  .command("doctor")
  .description("Check local WaslPay environment configuration")
  .action(doctorCommand);

program
  .command("trigger <event>")
  .description("Send a provider-realistic test webhook event (<provider>.payment.<success|failed>, e.g. wave.payment.success, orange.payment.success, mtn.payment.failed)")
  .option("-t, --target <url>", "Webhook receiver URL", "http://localhost:8000/api/webhooks/waslpay")
  .option("-s, --secret <secret>", "Secret for webhook auth: HMAC key for Wave, raw API key for Orange, subscription key for MTN (defaults to provider mock secret)")
  .action(triggerCommand);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
