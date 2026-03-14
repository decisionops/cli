import { onExit } from "signal-exit";

export function installTerminalSafetyNet(): void {
  onExit(() => {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1B[?25h");
    }
    if (process.stdin.isTTY && process.stdin.isRaw) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore — stdin may already be closed */
      }
    }
  });
}
