/* Tokens page → Shop → Chat: every emoji / phrase / sticker pack with a preview and how to get it. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import TokenIcon from "../TokenIcon";
import { useShop } from "../../lib/shop";
import { useTokens } from "../../lib/tokens";
import { formatTokens } from "../../lib/currency";
import { useChatPacks } from "../../lib/chatPacks";
import { ChatItemView, usePackAccess } from "./ChatKit";

export default function ChatPackShop() {
  const packs = useChatPacks();
  const access = usePackAccess();
  const shop = useShop();
  const { wallet } = useTokens();
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const balance = wallet?.unlimited ? Infinity : wallet?.balance ?? 0;

  async function buy(id: string, name: string) {
    if (armed !== id) return setArmed(id);
    setBusy(true);
    setNote(null);
    try {
      await shop.buy(id);
      setNote({ ok: true, text: `${name} unlocked. Use it in online matches and friends chat.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't buy it." });
    } finally {
      setBusy(false);
      setArmed(null);
    }
  }

  return (
    <section className="tw-section shop shop-embedded">
      <p className="ac-sub">Emoji, phrases and stickers to send in online matches, lobbies and friends chat. Buy once, keep forever.</p>
      {note ? (
        <p className={`tw-note${note.ok ? " ok" : " bad"}`} role="status">
          {note.ok ? <Check size={16} aria-hidden="true" /> : null}
          {note.text}
        </p>
      ) : null}
      <ul className="shop-grid">
        {packs.map((p) => {
          const st = access(p.id);
          if (st === "off") return null;
          const price = shop.priceOf(p.id) ?? 0;
          return (
            <li key={p.id} className="ac-card shop-card">
              <div className="shop-preview shop-preview-dark cps-preview">
                {p.items.slice(0, p.kind === "phrase" ? 3 : 4).map((it) => (
                  <ChatItemView key={it.id} pack={p} item={it} size="pick" />
                ))}
              </div>
              <h3>{p.name}</h3>
              <p>
                {p.items.length} {p.kind === "phrase" ? "phrases" : p.kind === "emoji" ? "emoji" : "stickers"}
              </p>
              <div className="shop-foot">
                {st === "owned" ? (
                  <span className="shop-status">
                    <Check size={14} aria-hidden="true" /> {price === 0 && !shop.isPlusOnly(p.id) ? "Free" : "Owned"}
                  </span>
                ) : st === "plus" ? (
                  <>
                    <span className="shop-plus">⭐ Plus</span>
                    <Link className="ac-btn ac-btn-sm ac-btn-ghost" to="/chips#plus">
                      Get Plus
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="shop-price">
                      <TokenIcon size={14} /> {formatTokens(price)}
                    </span>
                    {!shop.signedIn ? (
                      <Link className="ac-btn ac-btn-sm ac-btn-ghost" to="/login?next=/chips">
                        Sign in
                      </Link>
                    ) : balance < price ? (
                      <a className="ac-btn ac-btn-sm ac-btn-ghost" href="#buy">
                        Get chips
                      </a>
                    ) : (
                      <button type="button" className={`ac-btn ac-btn-sm ac-btn-primary${armed === p.id ? " is-armed" : ""}`} disabled={busy} onClick={() => void buy(p.id, p.name)}>
                        {armed === p.id ? "Confirm" : "Buy"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
