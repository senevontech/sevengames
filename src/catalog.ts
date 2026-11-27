export type GameCategory =
  | "Strategy"
  | "Puzzle"
  | "Action"
  | "Words"
  | "Numbers"
  | "Classic"
  | "Adventure"
  | "RPG"
  | "Racing"
  | "Sports"
  | "Indie"
  | "Cards"
  | "Music";

export type GameEngine =
  | "tictactoe"
  | "memory"
  | "reflex"
  | "simon"
  | "2048"
  | "minesweeper"
  | "hangman"
  | "quiz"
  | "math"
  | "word"
  | "higher-lower"
  | "whack-a-mole"
  | "color-match"
  | "sliding-puzzle"
  | "snake"
  | "carrom"
  | "stack"
  | "dodge"
  | "connect-four"
  | "lights-out"
  | "arrows"
  | "chess"
  | "ludo"
  | "blackjack"
  | "pool"
  | "chain"
  | "tune"
  | "lastcard"
  | "snakeladder";

export type Game = {
  id: string;
  title: string;
  category: GameCategory;
  difficulty: "Easy" | "Medium" | "Hard";
  minutes: number;
  accent: string;
  description: string;
  /** Optional poster image URL (e.g. "/posters/carrom.webp"). Falls back to a generated poster. */
  poster?: string;
} & (
  | { kind: "builtin"; engine: GameEngine }
  | {
      /** A web game on its own site. It never plays inside Senevon: opening it opens its site
       *  (see lib/externalGames.ts). */
      kind: "iframe";
      embedUrl: string;
      /** Sign the player in on the game's site with their Senevon account when they open it
       *  (one-time code, supabase/game_signin.sql). */
      signIn?: boolean;
      /** The game's own Android app: phones get "Open in app / Open in web". */
      app?: GameApp;
    }
);

export type GameApp = {
  /** Android package name, e.g. "com.senevon.droiddoom". */
  androidPackage: string;
  /** Link scheme the app opens on (its manifest needs a BROWSABLE intent filter for it). */
  scheme: string;
  /** Where to get the app when it isn't installed. */
  playUrl: string;
};

export const categories: Array<GameCategory | "All"> = [
  "All",
  "Action",
  "Adventure",
  "RPG",
  "Racing",
  "Strategy",
  "Sports",
  "Indie",
  "Puzzle",
  "Classic",
  "Cards",
  "Music",
  "Words",
  "Numbers",
];

