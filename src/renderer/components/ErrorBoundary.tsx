import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '48px 24px',
          }}
        >
          <div
            style={{
              background: '#141414',
              border: '1px solid #2e2e2e',
              borderRadius: '6px',
              padding: '32px',
              maxWidth: '480px',
              width: '100%',
            }}
          >
            <h2
              style={{
                color: '#e2e2e2',
                fontSize: '16px',
                fontWeight: 700,
                marginBottom: '8px',
                fontFamily: 'monospace',
              }}
            >
              Module Error
            </h2>
            <p
              style={{
                color: '#888',
                fontSize: '13px',
                lineHeight: '1.5',
                marginBottom: '20px',
              }}
            >
              Something went wrong while rendering this module.
            </p>
            <div
              style={{
                background: '#1a1a1a',
                border: '1px solid #2e2e2e',
                borderRadius: '6px',
                padding: '12px',
                marginBottom: '20px',
                overflowX: 'auto',
              }}
            >
              <code
                style={{
                  color: '#ef4444',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {this.state.error?.message ?? 'Unknown error'}
              </code>
            </div>
            <button
              onClick={this.handleReload}
              style={{
                background: '#2e2e2e',
                color: '#e2e2e2',
                border: '1px solid #3a3a3a',
                borderRadius: '6px',
                padding: '8px 20px',
                fontSize: '13px',
                fontWeight: 600,
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
            >
              Reload Module
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
