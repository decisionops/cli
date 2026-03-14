import React from "react";
import { Box, Text } from "ink";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Box borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red">Something went wrong: {this.state.error.message}</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