export const games: Game[] = [
  {
    id: "skyrealm",
    title: "Skyrealm",
    category: "RPG",
    kind: "iframe",
    embedUrl: "https://infitunnel.onrender.com",
    difficulty: "Medium",
    minutes: 15,
    accent: "#ff7a1a",
    poster: "/images/orbit/card_skyrealm.webp",
    description: "Venture across vast floating islands, uncover ancient sky ruins, and master celestial arts in this open world RPG.",
  },
  {
    id: "drift-nexus",
    title: "Drift Nexus",
    category: "Racing",
    kind: "builtin",
    engine: "reflex",
    difficulty: "Hard",
    minutes: 5,
    accent: "#ff3b30",
    poster: "/images/orbit/card_drift_nexus.webp",
    description: "High-octane midnight drift racing. Tune your engine, slide through apexes, and dominate the city tarmac.",
  },
  {
    id: "pixel-craft",
    title: "Pixel Craft",
    category: "Adventure",
    kind: "builtin",
    engine: "stack",
    difficulty: "Medium",
    minutes: 10,
    accent: "#30d158",
    poster: "/images/orbit/card_pixel_craft.webp",
    description: "Mine, craft, and survive in an infinite procedural block-based voxel universe filled with exploration.",
  },
  {
    id: "shadow-tactics",
    title: "Shadow Tactics",
    category: "Strategy",
    kind: "builtin",
    engine: "carrom",
    difficulty: "Hard",
    minutes: 12,
    accent: "#af52de",
    poster: "/images/orbit/card_shadow_tactics.webp",
    description: "Master feudal stealth, outwit patrolling guards from the dark shadows, and execute flawless ninja strikes.",
  },
  {
    id: "void-arena",
    title: "Void Arena",
    category: "Action",
    kind: "builtin",
    engine: "dodge",
    difficulty: "Hard",
    minutes: 8,
    accent: "#0a84ff",
    poster: "/images/orbit/card_void_arena.webp",
    description: "Fast-paced zero-G combat arena. Outplay rival cyber-gladiators with high-tech laser weaponry.",
  },
  {
    id: "yat-c",
    title: "YAT-C",
    category: "Strategy",
    kind: "iframe",
    embedUrl: "https://amarpara.onrender.com",
    difficulty: "Medium",
    minutes: 10,
    accent: "#34c759",
    description: "You And The City. Explore and shape a city of your own.",
  },
  {
    id: "infitunnel",
    title: "Infitunnel",
    category: "Action",
    kind: "iframe",
    embedUrl: "https://infitunnel.onrender.com",
    difficulty: "Hard",
    minutes: 5,
    accent: "#bf5af2",
    description: "An endless tunnel run. Keep going and see how far you can get.",
  },
  {
    id: "publicport",
    title: "PublicPort",
    category: "Classic",
    kind: "iframe",
    embedUrl: "https://pathik-tau.vercel.app/",
    difficulty: "Medium",
    minutes: 10,
    accent: "#ff6b35",
    description: "Drive real metro, train, tram, bus and ferry routes in any city on Earth.",
  },
  {
    id: "droiddoom",
    title: "DroidDoom",
    category: "Action",
    kind: "iframe",
    embedUrl: "https://droiddoom.onrender.com",
    signIn: true,
    // The DroidDoom app isn't published yet: until it is, "Open in app" leads to this Play link.
    app: {
      androidPackage: "com.senevon.droiddoom",
      scheme: "droiddoom",
      playUrl: "https://play.google.com/store/apps/details?id=com.senevon.droiddoom",
    },
    difficulty: "Hard",
    minutes: 10,
    accent: "#ff3b30",
    // Cloudinary resizes it to 480px (about 32 KB instead of 183 KB)
    poster:
      "https://res.cloudinary.com/dr9cpy4uq/image/upload/f_auto,q_auto,w_480/v1795173878/Droiddoom_poster-webp_ikza1w.webp",
    description: "AI has conquered the world. Pilot humanity's last war machine and blast the rogue bots to save mankind.",
  },
  {
    id: "pov-cricket",
    title: "POV Cricket",
    category: "Action",
    kind: "iframe",
    embedUrl: "https://pov-cricket.onrender.com",
    difficulty: "Medium",
    minutes: 5,
    accent: "#0a84ff",
    description: "Cricket from the batter's point of view. Time your shots and score big.",
  },
  {
    id: "noughts",
    title: "Noughts",
    category: "Classic",
    kind: "builtin",
    engine: "tictactoe",
    difficulty: "Easy",
    minutes: 2,
    accent: "#0071e3",
    description: "The timeless three-by-three duel against a sharp opponent.",
  },
  {
    id: "orbit-match",
    title: "Orbit Match",
    category: "Puzzle",
    kind: "builtin",
    engine: "memory",
    difficulty: "Easy",
    minutes: 4,
    accent: "#5e5ce6",
    description: "Flip tiles, find pairs, and clear the board in as few moves as possible.",
  },
  {
    id: "pulse",
    title: "Pulse",
    category: "Action",
    kind: "builtin",
    engine: "reflex",
    difficulty: "Easy",
    minutes: 1,
    accent: "#ff375f",
    description: "Targets appear for a heartbeat. Tap them before they vanish.",
  },
  {
    id: "echo",
    title: "Echo",
    category: "Puzzle",
    kind: "builtin",
    engine: "simon",
    difficulty: "Medium",
    minutes: 3,
    accent: "#bf5af2",
    description: "Watch the sequence, then play it back. It grows every round.",
  },
  {
    id: "merge",
    title: "Merge",
    category: "Numbers",
    kind: "builtin",
    engine: "2048",
    difficulty: "Medium",
    minutes: 10,
    accent: "#ff9f0a",
    description: "Slide tiles, merge equals, and chase the elusive 2048 tile.",
  },
  {
    id: "minefield",
    title: "Minefield",
    category: "Puzzle",
    kind: "builtin",
    engine: "minesweeper",
    difficulty: "Hard",
    minutes: 8,
    accent: "#8e8e93",
    description: "Reveal every safe cell. One wrong tap ends the run.",
  },
  {
    id: "gallows",
    title: "Gallows",
    category: "Words",
    kind: "builtin",
    engine: "hangman",
    difficulty: "Easy",
    minutes: 3,
    accent: "#30d158",
    description: "Guess the hidden word one letter at a time. Six misses and it's over.",
  },
  {
    id: "brainline",
    title: "Brainline",
    category: "Strategy",
    kind: "builtin",
    engine: "quiz",
    difficulty: "Medium",
    minutes: 3,
    accent: "#64d2ff",
    description: "Logic and trivia prompts with instant feedback. Three rounds.",
  },
  {
    id: "number-rush",
    title: "Number Rush",
    category: "Numbers",
    kind: "builtin",
    engine: "math",
    difficulty: "Medium",
    minutes: 2,
    accent: "#32d74b",
    description: "Rapid-fire arithmetic. Answer fast, keep the streak alive.",
  },
  {
    id: "typewave",
    title: "Typewave",
    category: "Words",
    kind: "builtin",
    engine: "word",
    difficulty: "Easy",
    minutes: 2,
    accent: "#ff6482",
    description: "Type the word exactly as shown before the timer drains.",
  },
  {
    id: "skyline",
    title: "Skyline",
    category: "Numbers",
    kind: "builtin",
    engine: "higher-lower",
    difficulty: "Easy",
    minutes: 2,
    accent: "#0a84ff",
    description: "Will the next number be higher or lower? Build the longest streak.",
  },
  {
    id: "mole patrol",
    title: "Mole Patrol",
    category: "Action",
    kind: "builtin",
    engine: "whack-a-mole",
    difficulty: "Easy",
    minutes: 1,
    accent: "#ffd60a",
    description: "Moles pop up fast. Tap them before they duck back down.",
  },
  {
    id: "hue duo",
    title: "Hue Duo",
    category: "Puzzle",
    kind: "builtin",
    engine: "color-match",
    difficulty: "Hard",
    minutes: 2,
    accent: "#ac8e68",
    description: "Tap the odd shade out. The difference shrinks every level.",
  },
  {
    id: "slide",
    title: "Slide",
    category: "Puzzle",
    kind: "builtin",
    engine: "sliding-puzzle",
    difficulty: "Medium",
    minutes: 6,
    accent: "#6c6c70",
    description: "The classic 15-puzzle. Shuffle numbers back into order.",
  },
  {
    id: "serpent",
    title: "Serpent",
    category: "Classic",
    kind: "builtin",
    engine: "snake",
    difficulty: "Medium",
    minutes: 5,
    accent: "#28c840",
    description: "Eat, grow, and never bite yourself. Swipe or arrow keys to steer.",
  },
  {
    id: "carrom",
    title: "Carrom",
    category: "Classic",
    kind: "builtin",
    engine: "carrom",
    difficulty: "Medium",
    minutes: 8,
    accent: "#b3814c",
    description: "Flick the striker, pocket your nine coins, and cover the queen to win.",
  },
  {
    id: "stack",
    title: "Stack",
    category: "Action",
    kind: "builtin",
    engine: "stack",
    difficulty: "Medium",
    minutes: 3,
    accent: "#ff9f0a",
    description: "Drop sliding blocks and build the tallest tower. Misaligned edges get sliced off.",
  },
  {
    id: "dodge",
    title: "Dodge",
    category: "Action",
    kind: "builtin",
    engine: "dodge",
    difficulty: "Medium",
    minutes: 3,
    accent: "#ff375f",
    description: "Blast and weave through meteors, comets and space creatures. Your blaster fires on its own; one hit ends the run.",
  },
  {
    id: "connect-four",
    title: "Connect Four",
    category: "Strategy",
    kind: "builtin",
    engine: "connect-four",
    difficulty: "Medium",
    minutes: 5,
    accent: "#32ade6",
    description: "Line up four discs before Senevi does. Faster wins score higher.",
  },
  {
    id: "lights-out",
    title: "Lights Out",
    category: "Puzzle",
    kind: "builtin",
    engine: "lights-out",
    difficulty: "Hard",
    minutes: 5,
    accent: "#ffd60a",
    description: "Each tap flips a light and its neighbours. Switch them all off in few moves.",
  },
  {
    id: "arrows",
    title: "Arrows",
    category: "Puzzle",
    kind: "builtin",
    engine: "arrows",
    difficulty: "Medium",
    minutes: 5,
    accent: "#ff8a3d",
    description: "Tap an arrow to send it off the board — but only if its way out is clear. Clear the maze, three lives.",
  },
  {
    id: "chess",
    title: "Chess",
    category: "Strategy",
    kind: "builtin",
    engine: "chess",
    difficulty: "Hard",
    minutes: 15,
    accent: "#769656",
    description: "The classic. Play Senevi on three levels, a friend on one device, or rated games online with a clock.",
  },
  {
    id: "ludo",
    title: "Ludo",
    category: "Classic",
    kind: "builtin",
    engine: "ludo",
    difficulty: "Easy",
    minutes: 15,
    accent: "#e53935",
    description: "Roll, race your four tokens home and knock rivals back to base. 2–4 players: Senevi, friends or online.",
  },
  {
    id: "snake-ladder",
    title: "Snake & Ladder",
    category: "Classic",
    kind: "builtin",
    engine: "snakeladder",
    difficulty: "Easy",
    minutes: 10,
    accent: "#4f7838",
    description: "The classic board: roll, climb the ladders, slide down the snakes, and land exactly on 100 to win. 2–4 players: Senevi, friends on one device, or online.",
  },
  {
    id: "blackjack",
    title: "Blackjack & Call Break",
    category: "Cards",
    kind: "builtin",
    engine: "blackjack",
    difficulty: "Easy",
    minutes: 5,
    accent: "#17703f",
    description: "Two card games on a real felt table: beat the dealer to 21 at Blackjack with free table chips, or call your tricks at Call Break against three Senevi players.",
  },
  {
    id: "last-card",
    title: "One Card",
    category: "Cards",
    kind: "builtin",
    engine: "lastcard",
    difficulty: "Easy",
    minutes: 6,
    accent: "#ee4545",
    description: "Match the colour or the symbol, hit them with Skips, Reverses and +2s, and play your last card first. Don't forget to say \u201cOne card!\u201d. vs Senevi, on one device, or online with friends.",
  },
  {
    id: "pool",
    title: "Eight Ball",
    category: "Sports",
    kind: "builtin",
    engine: "pool",
    difficulty: "Medium",
    minutes: 10,
    accent: "#1f7a4a",
    description: "Real-physics eight-ball pool: follow, draw and side spin, rattling pockets. Pot your group, then the 8. vs Senevi, on one device, or online.",
  },
  {
    id: "chain-reaction",
    title: "Chain Reaction",
    category: "Puzzle",
    kind: "builtin",
    engine: "chain",
    difficulty: "Easy",
    minutes: 3,
    accent: "#e0701a",
    description: "One tap, then watch it spread: shatter glass orbs, overflow bead cups, topple lines of dominoes. A new daily board for everyone, and an endless run.",
  },
  {
    id: "draw-a-tune",
    title: "Draw a Tune",
    category: "Music",
    kind: "builtin",
    engine: "tune",
    difficulty: "Easy",
    minutes: 3,
    accent: "#7b5cff",
    description: "Draw anything and press Play: every line becomes music. Each colour is an instrument, higher is higher. Pick a tempo, a scale, a beat. A new prompt every day: post your song, like and remix others.",
  },
];

export function getGame(id: string | undefined): Game | undefined {
  return games.find((game) => game.id === id);
}

export function scoreLabel(game: Game): string {
  if (game.kind === "builtin" && game.engine === "minesweeper") return "Fastest win";
  if (game.kind === "builtin" && game.engine === "sliding-puzzle") return "Fastest solve";
  if (game.kind === "builtin" && game.engine === "memory") return "Best score";
  if (game.kind === "builtin" && game.engine === "carrom") return "Best match";
  return "High score";
}
