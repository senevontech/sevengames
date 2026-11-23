/* Footer of the soft (neumorphic) pages: big faded wordmark, copyright, Privacy / About pills.
   Styles live in game2.css (.g2-foot), so use it inside a .g2 page. */
import { Link } from "react-router-dom";

export default function SoftFooter() {
  return (
    <footer className="g2-foot">
      <span className="g2-foot-mark" aria-hidden="true">
        Senevon Studio
      </span>
      <div className="g2-foot-row">
        <p className="g2-foot-copy">© {new Date().getFullYear()} Senevon Inc. All rights reserved</p>
        <nav className="g2-foot-links" aria-label="Site">
          <Link className="g2-pill g2-pill-sm" to="/privacy">
            Privacy policy
          </Link>
          <Link className="g2-pill g2-pill-sm" to="/about">
            About us
          </Link>
          <Link className="g2-pill g2-pill-sm" to="/business">
            For business
          </Link>
        </nav>
      </div>
    </footer>
  );
}
