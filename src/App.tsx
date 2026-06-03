import { useState, useEffect } from 'react';
import { YarnDyeManager } from './components/YarnDyeManager';
import { PasswordScreen } from './components/PasswordScreen';

// App Wrapper with Password Protection
function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const auth = sessionStorage.getItem('dyestudio_auth');
        if (auth === 'true') {
            setIsAuthenticated(true);
        }
        setLoading(false);
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <PasswordScreen onAuthenticated={() => setIsAuthenticated(true)} />;
    }

    return <YarnDyeManager />;
}

export default App;
