import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { renderPowerShellInstaller, renderShellInstaller } from "../installers/templates.js";

const repoRoot = path.resolve(import.meta.dir, "..", "..");

describe("installer templates", () => {
  it("keeps install/install.sh in sync with the hosted shell installer", () => {
    const filePath = path.join(repoRoot, "install", "install.sh");
    expect(fs.readFileSync(filePath, "utf8")).toBe(renderShellInstaller());
  });

  it("keeps install/install.ps1 in sync with the hosted powershell installer", () => {
    const filePath = path.join(repoRoot, "install", "install.ps1");
    expect(fs.readFileSync(filePath, "utf8")).toBe(renderPowerShellInstaller());
  });
});
