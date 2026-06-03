import { useState } from 'react';
import { supabase } from '../lib/supabase';

// Real login via Supabase Auth. Replaces the old client-side password gate.
export function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setError('');
        setInfo('');
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) {
            setError(authError.message || 'Sign in failed');
            setPassword('');
            setSubmitting(false);
        }
        // On success, onAuthStateChange in App swaps to the app — no further action here.
    };

    const handleForgot = async () => {
        setError('');
        setInfo('');
        if (!email) { setError('Enter your email above first, then click "Forgot password?".'); return; }
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) setError(resetError.message || 'Could not send reset email.');
        else setInfo('If an account exists for that email, a password-reset link is on its way.');
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div style={{ maxWidth: '28rem', width: '100%', padding: '1rem' }}>
                <div className="bg-white rounded-lg card-shadow p-8">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">🧶 Celestial Dyeworks Studio</h1>
                        <p className="text-gray-600">Sign in to access your studio</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                placeholder="you@example.com"
                                autoFocus
                                autoComplete="email"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                placeholder="Enter password"
                                autoComplete="current-password"
                            />
                        </div>

                        {error && (
                            <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700">
                                {error}
                            </div>
                        )}
                        {info && (
                            <div className="p-3 rounded-lg text-sm bg-green-50 text-green-700">
                                {info}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-60"
                        >
                            {submitting ? 'Signing in…' : 'Sign In'}
                        </button>

                        <button
                            type="button"
                            onClick={handleForgot}
                            className="w-full text-sm text-purple-600 hover:underline bg-transparent border-0 cursor-pointer"
                        >
                            Forgot password?
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
