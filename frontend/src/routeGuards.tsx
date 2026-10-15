import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "./authStore";

const AuthHydrating = () => (
  <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-6 text-slate-900">
    <p className="text-sm text-slate-500">認証状態を確認中...</p>
  </main>
);

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const accessToken = useAuthStore((state) => state.accessToken);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  if (isHydrating) return <AuthHydrating />;
  if (accessToken) return <>{children}</>;
  return <Navigate to="/login" replace />;
};

export const RedirectIfAuthenticated = ({ children }: { children: ReactNode }) => {
  const accessToken = useAuthStore((state) => state.accessToken);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  if (isHydrating) return <AuthHydrating />;
  if (accessToken) return <Navigate to="/household" replace />;
  return <>{children}</>;
};
