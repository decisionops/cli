import { loadPlatforms } from "../core/platforms.js";
import { buildPlatforms } from "../core/installer.js";
import { findPlatformsDir, findSkillSourceDir } from "../core/resources.js";

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
    sourceDir: flags.sourceDir ?? findSkillSourceDir(),
    skillName: flags.skillName,
    serverName: flags.serverName,
    serverUrl: flags.serverUrl,
  });
  for (const result of results) {
    console.log(`Built ${result.platformId} -> ${result.outputPath}`);
  }
}
