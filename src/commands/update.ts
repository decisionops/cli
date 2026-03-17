import os from "node:os";
import { spawn } from "node:child_process";

import { POWERSHELL_INSTALLER_URL, SHELL_INSTALLER_URL } from "../installers/templates.js";

export type UpdateFlags = {
  version?: string;
  installDir?: string;
};

export type UpdateInvocation = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export function buildUpdateInvocation(flags: UpdateFlags = {}, platform = os.platform()): UpdateInvocation {
  const env = {
    ...process.env,
    ...(flags.version ? { DOPS_VERSION: flags.version } : {}),
    ...(flags.installDir ? { DOPS_INSTALL_DIR: flags.installDir } : {}),
  };

  if (platform === "win32") {
    return {
      command: "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm ${POWERSHELL_INSTALLER_URL} | iex`],
      env,
    };
  }

  return {
    command: "sh",
    args: ["-c", `curl -fsSL ${SHELL_INSTALLER_URL} | sh`],
    env,
  };
}

function runInvocation(invocation: UpdateInvocation): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env: invocation.env,
      stdio: "inherit",
    });

    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Update failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

export async function runUpdate(flags: UpdateFlags): Promise<void> {
  const targetVersion = flags.version ?? "latest";
  console.log(`Updating dops to ${targetVersion}...`);
  await runInvocation(buildUpdateInvocation(flags));
}
