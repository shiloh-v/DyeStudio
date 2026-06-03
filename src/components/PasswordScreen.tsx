import { useState } from 'react';

// PASSWORD CONFIGURATION - set via VITE_APP_PASSWORD env var
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD;

// Password Screen Component
export function PasswordScreen({ onAuthenticated }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (password === APP_PASSWORD) {
            sessionStorage.setItem('dyestudio_auth', 'true');
            onAuthenticated();
        } else {
            setError('Incorrect password');
            setPassword('');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div style={{maxWidth: '28rem', width: '100%', padding: '1rem'}}>
                <div className="bg-white rounded-lg card-shadow p-8">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">🧶 Celestial Dyeworks Studio</h1>
                        <p className="text-gray-600">Enter password to access</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Password
                            </label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    setError('');
                                }}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                                placeholder="Enter password"
                                autoFocus
                            />
                        </div>

                        {error && (
                            <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors font-medium"
                        >
                            Access App
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
