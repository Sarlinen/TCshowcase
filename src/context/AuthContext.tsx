import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { checkSession, logout as apiLogout } from '../api';

interface AuthContextType {
  authenticated: boolean;
  sessionLoading: boolean;
  setAuthenticated: (v: boolean) => void;
  doLogout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  authenticated: false,
  sessionLoading: true,
  setAuthenticated: () => {},
  doLogout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    checkSession()
      .then(isAdmin => setAuthenticated(isAdmin))
      .catch(() => setAuthenticated(false))
      .finally(() => setSessionLoading(false));
  }, []);

  const doLogout = () => {
    apiLogout().finally(() => {
      setAuthenticated(false);
    });
  };

  return (
    <AuthContext.Provider value={{ authenticated, sessionLoading, setAuthenticated, doLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
