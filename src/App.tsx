import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { YarnDyeManager } from './components/YarnDyeManager';
import { LoginScreen } from './components/LoginScreen';
import { ResetPassword } from './components/ResetPassword';
import { Toaster } from './lib/toast';
import { DialogHost } from './lib/dialog';

// App wrapper — real auth via Supabase. Shows the login screen until there's
// a session; swaps to the app on sign-in and back on sign-out.
function App() {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setLoading(false);
        });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
            setSession(newSession);
        });
        return () => subscription.unsubscribe();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <>
            <Routes>
                {/* Always reachable — the recovery email links here even mid-session */}
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/*" element={session ? <YarnDyeManager /> : <LoginScreen />} />
            </Routes>
            {/* App-wide notification + dialog hosts (imperative toast()/confirmDialog()/promptDialog()) */}
            <Toaster />
            <DialogHost />
        </>
    );
}

export default App;
