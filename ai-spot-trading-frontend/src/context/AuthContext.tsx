import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  isAuthenticated: boolean;
  binanceUid: string | null;
  login: (uid: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [binanceUid, setBinanceUid] = useState<string | null>(null);

  useEffect(() => {
    // Check local storage for existing session
    const storedUid = localStorage.getItem('binanceUid');
    if (storedUid) {
      setBinanceUid(storedUid);
      setIsAuthenticated(true);
    }
  }, []);

  const login = (uid: string) => {
    localStorage.setItem('binanceUid', uid);
    setBinanceUid(uid);
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem('binanceUid');
    setBinanceUid(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, binanceUid, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
