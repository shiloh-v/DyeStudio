import { Component, type ReactNode } from 'react';

// Last-resort catch for render errors: shows a reload screen instead of a
// blank white page. Nothing is saved from here, so data is never affected.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('Render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
        <div className="bg-white rounded-lg card-shadow p-6 max-w-md text-center">
          <div className="text-4xl mb-2">⚠️</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Something went wrong</h2>
          <p className="text-gray-600 mb-1">This screen hit an error. Your saved data is fine.</p>
          <p className="text-xs text-gray-400 mb-4 break-words">{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-teal-600 text-white px-5 py-3 rounded-lg font-medium hover:bg-teal-700"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
