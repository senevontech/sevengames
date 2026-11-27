/* The header search's dropdown (GamesNav: desktop search and the phone menu): filter chips
   (All · Games · Players · Clubs · Pages) and the results, grouped by kind. The search itself
   is in lib/siteSearch.ts; the parent owns the query, the filter and the highlighted row. */
import { ArrowRight, Users } from "lucide-react";
import PlayerAvatar from "./PlayerAvatar";
import { KIND_LABEL, SEARCH_FILTERS, type SearchFilter, type SearchItem } from "../lib/siteSearch";
import "./search-panel.css";

type Props = {
  className?: string;
  listId: string;
  query: string;
  filter: SearchFilter;
  onFilter: (f: SearchFilter) => void;
  items: SearchItem[];
  loading: boolean;
  tooShort: boolean;
  hi: number;
  onHi: (i: number) => void;
  onPick: (item: SearchItem) => void;
};

const EMPTY_WHAT: Record<SearchFilter, string> = { all: "Nothing", games: "No games", players: "No players", clubs: "No clubs", pages: "No pages" };

function Lead({ item }: { item: SearchItem }) {
  switch (item.kind) {
    case "game":
      return <span className="gs-r-dot" style={{ background: item.game.accent }} />;
    case "player":
      return <PlayerAvatar id={item.id} name={item.title} avatar={item.avatar} size={26} className="sx-avatar" />;
    case "club":
      return (
        <span className="sx-ico" aria-hidden="true">
          <Users size={14} />
        </span>
      );
    default:
      return (
        <span className="sx-ico" aria-hidden="true">
          <ArrowRight size={14} />
        </span>
      );
  }
}

export default function SearchPanel({ className = "", listId, query, filter, onFilter, items, loading, tooShort, hi, onHi, onPick }: Props) {
  const q = query.trim();
  const grouped = filter === "all" && new Set(items.map((i) => i.kind)).size > 1;

  return (
    <div className={`sx-panel ${className}`.trim()}>
      <div className="sx-chips" role="tablist" aria-label="Search in">
        {SEARCH_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`sx-chip${filter === f.id ? " is-on" : ""}`}
            // keep the focus in the search box (its blur would close an empty search)
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {q ? (
        <ul className="sx-list" id={listId} role="listbox" aria-busy={loading}>
          {items.map((item, i) => (
            <li key={item.key} role="none" className="sx-li">
              {grouped && (i === 0 || items[i - 1].kind !== item.kind) ? <span className="sx-group">{KIND_LABEL[item.kind]}</span> : null}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === hi}
                className={`sx-row${i === hi ? " is-hi" : ""}`}
                onMouseEnter={() => onHi(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(item)}
              >
                <Lead item={item} />
                <span className="gs-r-title">{item.title}</span>
                <span className="gs-r-cat">{item.sub}</span>
              </div>
            </li>
          ))}
          {loading ? (
            <li className="sx-note" role="none">
              Searching…
            </li>
          ) : !items.length ? (
            <li className="sx-note" role="none">
              {tooShort ? "Type 2 or more letters to find players and clubs" : `${EMPTY_WHAT[filter]} match "${q}"`}
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="sx-hint">
          {filter === "players" ? "Find a player by name" : filter === "clubs" ? "Find a club by name or #ID" : filter === "games" ? "Find a game by title or category" : filter === "pages" ? "Jump to a page" : "Search games, players, clubs and pages"}
        </p>
      )}
    </div>
  );
}
