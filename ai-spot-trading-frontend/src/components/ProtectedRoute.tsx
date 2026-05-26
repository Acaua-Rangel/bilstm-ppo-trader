import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = () => {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    // Redireciona para o login (ou Landing Page) se não estiver autenticado
    return <Navigate to="/auth/callback?code=mock_binance_code" replace />;
  }

  return <Outlet />;
};
