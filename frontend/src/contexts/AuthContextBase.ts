import { createContext } from "react";

export interface AuthUser {
  name?: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  verificationError: string | null;
  retryVerification: () => void;
  needsOnboarding: boolean;
  setNeedsOnboarding: (value: boolean) => void;
  login: (token: string, userData: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export default AuthContext;
