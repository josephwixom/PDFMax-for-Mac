'use client';
import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';

function LoginForm() {
    const { signIn, signUp } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setInfo('');
        setLoading(true);

        if (mode === 'signin') {
            const err = await signIn(email, password);
            if (err) {
                setError(err);
                setLoading(false);
            } else {
                const next = searchParams.get('next') ?? '/';
                router.replace(next);
            }
        } else {
            const err = await signUp(email, password);
            if (err) {
                setError(err);
            } else {
                setInfo('Account created! Check your email to confirm, then sign in.');
                setMode('signin');
            }
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-indigo-950 px-4">
            <div className="w-full max-w-sm">
                {/* Logo / Brand */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 shadow-lg mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
                            fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-white tracking-tight">PDF Max</h1>
                    <p className="text-gray-400 text-sm mt-1">Professional PDF Annotations</p>
                </div>

                {/* Card */}
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 shadow-2xl border border-white/10">
                    {/* Tab toggle */}
                    <div className="flex rounded-lg bg-white/5 p-1 mb-6">
                        {(['signin', 'signup'] as const).map(m => (
                            <button key={m} onClick={() => { setMode(m); setError(''); setInfo(''); }}
                                className={`flex-1 py-1.5 rounded-md text-sm font-semibold transition-all ${mode === m
                                    ? 'bg-indigo-600 text-white shadow'
                                    : 'text-gray-400 hover:text-white'}`}>
                                {m === 'signin' ? 'Sign In' : 'Create Account'}
                            </button>
                        ))}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-300 mb-1">Email</label>
                            <input
                                type="email"
                                required
                                autoComplete="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="you@company.com"
                                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-300 mb-1">Password</label>
                            <input
                                type="password"
                                required
                                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                            />
                        </div>

                        {error && (
                            <div className="bg-red-500/20 border border-red-500/40 rounded-lg px-3 py-2 text-xs text-red-300">
                                {error}
                            </div>
                        )}
                        {info && (
                            <div className="bg-green-500/20 border border-green-500/40 rounded-lg px-3 py-2 text-xs text-green-300">
                                {info}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors shadow-lg shadow-indigo-900/40 flex items-center justify-center gap-2"
                        >
                            {loading && (
                                <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                            )}
                            {mode === 'signin' ? 'Sign In' : 'Create Account'}
                        </button>
                    </form>
                </div>

                <p className="text-center text-xs text-gray-600 mt-6">
                    JBW Creations · PDF Max
                </p>
            </div>
        </div>
    );
}

/** Wrap in Suspense — required by Next.js App Router for useSearchParams() */
export default function LoginPage() {
    return (
        <Suspense>
            <LoginForm />
        </Suspense>
    );
}



