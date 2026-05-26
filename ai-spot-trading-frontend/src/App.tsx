import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Header } from './components/Header';
import { LandingPage } from './pages/LandingPage';
import { Dashboard } from './pages/Dashboard';
import { AuthCallback } from './pages/AuthCallback';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-background text-white selection:bg-primary selection:text-background">
          <Header />
          <main>
            <Routes>
              {/* Rota pública (Landing Page) */}
              <Route path="/" element={<LandingPage />} />
              
              {/* Rota para processar a volta do login da Binance */}
              <Route path="/auth/callback" element={<AuthCallback />} />
              
              {/* Rotas protegidas (Só acessa se autenticado) */}
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<Dashboard />} />
              </Route>
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
