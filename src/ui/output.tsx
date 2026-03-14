import React from "react";
import { Box, render, Text } from "ink";

import type { InstallResult, CleanupResult } from "../core/installer.js";
import type { AuthState } from "../core/auth.js";
import { ErrorBoundary } from "./error-boundary.js";

function SectionTitle(props: { children: React.ReactNode }) {
  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color="cyanBright" bold>{props.children}</Text>
    </Box>
  );
}

function StatusLine(props: { icon: string; color: string; children: React.ReactNode }) {
  return (
    <Box>
      <Text color={props.color}>{props.icon}</Text>
      <Text> {props.children}</Text>
    </Box>
  );
}

function InstallSummary(props: { result: InstallResult }) {
  const { result } = props;
  const hasChanges = result.installedSkills.length > 0 || result.installedMcp.length > 0;
  return (
    <Box flexDirection="column" marginY={1}>
      <SectionTitle>Install summary</SectionTitle>
      {result.manifestPath ? (
        <StatusLine icon="✓" color="green">
          <Text>Manifest{result.placeholdersUsed ? " (placeholder)" : ""}: {result.manifestPath}</Text>
        </StatusLine>
      ) : null}
      {result.installedSkills.map((entry) => (
        <StatusLine key={`skill-${entry.platformId}`} icon="✓" color="green">
          <Text>Skill installed: {entry.target} ({entry.platformId})</Text>
        </StatusLine>
      ))}
      {result.installedMcp.map((entry) => (
        <StatusLine key={`mcp-${entry.platformId}`} icon="✓" color="green">
          <Text>MCP config written: {entry.target} ({entry.platformId})</Text>
        </StatusLine>
      ))}
      {result.skippedMcp.map((entry) => (
        <StatusLine key={`skip-${entry.platformId}`} icon="⊘" color="yellow">
          <Text>MCP config skipped: {entry.platformId} — {entry.reason}</Text>
        </StatusLine>
      ))}
      {hasChanges ? (
        <Box flexDirection="column" marginTop={1}>
          <SectionTitle>Next steps</SectionTitle>
          <Text color="gray">The CLI wrote config files to disk, but your IDE needs to pick them up.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>1. Open (or restart) your IDE in the target repository.</Text>
            <Text>2. Invoke any DecisionOps MCP tool once to trigger the auth handoff.</Text>
            <Text>3. Complete the sign-in flow prompted by the MCP server.</Text>
            <Text>4. Retry the same tool call — you're live.</Text>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function CleanupSummary(props: { result: CleanupResult }) {
  const { result } = props;
  return (
    <Box flexDirection="column" marginY={1}>
      <SectionTitle>Cleanup summary</SectionTitle>
      {result.removedSkills.map((entry) => (
        <StatusLine key={`skill-${entry.platformId}`} icon="✗" color="red">
          <Text>Skill removed: {entry.target} ({entry.platformId})</Text>
        </StatusLine>
      ))}
      {result.skippedSkills.map((entry) => (
        <StatusLine key={`skip-skill-${entry.platformId}`} icon="⊘" color="gray">
          <Text>Skill skipped: {entry.platformId} — {entry.reason}</Text>
        </StatusLine>
      ))}
      {result.removedMcp.map((entry) => (
        <StatusLine key={`mcp-${entry.platformId}`} icon="✗" color="red">
          <Text>MCP config removed: {entry.target} ({entry.platformId})</Text>
        </StatusLine>
      ))}
      {result.skippedMcp.map((entry) => (
        <StatusLine key={`skip-mcp-${entry.platformId}`} icon="⊘" color="gray">
          <Text>MCP config skipped: {entry.platformId} — {entry.reason}</Text>
        </StatusLine>
      ))}
      {result.removedManifestPath ? (
        <StatusLine icon="✗" color="red">
          <Text>Manifest removed: {result.removedManifestPath}</Text>
        </StatusLine>
      ) : null}
      {result.removedMcp.length > 0 ? (
        <Box marginTop={1}>
          <Text color="yellow">Restart your IDE to stop using the removed MCP server.</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export type DoctorPlatformStatus = {
  displayName: string;
  skillStatus: string;
  mcpStatus: string;
};

export type DoctorReportProps = {
  auth: AuthState | null;
  authDisplay: string;
  repoPath: string | null;
  manifest: { org_id?: string; project_id?: string; repo_ref?: string } | null;
  platforms: DoctorPlatformStatus[];
  issues: string[];
};

function DoctorReport(props: DoctorReportProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      <SectionTitle>DecisionOps Doctor</SectionTitle>
      {props.auth ? (
        <StatusLine icon="✓" color="green">
          <Text>CLI auth: configured ({props.authDisplay})</Text>
        </StatusLine>
      ) : (
        <Box flexDirection="column">
          <StatusLine icon="✗" color="red">
            <Text>CLI auth: not configured</Text>
          </StatusLine>
          <Text color="gray">  → Run: dops login</Text>
        </Box>
      )}
      {props.repoPath ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Repository: {props.repoPath}</Text>
          {props.manifest ? (
            <Box flexDirection="column">
              <Text color="green">Manifest: present</Text>
              <Text color="gray">  org_id:     {props.manifest.org_id ?? "(missing)"}</Text>
              <Text color="gray">  project_id: {props.manifest.project_id ?? "(missing)"}</Text>
              <Text color="gray">  repo_ref:   {props.manifest.repo_ref ?? "(missing)"}</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color="red">Manifest: missing</Text>
              <Text color="gray">  → Run: dops init</Text>
            </Box>
          )}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color="gray">Repository: not detected (run from a git repo or pass --repo-path)</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Platforms:</Text>
        {props.platforms.map((platform) => (
          <Box key={platform.displayName} flexDirection="column">
            <Text>  {platform.displayName}:</Text>
            <Text color="gray">    Skill: {platform.skillStatus}</Text>
            <Text color="gray">    MCP:   {platform.mcpStatus}</Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {props.issues.length === 0 ? (
          <Text color="green">No issues found.</Text>
        ) : (
          <Box flexDirection="column">
            <Text color="yellow">{props.issues.length} issue{props.issues.length === 1 ? "" : "s"} found:</Text>
            {props.issues.map((issue) => (
              <Text key={issue} color="yellow">{"  "}- {issue}</Text>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function AuthStatusReport(props: { auth: AuthState }) {
  const { auth } = props;
  return (
    <Box flexDirection="column" marginY={1}>
      <StatusLine icon="✓" color="green">
        <Text bold>Auth: configured</Text>
      </StatusLine>
      <Text>API base URL: {auth.apiBaseUrl}</Text>
      <Text>Issuer URL: {auth.issuerUrl}</Text>
      <Text>Client ID: {auth.clientId}</Text>
      <Text>Method: {auth.method}</Text>
      <Text>Scopes: {auth.scopes.join(" ")}</Text>
      <Text>Access token: {"*".repeat(Math.min(8, auth.accessToken.length))}…</Text>
      <Text>Expires: {auth.expiresAt ?? "session"}</Text>
      {auth.user?.email || auth.user?.name || auth.user?.id ? (
        <Text>User: {auth.user?.email ?? auth.user?.name ?? auth.user?.id}</Text>
      ) : null}
    </Box>
  );
}

function renderOnce(element: React.ReactElement): void {
  const instance = render(<ErrorBoundary>{element}</ErrorBoundary>);
  instance.unmount();
}

export function renderInstallSummary(result: InstallResult): void {
  renderOnce(<InstallSummary result={result} />);
}

export function renderCleanupSummary(result: CleanupResult): void {
  renderOnce(<CleanupSummary result={result} />);
}

export function renderDoctorReport(props: DoctorReportProps): void {
  renderOnce(<DoctorReport {...props} />);
}

export function renderAuthStatus(auth: AuthState): void {
  renderOnce(<AuthStatusReport auth={auth} />);
}
