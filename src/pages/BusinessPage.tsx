/* /business: Senevon Interactive, custom games and gamified marketing for organisations.
   The enquiry form saves to business_enquiries (supabase/engagement.sql); the admin panel lists them. */
import { useEffect, useState } from "react";
import { Building2, Check, GraduationCap, Megaphone, PartyPopper, Puzzle, Sparkles, Trophy } from "../components/anim-icons";
import { engagementErrorText, submitEnquiry } from "../lib/engagement";
import "./account.css";
import "./business.css";

const SERVICES = [
  { icon: Sparkles, title: "Branded games", text: "Games built around your brand, colours and products." },
  { icon: Megaphone, title: "Promotional campaigns", text: "Interactive games that drive sign-ups, footfall and social shares." },
  { icon: PartyPopper, title: "Corporate gaming events", text: "Team games and live leaderboards for employee engagement and events." },
  { icon: Puzzle, title: "Gamified marketing", text: "Quizzes, spin-the-wheel, puzzles and contests for your audience." },
  { icon: Trophy, title: "Custom game development", text: "Browser games made for your exact needs, on any device." },
];

const PRICES = [
  { name: "Basic branded game", price: "₹5,000", note: "One of our games in your branding" },
  { name: "Custom promotional game", price: "₹15,000", note: "A game designed for your campaign" },
  { name: "Advanced gaming campaign", price: "₹30,000+", note: "Multiple games, leaderboards, prizes" },
  { name: "Monthly gaming solution", price: "Custom", note: "Ongoing games, events and support" },
];

const FOR = ["Schools & colleges", "Companies", "Marketing agencies", "Event organisers", "E-commerce brands"];

export default function BusinessPage() {
  const [f, setF] = useState({ name: "", org: "", email: "", phone: "", service: "", budget: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    document.title = "Senevon Interactive: games for business";
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await submitEnquiry(f);
      setSent(true);
    } catch (error) {
      setErr(engagementErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acct biz">
      <section className="ac-card biz-hero">
        <span className="biz-kicker">
          <Building2 size={16} aria-hidden="true" /> Senevon Interactive
        </span>
        <h1>Games that work for your business</h1>
        <p className="ac-sub">
          Branded games, gamified marketing and team events, from the studio behind Senevon Games. Built for the web, so people play instantly on any phone or laptop.
        </p>
        <a className="ac-btn ac-btn-primary" href="#enquire">
          Get a quote
        </a>
      </section>

      <section>
        <h2 className="ac-h2">What we make</h2>
        <ul className="biz-services">
          {SERVICES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="ac-card">
              <Icon size={22} aria-hidden="true" />
              <b>{title}</b>
              <p className="ac-sub">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="ac-card">
        <h2 className="ac-h2">Starting prices</h2>
        <ul className="biz-prices">
          {PRICES.map((p) => (
            <li key={p.name}>
              <div>
                <b>{p.name}</b>
                <small>{p.note}</small>
              </div>
              <strong>{p.price}</strong>
            </li>
          ))}
        </ul>
        <p className="ac-sub">Prices depend on the project. Tell us what you need and we'll send a quote.</p>
      </section>

      <section className="ac-card biz-for">
        <GraduationCap size={20} aria-hidden="true" />
        <p>
          <b>Made for</b> {FOR.join(" · ")}
        </p>
      </section>

      <section className="ac-card" id="enquire">
        <h2 className="ac-h2">Tell us about your project</h2>
        {sent ? (
          <p className="tw-note ok" role="status">
            <Check size={16} aria-hidden="true" /> Thanks! We've got your enquiry and will reply by email soon.
          </p>
        ) : (
          <form className="biz-form" onSubmit={(e) => void submit(e)}>
            <label>
              Your name *
              <input required value={f.name} onChange={set("name")} autoComplete="name" maxLength={120} />
            </label>
            <label>
              Organisation
              <input value={f.org} onChange={set("org")} autoComplete="organization" maxLength={160} />
            </label>
            <label>
              Email *
              <input required type="email" value={f.email} onChange={set("email")} autoComplete="email" maxLength={200} />
            </label>
            <label>
              Phone
              <input type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" maxLength={40} />
            </label>
            <label>
              Service
              <select value={f.service} onChange={set("service")}>
                <option value="">Not sure yet</option>
                {SERVICES.map((s) => (
                  <option key={s.title}>{s.title}</option>
                ))}
              </select>
            </label>
            <label>
              Budget
              <select value={f.budget} onChange={set("budget")}>
                <option value="">Not sure yet</option>
                <option>Under ₹10,000</option>
                <option>₹10,000–₹30,000</option>
                <option>₹30,000–₹1,00,000</option>
                <option>Above ₹1,00,000</option>
              </select>
            </label>
            <label className="biz-wide">
              What do you need? *
              <textarea required minLength={10} rows={5} value={f.message} onChange={set("message")} maxLength={4000} />
            </label>
            {err ? <p className="tw-note bad biz-wide">{err}</p> : null}
            <button type="submit" className="ac-btn ac-btn-primary biz-wide" disabled={busy}>
              {busy ? "Sending…" : "Send enquiry"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
