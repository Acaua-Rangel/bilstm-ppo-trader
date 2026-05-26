import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header } from './components/Header';
import { LandingPage } from './pages/LandingPage';
import { Login } from './pages/Login';
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
              <Route path="/login" element={<Login />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/onboarding/api-keys" element={<ConnectBinance />} />
                <Route path="/dashboard" element={<DashboardGate />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

// Força o usuário a conectar a Binance antes de ver o Dashboard.
function DashboardGate() {
  const { user } = useAuth();
  if (user && !user.hasExchangeAccount) {
    return <Navigate to="/onboarding/api-keys" replace />;
  }
  return <Dashboard />;
}

export default App;
