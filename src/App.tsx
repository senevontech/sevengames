import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { syncPlayPurchases } from "./lib/playBilling";
import { isNative } from "./lib/native";
import { useOnline } from "./lib/online";
import { useTokens } from "./lib/tokens";
import { Navigate, Route, Routes as RouterRoutes, useLocation } from "react-router-dom";
import { AuthProvider, useAuthContext } from "./context/AuthContext";
import SiteChrome from "./components/SiteChrome";
// the home page is part of the first download (it's where nearly everyone lands)
import Game2 from "./pages/Game2";
// Every page is its own download, fetched when first opened (they ship inside the app, so the
// app still works offline). The home page's chunk is fetched first; the rest wait their turn.
const GamePage = lazy(() => import("./pages/GamePage"));
const Login = lazy(() => import("./pages/Login"));
const Profile = lazy(() => import("./pages/Profile"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const Privacy = lazy(() => import("./pages/Privacy"));
const About = lazy(() => import("./pages/About"));
const Admin = lazy(() => import("./pages/admin/Admin"));
const TokensPage = lazy(() => import("./pages/TokensPage"));
const Leaderboards = lazy(() => import("./pages/Leaderboards"));
const PlayerPage = lazy(() => import("./pages/PlayerPage"));
const GetApp = lazy(() => import("./pages/GetApp"));
const AdFreePromo = lazy(() => import("./components/AdFreePromo"));
import { TokensProvider } from "./lib/tokens";
import { ShopProvider } from "./lib/shop";
import { startOfflineSync } from "./lib/offlineQueue";
import OfflineBanner from "./components/OfflineBanner";
import AppBanner from "./components/AppBanner";

import { trackPageview } from "./lib/track";

// The /home2 test page and the category carousels: code-split.
const Home2 = lazy(() => import("./pages/Home2"));
const CategoryPage = lazy(() => import("./pages/CategoryPage"));


/** The home page lives outside the Shell (it has its own nav and background). */
function Landing() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);
  return (
    <Game2 />
  );
}

/** Pages outside the Shell still count page views. */
function Tracked({ children }: { children: ReactNode }) {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);
  return <>{children}</>;
}

/** Every page except the home page, framed in the new UI (nav, glass sidebar, island backdrop). */
function Shell() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);

  return (
    <SiteChrome>
      <Suspense fallback={<div className="page-loading" role="status" aria-label="Loading" />}>
      <RouterRoutes location={location}>
        <Route path="/game/:id" element={<GamePage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/about" element={<About />} />
        <Route path="/tokens" element={<TokensPage />} />
        <Route path="/leaderboards" element={<Leaderboards />} />
        <Route path="/player/:id" element={<PlayerPage />} />
        {/* The old home page is retired; old links land on the new one */}
        <Route path="/classic" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </RouterRoutes>
      </Suspense>
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
      <AppBanner />
      <TokensProvider>
      <OfflineSync />
      <Suspense fallback={null}>
        <AdFreePromo />
      </Suspense>
      <ShopProvider>
      <RouterRoutes>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
              <Admin />
            </Suspense>
          }
        />
        <Route path="/" element={<Landing />} />
        {/* website only (GetApp sends the app back home); soft page with its own nav like the home page */}
        <Route
          path="/app"
          element={
            <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
              <Tracked>
                <GetApp />
              </Tracked>
            </Suspense>
          }
        />
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
