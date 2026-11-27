import { useEffect } from "react";
import { Link } from "react-router-dom";
import "./info-page.css";

/*
 * Privacy policy. Describes what the site actually does today (Supabase accounts, scores,
 * anonymous analytics, browser storage); update it whenever data handling changes.
 */

const UPDATED = "16 November 2026";

export default function Privacy() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Privacy policy — Senevon Game Studio";
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <article className="page info-page privacy-page">
      <p className="eyebrow">Legal</p>
      <h1>Privacy policy</h1>
      <p className="privacy-updated">Last updated: {UPDATED}</p>

      <p>
        Senevon Game Studio ("we", "us") runs this website, where you can play browser games for free. This
        policy explains what information we collect, why, and the choices you have. We keep it short and only
        collect what the site needs to work.
      </p>

      <h2>Playing without an account</h2>
      <p>
        You can play every game as a guest. Guest scores and your recently played games are stored only in
        your own browser (local storage) and are never sent to us as personal data.
      </p>

      <h2>If you create an account</h2>
      <ul>
        <li>
          <strong>Sign-in details:</strong> your email address, or the basic profile your sign-in provider
          shares if you choose to sign in with Google (your name and email). Passwords are handled by our
          authentication provider and are never visible to us.
        </li>
        <li>
          <strong>Profile:</strong> your display name and the avatar style you pick from the avatar library.
        </li>
        <li>
          <strong>Game results:</strong> your scores and play times for each game, used for your personal
          bests and the global leaderboards. Leaderboards show your display name and score to other players.
        </li>
      </ul>

      <h2>Anonymous usage statistics</h2>
      <p>
        To understand which pages and games are popular, we record page views and when a game is started or
        finished (with the score). Each record includes a random visitor ID stored in your browser, the type
        of device (mobile, tablet or desktop) and, on your first page, the website that linked you here. It
        does not include your name or email. This measurement can be switched off by the site administrator,
        and you can reset the visitor ID at any time by clearing this site's data in your browser.
      </p>

      <h2>Cookies and browser storage</h2>
      <p>
        We don't use advertising or third-party tracking cookies. We use your browser's local storage for:
        keeping you signed in, guest scores, recently played games, your avatar choice, your light/dark mode
        choice on game pages, and the anonymous visitor ID above.
      </p>

      <h2>Third-party games and services</h2>
      <ul>
        <li>
          <strong>Supabase</strong> hosts our database and handles sign-in. Your account data and scores are
          stored there.
        </li>
        <li>
          <strong>Embedded games:</strong> some games are hosted on other websites and shown inside our page.
          Those sites have their own privacy policies and may collect data while you play them.
        </li>
        <li>
          <strong>Fonts and media</strong> are loaded from content delivery services (such as Google Fonts),
          which receive your IP address as part of delivering the files.
        </li>
      </ul>

      <h2>How we use information</h2>
      <p>
        Only to run the site: to sign you in, save your progress, show leaderboards, keep the service secure
        and improve the games. We don't sell your data and we don't use it for advertising profiles.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Account data and scores are kept while your account exists. Anonymous usage statistics are kept in
        aggregate form to show long-term trends.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>Play as a guest, with nothing stored about you on our side.</li>
        <li>Clear this site's data in your browser to remove guest scores and the visitor ID.</li>
        <li>
          Ask us to access, correct or delete your account data and scores. Depending on where you live (for
          example the EU/UK under GDPR, or California under CCPA) you may have additional rights, which we
          will respect.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        Our games are suitable for all ages, but accounts are not intended for children under 13. If you
        believe a child has created an account, contact us and we will delete it.
      </p>

      <h2>Changes</h2>
      <p>
        If we change how we handle data, we will update this page and the date at the top.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests about your data: contact Senevon Game Studio through the details on our{" "}
        <Link to="/#studio">studio page</Link>.
      </p>
    </article>
  );
}
