import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Generic React Error Boundary to catch rendering errors and prevent a white screen.
 * Logs the error to console (or could be sent to a monitoring service).
 * Renders an optional fallback UI when an error occurs.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(_: Error): State {
    // Update state so the next render shows fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // You could integrate with remote error logging here.
    console.error('ErrorBoundary caught an error', error, info);
  }

  render() {
    const { hasError } = this.state;
    const { children, fallback } = this.props;
    if (hasError) {
      // Render provided fallback or a minimal UI.
      return fallback ?? (
        <div style={{ padding: '1rem', textAlign: 'center' }}>
          <h2>Something went wrong.</h2>
          <p>Please try reloading the app.</p>
        </div>
      );
    }
    return children;
  }
}
