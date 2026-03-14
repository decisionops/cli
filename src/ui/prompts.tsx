import React, { useMemo, useState } from "react";
import { Box, render, Text, useInput, useStdout } from "ink";

import { CancelError } from "./cancel.js";
import { ErrorBoundary } from "./error-boundary.js";

export type SelectOption<T> = {
  label: string;
  value: T;
  description?: string;
};

export type PromptChrome = {
  eyebrow?: string;
  description?: string;
  footer?: string;
  showBrandHeader?: boolean;
};

function useWidth(max = 100, min = 40): number {
  const { stdout } = useStdout();
  return Math.max(min, Math.min(max, (stdout.columns ?? 80) - 4));
}

function Keycap(props: { children: React.ReactNode }) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} marginRight={1}>
      <Text color="white">{props.children}</Text>
    </Box>
  );
}

function KeyboardHints(props: { items: string[] }) {
  return (
    <Box marginTop={1} flexWrap="wrap">
      {props.items.map((item) => (
        <Keycap key={item}>{item}</Keycap>
      ))}
    </Box>
  );
}

export function BrandHeader(props: { eyebrow?: string }) {
  return (
    <Box justifyContent="space-between">
      <Box>
        <Text color="cyanBright" bold>
          DecisionOps
        </Text>
        <Text color="gray"> CLI</Text>
      </Box>
      {props.eyebrow ? (
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">{props.eyebrow}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function Frame(props: {
  title: string;
  chrome?: PromptChrome;
  children: React.ReactNode;
  hintKeys: string[];
  showBrandHeader?: boolean;
}) {
  const width = useWidth();
  const showBrand = props.showBrandHeader ?? props.chrome?.showBrandHeader ?? true;

  return (
    <Box flexDirection="column" width={width}>
      {showBrand ? <BrandHeader eyebrow={props.chrome?.eyebrow} /> : null}
      <Box marginTop={showBrand ? 1 : 0} borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="white" bold>
          {props.title}
        </Text>
        {props.chrome?.description ? (
          <Box marginTop={1}>
            <Text color="gray">{props.chrome.description}</Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          {props.children}
        </Box>
        {props.chrome?.footer ? (
          <Box marginTop={1}>
            <Text color="gray">{props.chrome.footer}</Text>
          </Box>
        ) : null}
      </Box>
      <KeyboardHints items={props.hintKeys} />
    </Box>
  );
}

function OptionRow(props: { selected: boolean; label: string; description?: string; compact?: boolean }) {
  if (props.compact) {
    return (
      <Box>
        <Text color={props.selected ? "cyanBright" : "gray"}>{props.selected ? "●" : "○"}</Text>
        <Text color={props.selected ? "white" : undefined} bold={props.selected}>
          {" "}
          {props.label}
        </Text>
      </Box>
    );
  }

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

function FrameInput(props: { children: React.ReactNode }) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="cyanBright">{">"}</Text>
      <Text> </Text>
      {props.children}
    </Box>
  );
}

function SelectPrompt<T>(props: {
  title: string;
  options: SelectOption<T>[];
  chrome?: PromptChrome;
  onSubmit: (value: T) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const selected = props.options[index];
  const hasDescriptions = props.options.some((opt) => opt.description);

  useInput((_, key) => {
    if (key.escape) { props.onCancel(); return; }
    if (key.upArrow) { setIndex((current) => (current === 0 ? props.options.length - 1 : current - 1)); return; }
    if (key.downArrow) { setIndex((current) => (current === props.options.length - 1 ? 0 : current + 1)); return; }
    if (key.return) { props.onSubmit(selected.value); }
  });

  return (
    <Frame title={props.title} chrome={props.chrome} hintKeys={["↑ ↓", "enter", "esc"]}>
      {props.options.map((option, optionIndex) => (
        <OptionRow
          key={option.label}
          selected={optionIndex === index}
          label={option.label}
          description={option.description}
          compact={!hasDescriptions}
        />
      ))}
    </Frame>
  );
}

function ConfirmPrompt(props: {
  title: string;
  chrome?: PromptChrome;
  defaultValue?: boolean;
  onSubmit: (value: boolean) => void;
  onCancel: () => void;
}) {
  const defaultValue = props.defaultValue ?? true;
  const [value, setValue] = useState(defaultValue);

  useInput((input, key) => {
    if (key.escape) { props.onCancel(); return; }
    if (key.leftArrow || key.downArrow) { setValue(false); return; }
    if (key.rightArrow || key.upArrow) { setValue(true); return; }
    if (input.toLowerCase() === "y") { props.onSubmit(true); return; }
    if (input.toLowerCase() === "n") { props.onSubmit(false); return; }
    if (key.return) { props.onSubmit(value); }
  });

  return (
    <Frame title={props.title} chrome={props.chrome} hintKeys={["← →", "Y / N", "enter", "esc"]}>
      <Box gap={2}>
        <OptionRow selected={value} label="Yes" compact />
        <OptionRow selected={!value} label="No" compact />
      </Box>
    </Frame>
  );
}

function TextPrompt(props: {
  title: string;
  chrome?: PromptChrome;
  defaultValue?: string;
  placeholder?: string;
  secret?: boolean;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.defaultValue ?? "");
  const [cursor, setCursor] = useState((props.defaultValue ?? "").length);
  const [error, setError] = useState<string | null>(null);

  const displayValue = useMemo(() => {
    if (props.secret) return "*".repeat(value.length);
    return value;
  }, [props.secret, value]);

  useInput((input, key) => {
    if (key.escape) { props.onCancel(); return; }
    if (key.return) {
      const normalized = value.trim();
      const next = normalized.length > 0 ? normalized : (props.defaultValue ?? "").trim();
      const validationError = props.validate ? props.validate(next) : null;
      if (validationError) { setError(validationError); return; }
      props.onSubmit(next);
      return;
    }
    if (key.leftArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.rightArrow) { setCursor((c) => Math.min(value.length, c + 1)); return; }
    if (key.ctrl && input === "a") { setCursor(0); return; }
    if (key.ctrl && input === "e") { setCursor(value.length); return; }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue((current) => current.slice(0, cursor - 1) + current.slice(cursor));
        setCursor((c) => c - 1);
      }
      setError(null);
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;
    if (input) {
      setValue((current) => current.slice(0, cursor) + input + current.slice(cursor));
      setCursor((c) => c + input.length);
      setError(null);
    }
  });

  const renderInput = () => {
    if (!displayValue && !value) {
      return <Text color="gray">{props.placeholder ?? ""}</Text>;
    }
    const before = displayValue.slice(0, cursor);
    const at = displayValue[cursor] ?? " ";
    const after = displayValue.slice(cursor + 1);
    return (
      <Text>
        {before}
        <Text inverse>{at}</Text>
        {after}
      </Text>
    );
  };

  return (
    <Frame title={props.title} chrome={props.chrome} hintKeys={["type", "← →", "enter", "esc"]}>
      <FrameInput>{renderInput()}</FrameInput>
      {error ? (
        <Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
    </Frame>
  );
}

export async function promptSelect<T>(title: string, options: SelectOption<T>[], chrome?: PromptChrome): Promise<T> {
  let submitted: T | undefined;
  let cancelled = false;
  const instance = render(
    <ErrorBoundary>
      <SelectPrompt
        title={title}
        chrome={chrome}
        options={options}
        onSubmit={(value) => { submitted = value; instance.unmount(); }}
        onCancel={() => { cancelled = true; instance.unmount(); }}
      />
    </ErrorBoundary>,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  if (cancelled) throw new CancelError();
  if (submitted === undefined) throw new CancelError();
  return submitted;
}

export async function promptConfirm(title: string, defaultValue = true, chrome?: PromptChrome): Promise<boolean> {
  let submitted: boolean | undefined;
  let cancelled = false;
  const instance = render(
    <ErrorBoundary>
      <ConfirmPrompt
        title={title}
        chrome={chrome}
        defaultValue={defaultValue}
        onSubmit={(value) => { submitted = value; instance.unmount(); }}
        onCancel={() => { cancelled = true; instance.unmount(); }}
      />
    </ErrorBoundary>,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  if (cancelled) throw new CancelError();
  if (submitted === undefined) throw new CancelError();
  return submitted;
}

export async function promptText(options: {
  title: string;
  chrome?: PromptChrome;
  defaultValue?: string;
  placeholder?: string;
  secret?: boolean;
  validate?: (value: string) => string | null;
}): Promise<string> {
  let submitted: string | undefined;
  let cancelled = false;
  const instance = render(
    <ErrorBoundary>
      <TextPrompt
        {...options}
        onSubmit={(value) => { submitted = value; instance.unmount(); }}
        onCancel={() => { cancelled = true; instance.unmount(); }}
      />
    </ErrorBoundary>,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  if (cancelled) throw new CancelError();
  if (submitted === undefined) throw new CancelError();
  return submitted;
}
