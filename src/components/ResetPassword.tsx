import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Landing page for the password-recovery email link. Supabase establishes a
// recovery session from the URL automatically; here the user sets a new password.
export function ResetPassword() {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [hasRecovery, setHasRecovery] = useState<boolean | null>(null);

    useEffect(() => {
        // A valid recovery link creates a session (and fires PASSWORD_RECOVERY).
        supabase.auth.getSession().then(({ data }) => setHasRecovery(!!data.session));
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') setHasRecovery(true);
        });
        return () => subscription.unsubscribe();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
        if (password !== confirm) { setError('Passwords do not match.'); return; }
        setSubmitting(true);
        const { error: updErr } = await supabase.auth.updateUser({ password });
        if (updErr) {
            setError(updErr.message || 'Could not update password. The link may have expired — request a new one.');
            setSubmitting(false);
        } else {
            setDone(true);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div style={{ maxWidth: '28rem', width: '100%', padding: '1rem' }}>
                <div className="bg-white rounded-lg card-shadow p-8">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">🧶 Set a New Password</h1>
                        <p className="text-gray-600">Choose a new password for your account.</p>
                    </div>

                    {done ? (
                        <div className="space-y-4 text-center">
                            <div className="p-3 rounded-lg text-sm bg-green-50 text-green-700">
                                Password updated. You're all set.
                            </div>
                            <button
                                onClick={() => navigate('/')}
                                className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors font-medium"
                            >
                                Go to your studio
                            </button>
                        </div>
                    ) : hasRecovery === false ? (
                        <div className="space-y-4 text-center">
                            <div className="p-3 rounded-lg text-sm bg-yellow-50 text-yellow-700">
                                This reset link is invalid or has expired. Request a new one from the login page.
                            </div>
                            <button
                                onClick={() => navigate('/')}
                                className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors font-medium"
                            >
                                Back to login
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                    placeholder="At least 6 characters"
                                    autoComplete="new-password"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                                <input
                                    type="password"
                                    required
                                    value={confirm}
                                    onChange={(e) => { setConfirm(e.target.value); setError(''); }}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                    placeholder="Re-enter password"
                                    autoComplete="new-password"
                                />
                            </div>
                            {error && (
                                <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700">{error}</div>
                            )}
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-60"
                            >
                                {submitting ? 'Updating…' : 'Update Password'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
