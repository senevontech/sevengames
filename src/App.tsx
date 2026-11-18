import { lazy, Suspense, useEffect } from "react";
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
import { TokensProvider } from "./lib/tokens";
import { ShopProvider } from "./lib/shop";

import { trackPageview } from "./lib/track";

// Home page (the floating-island fly-in) and the /home2 test page: code-split.
const Home3 = lazy(() => import("./pages/Home3"));
const Home2 = lazy(() => import("./pages/Home2"));
const GamesGlobe = lazy(() => import("./pages/GamesGlobe"));
const CategoryPage = lazy(() => import("./pages/CategoryPage"));

/** The landing page lives outside the Shell (it has its own nav, sidebar and background). */
function Landing({ videoHero = false }: { videoHero?: boolean }) {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#e7ebe8" }} />}>
      {/* key: switching between / and /home3 remounts the page */}
      <Home3 key={videoHero ? "video" : "flat"} videoHero={videoHero} />
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
        {/* The old home page is retired; old links land on the new one */}
        <Route path="/classic" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </RouterRoutes>
    </SiteChrome>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TokensProvider>
      <ShopProvider>
      <RouterRoutes>
        <Route path="/admin/*" element={<Admin />} />
        <Route path="/" element={<Landing videoHero />} />
        {/* The video-hero design is now the home page */}
        <Route path="/home3" element={<Navigate to="/" replace />} />
        {/* Full-screen carousel per category */}
        <Route
          path="/category/:slug"
          element={
            <Suspense fallback={<div style={{ minHeight: "100vh", background: "#121212" }} />}>
              <CategoryPage />
            </Suspense>
          }
        />
        {/* Full-screen draggable globe of every game */}
        <Route
          path="/games"
          element={
            <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0d0d0f" }} />}>
              <GamesGlobe />
            </Suspense>
          }
        />
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
