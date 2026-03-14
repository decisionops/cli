import React, { useEffect, useState } from "react";
import { Box, render, Text } from "ink";

const GLYPHS = ["·", "✻", "✽", "✶", "✳", "✢"];
const INTERVAL_MS = 100;

export function Spinner(props: { label: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % GLYPHS.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box>
      <Text color="cyan">{GLYPHS[frame]}</Text>
      <Text> {props.label}</Text>
    </Box>
  );
}

export async function withSpinner<T>(label: string, fn: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const isTTY = process.stdout.isTTY ?? false;
  if (!isTTY) {
    return fn(signal);
  }
  const instance = render(<Spinner label={label} />, { exitOnCtrlC: false });
  try {
    return await fn(signal);
  } finally {
    instance.unmount();
  }
}
