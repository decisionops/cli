import React, { useCallback, useEffect, useState } from "react";
import { Box, render, Text, useInput } from "ink";

import type { LoginResult } from "../../core/auth.js";
import { CancelError } from "../cancel.js";
import { ErrorBoundary } from "../error-boundary.js";
import { Spinner } from "../spinner.js";
import { BrandHeader } from "../prompts.js";

type LoginFlowProps = {
  clientDisplay: string;
  loginWithBrowser: (onAuthorizeUrl: (url: string) => void) => Promise<LoginResult>;
  onDone: (result: LoginResult) => void;
  onCancel: () => void;
  onError: (err: Error) => void;
};

function useWidth(): number {
  const columns = process.stdout.columns ?? 80;
  return Math.max(40, Math.min(100, columns - 4));
}

function LoginFlow(props: LoginFlowProps) {
  const width = useWidth();
  const [authUrl, setAuthUrl] = useState<string | undefined>();
  const [browserOpened, setBrowserOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInput((_, key) => {
    if (key.escape) props.onCancel();
  });

  const startBrowserLogin = useCallback(async () => {
    setError(null);
    try {
      const result = await props.loginWithBrowser((url) => { setAuthUrl(url); });
      setBrowserOpened(result.openedBrowser);
      props.onDone(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error.message);
      props.onError(error);
    }
  }, [props]);

  useEffect(() => {
    void startBrowserLogin();
  }, [startBrowserLogin]);

  return (
    <Box flexDirection="column" width={width}>
      <BrandHeader eyebrow="Auth" />
      <Box marginTop={1} flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
          <Text color="white" bold>Browser authentication</Text>
          <Box marginTop={1}>
            <Text color="gray">Authenticate the dops CLI with DecisionOps in your browser.</Text>
          </Box>
          <Box>
            <Text color="gray">This signs in the CLI on this machine.</Text>
          </Box>
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
          <Box marginTop={1}>
            <Text color="gray">OAuth client: {props.clientDisplay}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export async function runLoginFlow(options: {
  clientDisplay: string;
  loginWithBrowser: (onAuthorizeUrl: (url: string) => void) => Promise<LoginResult>;
}): Promise<LoginResult> {
  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!isInteractive) {
    let authUrlLogged = false;
    const result = await options.loginWithBrowser((url) => {
      if (authUrlLogged) return;
      authUrlLogged = true;
      console.log("Open this URL in your browser to continue authentication:");
      console.log(url);
    });
    return result;
  }

  return new Promise<LoginResult>((resolve, reject) => {
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
