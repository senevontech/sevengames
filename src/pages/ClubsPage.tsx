/* /clubs and /clubs/:tag: community clubs (lib/clubs.ts, supabase/clans.sql).
   Not in a club: find one (public clubs, or any club by its ID), open an invite link, or start one.
   In a club: club rooms, the club wallet, members, and (for the owner) settings. */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, Copy, Crown, DoorOpen, Globe, Lock, LogOut, Search, Settings, Shield, Users, Wallet } from "../components/anim-icons";
import { useAuthContext } from "../context/AuthContext";
import { useTokens } from "../lib/tokens";
import {
  CLUB,
  CLUB_GAMES,
  clubApi,
  clubErrorText,
  clubLink,
  clubSearch,
  clubTagText,
  clubView,
  setMyClub,
  useMyClub,
  type ClubCard,
  type ClubGame,
  type ClubView,
  type MyClub,
} from "../lib/clubs";
import TokenIcon from "../components/TokenIcon";
import PlayerAvatar from "../components/PlayerAvatar";
import "./account.css";
import "./tokens-page.css";
import "./clubs.css";

type Note = { ok: boolean; text: string } | null;

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ac-btn ac-btn-sm"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1600);
          },
          () => {},
        )
      }
    >
      {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      {done ? "Copied" : label}
    </button>
  );
}

const Vis = ({ v }: { v: "public" | "private" }) => (
  <span className={`cl-vis is-${v}`}>
    {v === "public" ? <Globe size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />}
    {v === "public" ? "Public" : "Private · invite only"}
  </span>
);

export default function ClubsPage() {
  const { tag } = useParams();
  const { user } = useAuthContext();
  const { club, loaded, error } = useMyClub();
  const [note, setNote] = useState<Note>(null);

  return (
    <div className="acct cl">
      <section className="ac-card cl-hero">
        <span className="cl-hero-icon" aria-hidden="true">
          <Users size={28} />
        </span>
        <div>
          <h1>Clubs</h1>
          <p className="ac-sub">
            Play with your crew. Clubs have {CLUB.minMembers} to {CLUB.maxMembers} members, their own rooms and a shared chip wallet run by the owner.
          </p>
        </div>
      </section>

      {note ? (
        <p className={`tw-note${note.ok ? " ok" : " bad"}`} role="status">
          {note.ok ? <Check size={16} aria-hidden="true" /> : null}
          {note.text}
        </p>
      ) : null}
      {error ? <p className="tw-note bad">{error}</p> : null}

      {tag && !(club && club.tag === tag.toUpperCase()) ? <ClubInvite tag={tag} hasClub={Boolean(club)} setNote={setNote} /> : null}

      {!user ? (
        <section className="ac-card cl-signin">
          <p>Sign in to join or start a club.</p>
          <Link className="ac-btn ac-btn-primary" to={`/login?next=${encodeURIComponent(tag ? `/clubs/${tag}` : "/clubs")}`}>
            Sign in
          </Link>
        </section>
      ) : !loaded ? (
        <div className="page-loading" role="status" aria-label="Loading" />
      ) : club ? (
        <MyClubView club={club} setNote={setNote} />
      ) : (
        <CreateClub setNote={setNote} />
      )}

      {!club ? <FindClubs setNote={setNote} /> : null}
    </div>
  );
}

/* ---------------- not in a club ---------------- */

