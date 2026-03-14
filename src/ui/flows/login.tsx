import React, { useCallback, useEffect, useState } from "react";
import { Box, render, Text, useInput } from "ink";

import type { LoginResult } from "../../core/auth.js";
import { CancelError } from "../cancel.js";
import { ErrorBoundary } from "../error-boundary.js";
import { Spinner } from "../spinner.js";
import { BrandHeader, type PromptChrome, type SelectOption } from "../prompts.js";

type LoginFlowProps = {
  initialMethod?: "web" | "token";
  clientDisplay: string;
  scopesDisplay: string;
  loginWithBrowser: (onAuthorizeUrl: (url: string) => void) => Promise<LoginResult>;
  saveToken: (token: string) => { storagePath: string };
  onDone: (result: { storagePath: string; display: string }) => void;
  onCancel: () => void;
  onError: (err: Error) => void;
};

type FlowStep =
  | { kind: "chooseMethod" }
  | { kind: "pasteToken" }
  | { kind: "waitBrowser" }
  | { kind: "done" };

function useWidth(): number {
  const columns = process.stdout.columns ?? 80;
  return Math.max(40, Math.min(100, columns - 4));
}

function OptionRow(props: { selected: boolean; label: string; description?: string }) {
  return (
    <Box
      borderStyle="round"
      borderColor={props.selected ? "cyan" : "gray"}
      paddingX={1}
      marginBottom={1}
      flexDirection="column"
    >
      <Box>
        <Text color={props.selected ? "cyanBright" : "gray"}>{props.selected ? "●" : "○"}</Text>
        <Text color={props.selected ? "white" : undefined} bold={props.selected}>
          {" "}
          {props.label}
        </Text>
      </Box>
      {props.description ? (
        <Box marginTop={0}>
          <Text color="gray">{props.description}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function MethodStep(props: {
  clientDisplay: string;
  scopesDisplay: string;
  onSelect: (method: "web" | "token") => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const options: Array<{ label: string; value: "web" | "token"; description: string }> = [
    {
      label: "Browser login",
      value: "web",
      description: "Open the DecisionOps sign-in page in your browser and complete OAuth there.",
    },
    {
      label: "Paste token",
      value: "token",
      description: "Fallback for automation or environments without interactive OAuth support.",
    },
  ];

  useInput((_, key) => {
    if (key.escape) { props.onCancel(); return; }
    if (key.upArrow) { setIndex((c) => (c === 0 ? options.length - 1 : c - 1)); return; }
    if (key.downArrow) { setIndex((c) => (c === options.length - 1 ? 0 : c + 1)); return; }
    if (key.return) { props.onSelect(options[index].value); }
  });

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="white" bold>Choose a login method</Text>
      <Box marginTop={1}>
        <Text color="gray">DecisionOps uses OAuth for CLI sessions. Browser login is the primary path.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {options.map((opt, i) => (
          <OptionRow key={opt.value} selected={i === index} label={opt.label} description={opt.description} />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Client: {props.clientDisplay} • Scopes: {props.scopesDisplay}</Text>
      </Box>
    </Box>
  );
}

function TokenStep(props: {
  onSubmit: (token: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.escape) { props.onCancel(); return; }
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed.length === 0) { setError("Token is required."); return; }
      props.onSubmit(trimmed);
      return;
    }
    if (key.leftArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.rightArrow) { setCursor((c) => Math.min(value.length, c + 1)); return; }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor));
        setCursor((c) => c - 1);
      }
      setError(null);
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;
    if (input) {
      setValue((v) => v.slice(0, cursor) + input + v.slice(cursor));
      setCursor((c) => c + input.length);
      setError(null);
    }
  });

  const masked = "*".repeat(value.length);
  const before = masked.slice(0, cursor);
  const at = masked[cursor] ?? " ";
  const after = masked.slice(cursor + 1);

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="white" bold>Paste your Decision Ops access token</Text>
      <Box marginTop={1}>
        <Text color="gray">Use this fallback for automation or environments where browser OAuth login is unavailable.</Text>
      </Box>
      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="cyanBright">{">"}</Text>
        <Text> </Text>
        {value ? (
          <Text>{before}<Text inverse>{at}</Text>{after}</Text>
        ) : (
          <Text color="gray">dop_...</Text>
        )}
      </Box>
      {error ? (
        <Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function LoginFlow(props: LoginFlowProps) {
  const width = useWidth();
  const [step, setStep] = useState<FlowStep>(
    props.initialMethod ? (props.initialMethod === "token" ? { kind: "pasteToken" } : { kind: "waitBrowser" }) : { kind: "chooseMethod" },
  );
  const [authUrl, setAuthUrl] = useState<string | undefined>();
  const [browserOpened, setBrowserOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startBrowserLogin = useCallback(async () => {
    setStep({ kind: "waitBrowser" });
    setError(null);
    try {
      const result = await props.loginWithBrowser((url) => { setAuthUrl(url); });
      setBrowserOpened(result.openedBrowser);
      const identity = result.state.user?.email || result.state.user?.name || result.state.user?.id || "unknown";
      props.onDone({ storagePath: result.storagePath, display: identity });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error.message);
      props.onError(error);
    }
  }, [props]);

  useEffect(() => {
    if (props.initialMethod === "web") { startBrowserLogin(); }
  }, []);

  return (
    <Box flexDirection="column" width={width}>
      <BrandHeader eyebrow="Auth" />
      <Box marginTop={1} flexDirection="column">
        {step.kind === "chooseMethod" ? (
          <MethodStep
            clientDisplay={props.clientDisplay}
            scopesDisplay={props.scopesDisplay}
            onSelect={(method) => {
              if (method === "token") { setStep({ kind: "pasteToken" }); }
              else { startBrowserLogin(); }
            }}
            onCancel={props.onCancel}
          />
        ) : null}
        {step.kind === "pasteToken" ? (
          <TokenStep
            onSubmit={(token) => {
              const result = props.saveToken(token);
              props.onDone({ storagePath: result.storagePath, display: "token" });
            }}
            onCancel={props.onCancel}
          />
        ) : null}
        {step.kind === "waitBrowser" ? (
          <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
            <Text color="white" bold>Browser authentication</Text>
            {authUrl ? (
              <Box marginTop={1} flexDirection="column">
                <Text>{browserOpened ? "Browser opened. If it didn't appear, open this URL manually:" : "Open this URL in your browser to continue:"}</Text>
                <Text color="cyan">{authUrl}</Text>
              </Box>
            ) : null}
            {error ? (
              <Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1}>
                <Text color="red">{error}</Text>
              </Box>
            ) : (
              <Box marginTop={1}>
                <Spinner label="Waiting for browser authentication..." />
              </Box>
            )}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export async function runLoginFlow(options: {
  initialMethod?: "web" | "token";
  clientDisplay: string;
  scopesDisplay: string;
  loginWithBrowser: (onAuthorizeUrl: (url: string) => void) => Promise<LoginResult>;
  saveToken: (token: string) => { storagePath: string };
}): Promise<{ storagePath: string; display: string }> {
  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!isInteractive) {
    if (options.initialMethod !== "web") {
      throw new Error("Interactive terminal required for login selection. Pass --web or --with-token.");
    }
    let authUrlLogged = false;
    const result = await options.loginWithBrowser((url) => {
      if (authUrlLogged) return;
      authUrlLogged = true;
      console.log("Open this URL in your browser to continue authentication:");
      console.log(url);
    });
    const identity = result.state.user?.email || result.state.user?.name || result.state.user?.id || "unknown";
    return { storagePath: result.storagePath, display: identity };
  }

  return new Promise<{ storagePath: string; display: string }>((resolve, reject) => {
    const instance = render(
      <ErrorBoundary>
        <LoginFlow
          {...options}
          onDone={(result) => { instance.unmount(); resolve(result); }}
          onCancel={() => { instance.unmount(); reject(new CancelError()); }}
          onError={(err) => { instance.unmount(); reject(err); }}
        />
      </ErrorBoundary>,
      { exitOnCtrlC: false },
    );
  });
}
