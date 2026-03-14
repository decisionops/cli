import path from "node:path";
import { loadPlatforms } from "../core/platforms.js";
import { buildPlatforms } from "../core/installer.js";
import { DEFAULT_SKILL_NAME, DEFAULT_MCP_SERVER_NAME, DEFAULT_MCP_SERVER_URL } from "../core/config.js";

function findPlatformsDir(): string {
  const candidates = [
    path.join(import.meta.dir, "..", "..", "node_modules", "@decisionops", "skill", "platforms"),
    path.join(import.meta.dir, "..", "..", "..", "skill", "platforms"),
  ];
  for (const dir of candidates) {
    try {
      const platforms = loadPlatforms(dir);
      if (Object.keys(platforms).length > 0) return dir;
    } catch {}
  }
  throw new Error("Could not find platform definitions. Ensure @decisionops/skill is installed or is adjacent.");
}

export async function runPlatformList(): Promise<void> {
  const dir = findPlatformsDir();
  const platforms = loadPlatforms(dir);
  for (const p of Object.values(platforms)) {
    const skill = p.skill?.supported ? "skill" : "";
    const mcp = p.mcp?.supported ? "mcp" : "";
    const caps = [skill, mcp].filter(Boolean).join(", ");
    console.log(`${p.id.padEnd(16)} ${p.display_name.padEnd(16)} [${caps}]`);
  }
}

export async function runPlatformBuild(flags: {
  platform?: string[];
  outputDir?: string;
  sourceDir?: string;
  skillName?: string;
  serverName?: string;
  serverUrl?: string;
}): Promise<void> {
  const platformsDir = findPlatformsDir();
  const results = buildPlatforms({
    platformsDir,
    selectedPlatforms: flags.platform,
    outputDir: flags.outputDir ?? "build",
    sourceDir: flags.sourceDir,
    skillName: flags.skillName,
    serverName: flags.serverName,
    serverUrl: flags.serverUrl,
  });
  for (const result of results) {
    console.log(`Built ${result.platformId} -> ${result.outputPath}`);
  }
}
