import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ThemeCustomizerProvider } from "./contexts/ThemeCustomizerContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Home from "./pages/Home";
import Landing from "./pages/Landing";
import LoginPage from "./pages/LoginPage";

/** Guard que redireciona para /login se não autenticado */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading: loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      setLocation("/login");
    }
  }, [user, loading, setLocation]);

  if (loading) {
    return (
      <div
        style={{
          position: "fixed", inset: 0,
          background: "oklch(0.08 0.015 250)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 16,
        }}
      >
        <div
          style={{
            width: 40, height: 40, borderRadius: "50%",
            border: "3px solid oklch(0.20 0.04 250)",
            borderTopColor: "oklch(0.55 0.22 200)",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <p style={{ color: "oklch(0.45 0.04 250)", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif" }}>
          Verificando autenticação...
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/">
        <AuthGuard>
          <Home />
        </AuthGuard>
      </Route>
      <Route path="/landing" component={Landing} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <ThemeCustomizerProvider>
          <AuthProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </AuthProvider>
        </ThemeCustomizerProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
