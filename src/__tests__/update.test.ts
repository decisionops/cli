import { describe, expect, it } from "bun:test";

import { buildUpdateInvocation } from "../commands/update.js";

describe("buildUpdateInvocation", () => {
  it("uses the shell installer on unix-like platforms", () => {
    const invocation = buildUpdateInvocation({}, "darwin");
    expect(invocation.command).toBe("sh");
    expect(invocation.args).toEqual(["-c", "curl -fsSL https://get.aidecisionops.com/dops | sh"]);
  });

  it("uses powershell on windows", () => {
    const invocation = buildUpdateInvocation({}, "win32");
    expect(invocation.command).toBe("powershell");
    expect(invocation.args).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "irm https://get.aidecisionops.com/dops.ps1 | iex",
    ]);
  });

  it("passes through version and install dir overrides via env", () => {
    const invocation = buildUpdateInvocation({ version: "v0.1.0", installDir: "/tmp/dops-bin" }, "linux");
    expect(invocation.env.DOPS_VERSION).toBe("v0.1.0");
    expect(invocation.env.DOPS_INSTALL_DIR).toBe("/tmp/dops-bin");
  });
});
