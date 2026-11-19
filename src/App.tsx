import { lazy, Suspense, useEffect } from "react";
import { syncPlayPurchases } from "./lib/playBilling";
import { isNative } from "./lib/native";
import { useOnline } from "./lib/online";
import { useTokens } from "./lib/tokens";
import { Navigate, Route, Routes as RouterRoutes, useLocation } from "react-router-dom";
import { AuthProvider, useAuthContext } from "./context/AuthContext";
import SiteChrome from "./components/SiteChrome";
import GamePage from "./pages/GamePage";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import AuthCallback from "./pages/AuthCallback";
import Privacy from "./pages/Privacy";
import Admin from "./pages/admin/Admin";
import TokensPage from "./pages/TokensPage";
import Leaderboards from "./pages/Leaderboards";
import PlayerPage from "./pages/PlayerPage";
import { TokensProvider } from "./lib/tokens";
import { ShopProvider } from "./lib/shop";
import { startOfflineSync } from "./lib/offlineQueue";
import OfflineBanner from "./components/OfflineBanner";

import { trackPageview } from "./lib/track";

// Home page (disk browser) and the /home2 test page: code-split.
const Home2 = lazy(() => import("./pages/Home2"));
const CategoryPage = lazy(() => import("./pages/CategoryPage"));
const Game2 = lazy(() => import("./pages/Game2"));

/** The home page lives outside the Shell (it has its own nav and background). */
function Landing() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#e3e5ea" }} />}>
      <Game2 />
    </Suspense>
  );
}

/** Every page except the home page, framed in the new UI (nav, glass sidebar, island backdrop). */
function Shell() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);

  return (
    <SiteChrome>
      <RouterRoutes location={location}>
        <Route path="/game/:id" element={<GamePage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/tokens" element={<TokensPage />} />
        <Route path="/leaderboards" element={<Leaderboards />} />
        <Route path="/player/:id" element={<PlayerPage />} />
        {/* The old home page is retired; old links land on the new one */}
        <Route path="/classic" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </RouterRoutes>
    </SiteChrome>
  );
}

/** Sends progress made offline once the player is known (and whenever the connection returns). */
function OfflineSync() {
  const { user } = useAuthContext();
  const { refresh } = useTokens();
  const online = useOnline();
  useEffect(() => startOfflineSync(user?.id ?? null), [user?.id]);
  // the app: hand Google Play purchases still open (or renewed) to the server, then refresh tokens
  useEffect(() => {
    if (!isNative || !user || !online) return;
    void syncPlayPurchases(user.id).then(() => refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, online]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <OfflineBanner />
      <TokensProvider>
      <OfflineSync />
      <ShopProvider>
      <RouterRoutes>
        <Route path="/admin/*" element={<Admin />} />
        <Route path="/" element={<Landing />} />
        {/* Old home page addresses land on the new one */}
        <Route path="/home3" element={<Navigate to="/" replace />} />
        <Route path="/game2" element={<Navigate to="/" replace />} />
        {/* Full-screen carousel per category */}
        <Route
          path="/category/:slug"
          element={
            <Suspense fallback={<div style={{ minHeight: "100vh", background: "#121212" }} />}>
              <CategoryPage />
            </Suspense>
          }
        />
        {/* The globe page is retired: every game is on the home page */}
        <Route path="/games" element={<Navigate to="/" replace />} />
        <Route
          path="/home2"
          element={
            <Suspense fallback={<div style={{ minHeight: "100vh", background: "#e7ebe8" }} />}>
              <Home2 />
            </Suspense>
          }
        />
        <Route path="*" element={<Shell />} />
      </RouterRoutes>
      </ShopProvider>
      </TokensProvider>
    </AuthProvider>
  );
}