/** A club opened by its link (/clubs/K7Q2MX?invite=…). */
function ClubInvite({ tag, hasClub, setNote }: { tag: string; hasClub: boolean; setNote: (n: Note) => void }) {
  const [params] = useSearchParams();
  const { uid } = useMyClub();
  const [c, setC] = useState<ClubView | null | undefined>(undefined);
  const [invite, setInvite] = useState(params.get("invite") ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    clubView(tag)
      .then((v) => live && setC(v))
      .catch(() => live && setC(null));
    return () => {
      live = false;
    };
  }, [tag]);

  if (c === undefined) return null;
  if (c === null)
    return (
      <section className="ac-card">
        <p>No club has the ID {clubTagText(tag.toUpperCase())}.</p>
      </section>
    );

  async function join() {
    if (!uid || !c) return;
    setBusy(true);
    try {
      setMyClub(uid, await clubApi.join(c.tag, invite));
      setNote({ ok: true, text: `Welcome to ${c.name}!` });
    } catch (e) {
      setNote({ ok: false, text: clubErrorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ac-card cl-invite">
      <ClubHead c={c} />
      {c.about ? <p className="cl-about">{c.about}</p> : null}
      {c.member_list ? <MemberFaces list={c.member_list} /> : null}
      {c.banned ? (
        <p className="ac-sub">You can't join this club.</p>
      ) : c.full ? (
        <p className="ac-sub">This club is full.</p>
      ) : hasClub ? (
        <p className="ac-sub">You're in another club. Leave it first to join this one.</p>
      ) : uid ? (
        <div className="cl-row">
          {c.visibility === "private" ? (
            <input className="cl-input cl-code" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} placeholder="Invite code" maxLength={8} aria-label="Invite code" />
          ) : null}
          <button type="button" className="ac-btn ac-btn-primary" disabled={busy || (c.visibility === "private" && invite.length !== 8)} onClick={() => void join()}>
            Join club
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ClubHead({ c, children }: { c: ClubCard; children?: ReactNode }) {
  return (
    <div className="cl-head">
      <span className="cl-badge" aria-hidden="true">
        {c.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="cl-head-text">
        <h2>{c.name}</h2>
        <p>
          <span className="cl-tag">{clubTagText(c.tag)}</span>
          <Vis v={c.visibility} />
          <span>
            {c.members}/{CLUB.maxMembers} members
          </span>
        </p>
      </div>
      {children}
    </div>
  );
}

function MemberFaces({ list }: { list: { user_id: string; name: string; avatar: MyClub["member_list"][number]["avatar"] }[] }) {
  return (
    <div className="cl-faces">
      {list.slice(0, 12).map((m) => (
        <PlayerAvatar key={m.user_id} id={m.user_id} name={m.name} avatar={m.avatar} size={30} className="lb-initial" />
      ))}
      {list.length > 12 ? <span className="cl-more">+{list.length - 12}</span> : null}
    </div>
  );
}

function FindClubs({ setNote }: { setNote: (n: Note) => void }) {
  const { uid } = useMyClub();
  const [q, setQ] = useState("");
  const [list, setList] = useState<ClubCard[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<Record<string, string>>({});

  const search = async (text: string) => {
    try {
      setList(await clubSearch(text));
    } catch (e) {
      setList([]);
      setNote({ ok: false, text: clubErrorText(e) });
    }
  };
  useEffect(() => {
    void search("");
  }, []);

  async function join(c: ClubCard) {
    if (!uid) return;
    setBusy(c.id);
    try {
      setMyClub(uid, await clubApi.join(c.tag, invite[c.id]));
      setNote({ ok: true, text: `Welcome to ${c.name}!` });
    } catch (e) {
      setNote({ ok: false, text: clubErrorText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="tw-section">
      <div className="ac-section-head">
        <div>
          <h2 className="ac-h2">Find a club</h2>
          <p className="ac-sub">Search public clubs by name, or any club by its ID (like #K7Q2MX).</p>
        </div>
      </div>
      <form
        className="cl-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <Search size={16} aria-hidden="true" />
        <input className="cl-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Club name or #ID" aria-label="Search clubs" />
        <button type="submit" className="ac-btn ac-btn-sm">
          Search
        </button>
      </form>
      {list === null ? null : list.length === 0 ? (
        <p className="ac-sub">No clubs found. Start one!</p>
      ) : (
        <ul className="cl-list">
          {list.map((c) => (
            <li key={c.id} className="ac-card cl-item">
              <ClubHead c={c} />
              {c.about ? <p className="cl-about">{c.about}</p> : null}
              <div className="cl-row">
                <Link className="ac-btn ac-btn-sm" to={`/clubs/${c.tag}`}>
                  Open
                </Link>
                {uid ? (
                  <>
                    {c.visibility === "private" ? (
                      <input
                        className="cl-input cl-code"
                        value={invite[c.id] ?? ""}
                        onChange={(e) => setInvite({ ...invite, [c.id]: e.target.value.toUpperCase() })}
                        placeholder="Invite code"
                        maxLength={8}
                        aria-label={`Invite code for ${c.name}`}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="ac-btn ac-btn-sm ac-btn-primary"
                      disabled={busy === c.id || c.members >= CLUB.maxMembers || (c.visibility === "private" && (invite[c.id] ?? "").length !== 8)}
                      onClick={() => void join(c)}
                    >
                      {c.members >= CLUB.maxMembers ? "Full" : "Join"}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VisPicker({ value, onChange }: { value: "public" | "private"; onChange: (v: "public" | "private") => void }) {
  return (
    <div className="cl-seg" role="radiogroup" aria-label="Who can join">
      {(["public", "private"] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "is-on" : ""} onClick={() => onChange(v)}>
          {v === "public" ? <Globe size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
          {v === "public" ? "Public: anyone can join" : "Private: invite only"}
        </button>
      ))}
    </div>
  );
}

function CreateClub({ setNote }: { setNote: (n: Note) => void }) {
  const { uid } = useMyClub();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [vis, setVis] = useState<"public" | "private">("public");
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!uid) return;
    setBusy(true);
    try {
      const c = await clubApi.create(name, about, vis);
      setMyClub(uid, c);
      setNote({ ok: true, text: `${name.trim()} is ready. Its club ID is ${c ? clubTagText(c.tag) : ""}. Invite at least 2 more players to open the club wallet.` });
    } catch (err) {
      setNote({ ok: false, text: clubErrorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ac-card cl-create">
      <h2 className="ac-h2">Start a club</h2>
      <p className="ac-sub">Free. You'll be the owner. Names don't have to be unique: every club gets its own club ID.</p>
      <form onSubmit={(e) => void create(e)} className="cl-form">
        <label>
          Club name
          <input className="cl-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={CLUB.nameMax} required minLength={3} />
        </label>
        <label>
          About <small>(optional)</small>
          <textarea className="cl-input" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={CLUB.aboutMax} rows={2} />
        </label>
        <VisPicker value={vis} onChange={setVis} />
        <button type="submit" className="ac-btn ac-btn-primary" disabled={busy || name.trim().length < 3}>
          Create club
        </button>
      </form>
    </section>
  );
}

/* ---------------- in a club ---------------- */

function useAct(setNote: (n: Note) => void) {
  const { uid } = useMyClub();
  const { refresh } = useTokens();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, run: () => Promise<MyClub | null>, ok?: string, chips = false) => {
    if (!uid) return false;
    setBusy(key);
    try {
      setMyClub(uid, await run());
      if (ok) setNote({ ok: true, text: ok });
      if (chips) void refresh();
      return true;
    } catch (e) {
      setNote({ ok: false, text: clubErrorText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, act, uid };
}

function MyClubView({ club, setNote }: { club: MyClub; setNote: (n: Note) => void }) {
  const owner = club.role === "owner";
  const { reload } = useMyClub();
  // keep rooms and the wallet fresh while the page is open
  useEffect(() => {
    const id = window.setInterval(() => void reload(), 30_000);
    return () => window.clearInterval(id);
  }, [reload]);

  const link = clubLink(club.tag, club.visibility === "private" ? club.invite_code : null);
  const forming = club.members < CLUB.minMembers;

  return (
    <>
      <section className="ac-card cl-mine">
        <ClubHead c={club}>{owner ? <span className="cl-owner"><Crown size={14} aria-hidden="true" /> Owner</span> : null}</ClubHead>
        {club.about ? <p className="cl-about">{club.about}</p> : null}
        {forming ? (
          <p className="cl-forming">
            Forming: {club.members}/{CLUB.minMembers} members. Invite {CLUB.minMembers - club.members} more to open the club wallet.
          </p>
        ) : null}
        <div className="cl-share">
          {club.visibility === "private" ? (
            owner && club.invite_code ? (
              <>
                <span>
                  Invite code <b className="cl-tag">{club.invite_code}</b>
                </span>
                <CopyButton text={link} label="Copy invite link" />
              </>
            ) : (
              <span className="ac-sub">Private club: ask the owner for an invite link.</span>
            )
          ) : (
            <>
              <span>Anyone can join with the club ID.</span>
              <CopyButton text={link} label="Copy club link" />
            </>
          )}
        </div>
      </section>

      <ClubRooms club={club} setNote={setNote} />
      <ClubWallet club={club} setNote={setNote} />
      <ClubMembers club={club} setNote={setNote} />
      {owner ? <ClubSettings club={club} setNote={setNote} /> : <LeaveClub setNote={setNote} />}
    </>
  );
}

function ClubRooms({ club, setNote }: { club: MyClub; setNote: (n: Note) => void }) {
  const { busy, act, uid } = useAct(setNote);
  const navigate = useNavigate();
  const [game, setGame] = useState<ClubGame>("chess");
  const [code, setCode] = useState("");
  const mine = club.rooms.find((r) => r.user_id === uid);

  return (
    <section className="tw-section">
      <div className="ac-section-head">
        <div>
          <h2 className="ac-h2">
            <DoorOpen size={18} aria-hidden="true" /> Club rooms
          </h2>
          <p className="ac-sub">
            Open a room in a game, post its code here and club members can jump in. Rooms disappear after {CLUB.roomMinutes} minutes.
          </p>
        </div>
      </div>
      {club.rooms.length ? (
        <ul className="cl-rooms">
          {club.rooms.map((r) => (
            <li key={r.user_id} className="ac-card">
              <span>
                <b>{CLUB_GAMES[r.game] ?? r.game}</b>
                <small>
                  {r.user_id === uid ? "You" : r.name} · {ago(r.created_at)}
                </small>
              </span>
              <span className="cl-tag">{r.code}</span>
              {r.user_id === uid ? (
                <button type="button" className="ac-btn ac-btn-sm" disabled={busy === "clear"} onClick={() => void act("clear", clubApi.clearRoom)}>
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  className="ac-btn ac-btn-sm ac-btn-primary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(r.code).catch(() => {});
                    navigate(`/game/${r.game}`);
                  }}
                  title={`Copies ${r.code}: choose Online, then join with the code`}
                >
                  Join · copy code
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ac-sub cl-empty">No open rooms right now.</p>
      )}
      <form
        className="cl-row cl-post"
        onSubmit={(e) => {
          e.preventDefault();
          void act("post", () => clubApi.postRoom(game, code), "Posted. Club members can see your room now.").then((ok) => ok && setCode(""));
        }}
      >
        <select className="cl-input" value={game} onChange={(e) => setGame(e.target.value as ClubGame)} aria-label="Game">
          {Object.entries(CLUB_GAMES).map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        <input
          className="cl-input cl-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          placeholder="Room code"
          maxLength={4}
          aria-label="Room code"
        />
        <button type="submit" className="ac-btn ac-btn-sm" disabled={code.length !== 4 || busy === "post"}>
          {mine ? "Update my room" : "Post my room"}
        </button>
      </form>
      <p className="ac-sub cl-hint">
        Friend rooms can have a chip match entry; the host sets it in the room. <Link to="/chips#chip-math">How chip matches work</Link>
      </p>
    </section>
  );
}

function ClubWallet({ club, setNote }: { club: MyClub; setNote: (n: Note) => void }) {
  const { busy, act } = useAct(setNote);
  const { wallet } = useTokens();
  const owner = club.role === "owner";
  const [give, setGive] = useState("10");
  const [to, setTo] = useState(club.member_list[0]?.user_id ?? "");
  const [pay, setPay] = useState("10");
  const [why, setWhy] = useState("");
  const left = Math.max(0, club.give_cap - club.given_today);
  const earned = wallet?.earned ?? 0;
  const g = Math.floor(Number(give));
  const p = Math.floor(Number(pay));
  const toName = useMemo(() => club.member_list.find((m) => m.user_id === to)?.name ?? "", [club.member_list, to]);

  return (
    <section className="tw-section">
      <div className="ac-section-head">
        <div>
          <h2 className="ac-h2">
            <Wallet size={18} aria-hidden="true" /> Club wallet
          </h2>
          <p className="ac-sub">Members put earned chips in; the owner decides how they're spent. Chips put in can't be taken back.</p>
        </div>
      </div>
      <div className="ac-card cl-wallet">
        <div className="cl-balance">
          <TokenIcon size={30} />
          <b>{club.wallet.toLocaleString()}</b>
          <small>in the club wallet</small>
        </div>
        {!club.wallet_open ? (
          <p className="cl-forming">Opens when the club has {CLUB.minMembers} members.</p>
        ) : (
          <>
            <form
              className="cl-row"
              onSubmit={(e) => {
                e.preventDefault();
                void act("give", () => clubApi.give(g), `You put ${g} chips in the club wallet.`, true);
              }}
            >
              <input className="cl-input cl-num" type="number" inputMode="numeric" min={1} max={Math.min(left, earned)} value={give} onChange={(e) => setGive(e.target.value)} aria-label="Chips to put in" />
              <button type="submit" className="ac-btn ac-btn-sm ac-btn-primary" disabled={busy === "give" || !(g >= 1) || g > Math.min(left, earned) || !club.old_enough}>
                Put in
              </button>
              <small className="cl-fine">
                {!club.old_enough
                  ? "Your account needs to be 3 days old."
                  : `You have ${earned.toLocaleString()} earned chips · ${left} left today (shared with gifts)`}
              </small>
            </form>
            {owner ? (
              <form
                className="cl-row cl-pay"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("pay", () => clubApi.pay(to, p, why), `Paid ${p} chips to ${toName}.`, true).then((ok) => ok && setWhy(""));
                }}
              >
                <span className="cl-fine">Pay a member</span>
                <select className="cl-input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Member">
                  {club.member_list.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}
                      {m.role === "owner" ? " (you)" : ""}
                    </option>
                  ))}
                </select>
                <input className="cl-input cl-num" type="number" inputMode="numeric" min={1} max={club.wallet} value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Chips to pay" />
                <input className="cl-input" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={80} placeholder="Note (optional)" aria-label="Note" />
                <button type="submit" className="ac-btn ac-btn-sm" disabled={busy === "pay" || !(p >= 1) || p > club.wallet || !to}>
                  Pay
                </button>
              </form>
            ) : null}
          </>
        )}
        {club.log.length ? (
          <ul className="cl-log">
            {club.log.map((l) => (
              <li key={l.id}>
                <span>
                  {l.kind === "deposit" ? (
                    <>
                      <b>{l.from ?? "A player"}</b> put chips in
                    </>
                  ) : (
                    <>
                      Paid to <b>{l.to ?? "a player"}</b>
                      {l.note ? <em> · {l.note}</em> : null}
                    </>
                  )}
                  <small>{ago(l.at)}</small>
                </span>
                <b className={l.kind === "deposit" ? "plus" : "minus"}>
                  {l.kind === "deposit" ? "+" : "−"}
                  {l.amount}
                </b>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function ClubMembers({ club, setNote }: { club: MyClub; setNote: (n: Note) => void }) {
  const { busy, act, uid } = useAct(setNote);
  const owner = club.role === "owner";
  const [open, setOpen] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);

  return (
    <section className="tw-section">
      <div className="ac-section-head">
        <div>
          <h2 className="ac-h2">
            <Users size={18} aria-hidden="true" /> Members · {club.members}/{CLUB.maxMembers}
          </h2>
        </div>
      </div>
      <ul className="cl-members">
        {club.member_list.map((m) => (
          <li key={m.user_id} className="ac-card">
            <div className="cl-member">
              <PlayerAvatar id={m.user_id} name={m.name} avatar={m.avatar} size={34} className="lb-initial" />
              <span>
                <Link to={`/player/${m.user_id}`}>{m.user_id === uid ? `${m.name} (you)` : m.name}</Link>
                <small>
                  {m.role === "owner" ? "Owner · " : ""}
                  {m.given ? `put in ${m.given}` : "member"}
                </small>
              </span>
              {owner && m.user_id !== uid ? (
                <button type="button" className="ac-btn ac-btn-sm" aria-expanded={open === m.user_id} onClick={() => (setOpen(open === m.user_id ? null : m.user_id), setSure(null))}>
                  <Shield size={14} aria-hidden="true" /> Manage
                </button>
              ) : null}
            </div>
            {open === m.user_id ? (
              <div className="cl-row cl-manage">
                {sure === `transfer:${m.user_id}` ? (
                  <button type="button" className="ac-btn ac-btn-sm ac-btn-primary" disabled={Boolean(busy)} onClick={() => void act("x", () => clubApi.transfer(m.user_id), `${m.name} owns the club now.`)}>
                    Yes, make {m.name} the owner
                  </button>
                ) : (
                  <button type="button" className="ac-btn ac-btn-sm" onClick={() => setSure(`transfer:${m.user_id}`)}>
                    <Crown size={14} aria-hidden="true" /> Make owner
                  </button>
                )}
                <button type="button" className="ac-btn ac-btn-sm" disabled={Boolean(busy)} onClick={() => void act("x", () => clubApi.remove(m.user_id, false), `${m.name} was removed.`)}>
                  Remove
                </button>
                <button type="button" className="ac-btn ac-btn-sm cl-danger" disabled={Boolean(busy)} onClick={() => void act("x", () => clubApi.remove(m.user_id, true), `${m.name} was removed and banned.`)}>
                  Remove and ban
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {owner && club.bans?.length ? (
        <div className="cl-bans">
          <p className="ac-sub">Banned</p>
          {club.bans.map((b) => (
            <span key={b.user_id} className="cl-ban">
              {b.name}
              <button type="button" className="ac-btn ac-btn-sm" disabled={Boolean(busy)} onClick={() => void act("x", () => clubApi.unban(b.user_id), `${b.name} can join again.`)}>
                Unban
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ClubSettings({ club, setNote }: { club: MyClub; setNote: (n: Note) => void }) {
  const { busy, act } = useAct(setNote);
  const [name, setName] = useState(club.name);
  const [about, setAbout] = useState(club.about);
  const [vis, setVis] = useState(club.visibility);
  const [sure, setSure] = useState<"close" | "leave" | null>(null);
  const alone = club.members <= 1;

  return (
    <section className="tw-section">
      <div className="ac-section-head">
        <h2 className="ac-h2">
          <Settings size={18} aria-hidden="true" /> Club settings
        </h2>
      </div>
      <div className="ac-card cl-form">
        <label>
          Club name
          <input className="cl-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={CLUB.nameMax} />
        </label>
        <label>
          About
          <textarea className="cl-input" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={CLUB.aboutMax} rows={2} />
        </label>
        <VisPicker value={vis} onChange={setVis} />
        <div className="cl-row">
          <button
            type="button"
            className="ac-btn ac-btn-primary ac-btn-sm"
            disabled={busy === "save" || name.trim().length < 3}
            onClick={() => void act("save", () => clubApi.update(name, about, vis), "Saved.")}
          >
            Save
          </button>
          {club.visibility === "private" ? (
            <button type="button" className="ac-btn ac-btn-sm" disabled={busy === "inv"} onClick={() => void act("inv", clubApi.newInvite, "New invite code made. The old one no longer works.")}>
              New invite code
            </button>
          ) : null}
        </div>
        <div className="cl-row cl-end">
          {sure === "close" ? (
            <>
              <span className="cl-fine">
                Close {club.name} for everyone?{club.wallet > 0 ? ` The ${club.wallet} chips in the club wallet go to you.` : ""} This can't be undone.
              </span>
              <button type="button" className="ac-btn ac-btn-sm cl-danger" disabled={busy === "close"} onClick={() => void act("close", clubApi.close, "The club is closed.", true)}>
                Yes, close it
              </button>
              <button type="button" className="ac-btn ac-btn-sm" onClick={() => setSure(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ac-btn ac-btn-sm cl-danger" onClick={() => setSure("close")}>
                Close club
              </button>
              {!alone ? <span className="cl-fine">To leave, make another member the owner first (Members → Manage).</span> : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function LeaveClub({ setNote }: { setNote: (n: Note) => void }) {
  const { busy, act } = useAct(setNote);
  const [sure, setSure] = useState(false);
  return (
    <div className="cl-row cl-end cl-leave">
      {sure ? (
        <>
          <span className="cl-fine">Leave the club? Chips you put in stay in the club wallet.</span>
          <button type="button" className="ac-btn ac-btn-sm cl-danger" disabled={busy === "leave"} onClick={() => void act("leave", clubApi.leave, "You left the club.")}>
            Yes, leave
          </button>
          <button type="button" className="ac-btn ac-btn-sm" onClick={() => setSure(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="ac-btn ac-btn-sm" onClick={() => setSure(true)}>
          <LogOut size={14} aria-hidden="true" /> Leave club
        </button>
      )}
    </div>
  );
}
