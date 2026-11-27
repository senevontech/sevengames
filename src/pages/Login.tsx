import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { Smartphone, Trophy } from "../components/anim-icons";
import { useAuthContext } from "../context/AuthContext";
import AuthForm from "../components/AuthForm";
import TokenIcon from "../components/TokenIcon";
import "./account.css";
import "./login.css";

export default function Login() {
  const auth = useAuthContext();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  useEffect(() => {
    document.title = "Sign in — Senevon Game Studio";
  }, []);

  useEffect(() => {
    if (auth.user) navigate(next, { replace: true });
  }, [auth.user, next, navigate]);

  return (
    <div className="acct lg">
      <section className="ac-card lg-intro">
        <span className="lg-eyebrow">Senevon account</span>
        <h1 className="lg-title">
          Sign in once.
          <br />
          Play everywhere.
        </h1>
        <p className="ac-sub">Your scores, chips and leaderboard ranks follow you to every device.</p>
        <ul className="lg-perks">
          <li>
            <span className="lg-perk-icon" aria-hidden="true">
              <TokenIcon size={18} />
            </span>
            <span>
              <b>100 free chips</b>
              <small>for premium games, on your first sign-in</small>
            </span>
          </li>
          <li>
            <span className="lg-perk-icon" aria-hidden="true">
              <Smartphone size={18} />
            </span>
            <span>
              <b>Progress on every device</b>
              <small>scores, levels and unlocks are saved to your account</small>
            </span>
          </li>
          <li>
            <span className="lg-perk-icon" aria-hidden="true">
              <Trophy size={18} />
            </span>
            <span>
              <b>Your name on the leaderboards</b>
              <small>compete with players everywhere</small>
            </span>
          </li>
        </ul>
      </section>

      <section className="ac-card lg-card" aria-label="Sign in">
        <AuthForm auth={auth} redirectTo={next} />
        <p className="lg-guest">
          Just browsing? <Link to="/">Continue as guest</Link>. You can still play every game.
        </p>
      </section>
    </div>
  );
}
