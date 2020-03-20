import React, { Component } from "react";

import { UseAsyncError } from "./createUseAsync";

export class CatchUseAsyncError extends Component<{
  fallback: React.ComponentType<{
    error: UseAsyncError;
    clear: () => void;
  }>;
}> {
  state: { error: null | Error } = { error: null };

  static getDerivedStateFromError(error: Error) {
    if (!(error instanceof UseAsyncError)) throw error;
    return { error };
  }

  clearError = () => {
    this.setState({ error: null });
  };

  render() {
    return this.state.error ? (
      <this.props.fallback error={this.state.error} clear={this.clearError} />
    ) : (
      this.props.children
    );
  }
}
