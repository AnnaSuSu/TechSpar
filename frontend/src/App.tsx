import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster } from "sonner";
import { AuthProvider } from "./contexts/AuthContext";
import { TaskStatusProvider } from "./contexts/TaskStatusContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import useAuth from "./hooks/useAuth";
import useTheme from "./hooks/useTheme";
import Sidebar from "./components/Sidebar";
import TaskNotification from "./components/TaskNotification";
import ErrorBoundary from "./components/ErrorBoundary";
import SessionRecovery from "./components/SessionRecovery";

const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Interview = lazy(() => import("./pages/Interview"));
const Review = lazy(() => import("./pages/Review"));
const History = lazy(() => import("./pages/History"));
const Profile = lazy(() => import("./pages/Profile"));
const PersonalAgent = lazy(() => import("./pages/PersonalAgent"));
const TopicDetail = lazy(() => import("./pages/TopicDetail"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const Graph = lazy(() => import("./pages/Graph"));
const RecordingAnalysis = lazy(() => import("./pages/RecordingAnalysis"));
const MockInterview = lazy(() => import("./pages/MockInterview"));
const Copilot = lazy(() => import("./pages/Copilot"));
const TopicDrill = lazy(() => import("./pages/TopicDrill"));
const ResumeManager = lazy(() => import("./pages/ResumeManager"));
const ResumeEditor = lazy(() => import("./pages/ResumeEditor"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

function RouteLoadingFallback() {
  return (
    <div role="status" aria-label="页面加载中" className="grid min-h-screen place-items-center text-dim motion-safe:animate-fade-in">
      <Loader2 size={20} className="motion-safe:animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth();
  if (loading) return <RouteLoadingFallback />;
  if (!token) return <Navigate to="/" replace />;
  return children;
}

function ProviderGate({ children }: { children: ReactNode }) {
  const { needsOnboarding } = useAuth();
  if (needsOnboarding) return <Onboarding />;
  return children;
}

function PublicHome() {
  const { token, loading } = useAuth();
  if (loading) return <RouteLoadingFallback />;
  if (token) return <Navigate to="/profile" replace />;
  return <Landing />;
}

function AuthPage() {
  const { token, loading } = useAuth();
  if (loading) return <RouteLoadingFallback />;
  if (token) return <Navigate to="/" replace />;
  return <Login />;
}

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col md:flex-row">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function WorkspaceRoutes() {
  const { pathname } = useLocation();
  return (
    <AppShell>
      <ErrorBoundary resetKey={pathname}>
        <Suspense
          fallback={
            <div role="status" aria-label="页面加载中" className="flex flex-1 items-center justify-center text-dim">
              <Loader2 size={20} className="motion-safe:animate-spin" />
            </div>
          }
        >
          <Routes>
            <Route path="/interview/:sessionId" element={<Interview />} />
            <Route path="/review/:sessionId" element={<Review />} />
            <Route path="/history" element={<History />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/personal-agent" element={<PersonalAgent />} />
            <Route path="/profile/topic/:topic" element={<TopicDetail />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/graph" element={<Graph />} />
            <Route path="/recording" element={<RecordingAnalysis />} />
            <Route path="/mock-interview" element={<MockInterview />} />
            <Route path="/job-prep" element={<Navigate to="/mock-interview?mode=targeted" replace />} />
            <Route path="/copilot" element={<Copilot />} />
            <Route path="/topic-drill" element={<TopicDrill />} />
            <Route path="/resume-interview" element={<Navigate to="/mock-interview?mode=live" replace />} />
            <Route path="/resume-manager" element={<ResumeManager />} />
            <Route path="/resume-manager/:id" element={<ResumeEditor />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

function AppRoutes() {
  const { verificationError } = useAuth();
  if (verificationError) return <SessionRecovery />;
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/login" element={<AuthPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <ProviderGate>
                <WorkspaceRoutes />
              </ProviderGate>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Suspense>
  );
}

function AppToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster position="top-center" richColors theme={resolvedTheme} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <TaskStatusProvider>
            <ErrorBoundary>
              <AppRoutes />
              <TaskNotification />
            </ErrorBoundary>
          </TaskStatusProvider>
        </BrowserRouter>
      </AuthProvider>
      <AppToaster />
    </ThemeProvider>
  );
}
