import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const encryptSecrets = require("../scripts/secret-vault.cjs")
  .encryptSecrets as (
  secrets: Record<string, string>,
  password: string,
) => Record<string, unknown>;

const originalNodeEnv = process.env.NODE_ENV;

describe("secretVault password file cleanup", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-secret-vault-"));
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps the configured password file when config app.env is dev", async () => {
    process.env.NODE_ENV = "production";
    const password = "local-dev-password";
    const vaultPath = path.join(tempDir, "secrets.enc.json");
    const passwordPath = path.join(tempDir, ".secrets-password");
    fs.writeFileSync(
      vaultPath,
      `${JSON.stringify(encryptSecrets({ TEST_SECRET: "available" }, password), null, 2)}\n`,
    );
    fs.writeFileSync(passwordPath, `${password}\n`);

    vi.doMock("../src/config/runtime", () => ({
      getConfig: (key: string) => {
        if (key === "app.env") return "dev";
        if (key === "secrets.file") return vaultPath;
        if (key === "secrets.passwordFile") return passwordPath;
        return undefined;
      },
    }));

    const { getRuntimeSecret, initializeRuntimeSecrets } = await import(
      "../src/security/secretVault"
    );
    initializeRuntimeSecrets();

    expect(getRuntimeSecret("TEST_SECRET")).toBe("available");
    expect(fs.existsSync(passwordPath)).toBe(true);
  });
});
