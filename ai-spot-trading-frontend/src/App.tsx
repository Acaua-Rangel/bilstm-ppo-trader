import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Header } from './components/Header';
import { LandingPage } from './pages/LandingPage';
import { AuthCallback } from './pages/AuthCallback';
import { ConnectBinance } from './pages/ConnectBinance';
import { Dashboard } from './pages/Dashboard';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-background text-white selection:bg-primary selection:text-background">
          <Header />
          <main>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/auth/callback" element={<AuthCallback />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/onboarding/api-keys" element={<ConnectBinance />} />
                <Route path="/dashboard" element={<Dashboard />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
