import { useEffect } from "react";
import { Link } from "react-router-dom";
import "./info-page.css";
import { isNative } from "../lib/native";
import { GET_APP_PATH } from "../lib/appLinks";

/* About us: a short page in the same simple layout as the privacy policy. */
export default function About() {
  useEffect(() => {
    const prev = document.title;
    document.title = "About us — Senevon Game Studio";
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <article className="page info-page privacy-page">
      <p className="eyebrow">Senevon Game Studio</p>
      <h1>About us</h1>

      <p>
        Senevon Game Studio makes quick, good-looking games you can play for free, straight in your browser or in our
        mobile app. Classics like carrom, chess and ludo sit next to our own puzzle and arcade games, all in one place.
      </p>

      <h2>What we care about</h2>
      <ul>
        <li>Games that open instantly and run smoothly, even on older phones.</li>
        <li>Play as a guest, or sign in to keep your chips, levels and scores everywhere.</li>
        <li>Only collecting what the games need to work. See our <Link to="/privacy">privacy policy</Link>.</li>
      </ul>

      {!isNative ? (
        <>
          <h2>Play on your phone</h2>
          <p>
            The Senevon app is available for Android, with iPhone coming soon. <Link to={GET_APP_PATH}>Get the app</Link>.
          </p>
        </>
      ) : null}
    </article>
  );
}
