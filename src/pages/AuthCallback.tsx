import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "../components/anim-icons/toggles";
import "./info-page.css";
import { supabase } from "../supabase";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    async function finish() {
      if (!supabase) {
        navigate("/", { replace: true });
        return;
      }

      // detectSessionInUrl already exchanged the code; just confirm a session exists
      const { data } = await supabase.auth.getSession();
      const redirect = window.sessionStorage.getItem("7games:redirect") || "/";
      window.sessionStorage.removeItem("7games:redirect");
      navigate(data.session ? redirect : "/", { replace: true });
    }
    finish();
  }, [navigate]);

  return (
    <div className="page narrow info-page callback-page">
      <Spinner size={22} />
      <p>Signing you in…</p>
    </div>
  );
}
