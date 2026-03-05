'use client';
import React, { Component, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    /** Optional label shown in the error UI (e.g. "PDF Viewer") */
    label?: string;
    /** Compact mode — just shows an inline red banner instead of full-screen */
    compact?: boolean;
}

interface State {
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        // Log to console in dev; swap for a proper error tracking service in prod
        console.error(`[ErrorBoundary:${this.props.label ?? 'app'}]`, error, info.componentStack);
    }

    reset = () => this.setState({ error: null });

    render() {
        const { error } = this.state;
        const { label = 'Component', compact, children } = this.props;

        if (!error) return children;

        if (compact) {
            return (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 m-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span><strong>{label}</strong> encountered an error.</span>
                    <button onClick={this.reset}
                        className="ml-auto underline hover:no-underline">Retry</button>
                </div>
            );
        }

        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8 bg-gray-50">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
                        fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                </div>
                <div>
                    <h2 className="text-gray-800 font-semibold text-base mb-1">{label} crashed</h2>
                    <p className="text-gray-500 text-sm max-w-sm">
                        Something went wrong while rendering this area. Your other work is safe.
                    </p>
                    <details className="mt-2 text-left">
                        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                            Error details
                        </summary>
                        <pre className="mt-1 text-[10px] text-red-600 bg-red-50 rounded p-2 max-w-sm overflow-auto max-h-32 whitespace-pre-wrap">
                            {error.message}
                        </pre>
                    </details>
                </div>
                <button
                    onClick={this.reset}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                    Try Again
                </button>
            </div>
        );
    }
}
