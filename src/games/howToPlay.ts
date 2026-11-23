/* "How to play" tutorials for every built-in game, keyed by engine. Shown from the "?" icon in
   the game page's icon bar (src/components/HowToPlay.tsx). Keep each step short: a title and one
   or two lines. `controls` is the summary card at the end. */

export type HowStep = { icon: string; title: string; text: string };
export type HowTo = { steps: HowStep[]; controls: string[] };

export const HOW_TO_PLAY: Record<string, HowTo> = {
  tictactoe: {
    steps: [
      { icon: "❌", title: "You are X", text: "You move first. Tap any empty square to place your X." },
      { icon: "⭕", title: "The CPU answers", text: "The computer places its O straight after your move. It plays well, so watch its threats." },
      { icon: "🏁", title: "Three in a row", text: "Line up three Xs across, down or diagonally to win. A full board with no line is a draw." },
      { icon: "⭐", title: "Points", text: "Win 120 · draw 75 · loss 35." },
    ],
    controls: ["Tap a square to play", "Block the CPU's two-in-a-row before building your own"],
  },
  memory: {
    steps: [
      { icon: "🃏", title: "Flip two tiles", text: "Tap a tile to see its picture, then tap a second one." },
      { icon: "🧠", title: "Remember", text: "If they match they stay open. If not, they flip back, so remember where each picture was." },
      { icon: "🏁", title: "Clear the board", text: "Find every pair. Fewer moves means a higher score." },
    ],
    controls: ["Tap a tile to flip it", "Each pair of flips counts as one move"],
  },
  reflex: {
    steps: [
      { icon: "🎯", title: "Targets appear", text: "A target pops up somewhere on the board for about a second." },
      { icon: "👆", title: "Tap it fast", text: "Tap it before it vanishes. There are 12 targets in a round." },
      { icon: "⭐", title: "Points", text: "15 points for every target you hit." },
    ],
    controls: ["Tap or click the target", "Keep your eyes on the middle of the board"],
  },
  simon: {
    steps: [
      { icon: "👀", title: "Watch", text: "The pads light up in a sequence. Watch the order." },
      { icon: "🔁", title: "Play it back", text: "Tap the pads in the same order." },
      { icon: "📈", title: "It grows", text: "Each round adds one more step. One wrong tap ends the game." },
      { icon: "⭐", title: "Points", text: "25 points for every step you remembered." },
    ],
    controls: ["Tap the pads in order", "Say the colours out loud to remember longer sequences"],
  },
  "2048": {
    steps: [
      { icon: "↔️", title: "Slide the tiles", text: "Swipe (or use the arrow keys) to slide every tile as far as it goes." },
      { icon: "➕", title: "Merge equals", text: "Two tiles with the same number join into one: 2 + 2 = 4, 4 + 4 = 8…" },
      { icon: "🆕", title: "A new tile each move", text: "A 2 or 4 appears after every move. When no move is possible, the game ends." },
      { icon: "🏆", title: "Chase 2048", text: "Your score is the total of every merge. Reach the 2048 tile if you can." },
    ],
    controls: ["Swipe or arrow keys to slide", "Keep your biggest tile in a corner"],
  },
  minesweeper: {
    steps: [
      { icon: "💣", title: "10 hidden mines", text: "The 8 × 8 field hides 10 mines. Reveal every safe cell to win." },
      { icon: "🔢", title: "Read the numbers", text: "A number tells you how many mines touch that cell, including diagonals." },
      { icon: "🚩", title: "Flag mines", text: "Switch on flag mode and tap a cell to mark a mine, so you don't open it by mistake." },
      { icon: "⏱️", title: "Be quick", text: "One wrong tap ends the run. Your best is your fastest win." },
    ],
    controls: ["Tap a cell to reveal it", "Flag mode: tap to place or remove a flag"],
  },
  hangman: {
    steps: [
      { icon: "🔤", title: "Guess letters", text: "Tap letters to guess the hidden word." },
      { icon: "❤️", title: "Six lives", text: "Every wrong letter costs a life. Lose all six and it's over." },
      { icon: "⭐", title: "Points", text: "Each solved word scores 50, plus 10 for every life you have left." },
    ],
    controls: ["Tap a letter to guess it", "Start with common letters: E, A, R, S, T"],
  },
  quiz: {
    steps: [
      { icon: "❓", title: "Five questions", text: "Logic and trivia, one question at a time." },
      { icon: "👆", title: "Pick an answer", text: "Tap the answer you think is right. You see straight away if you got it." },
      { icon: "⭐", title: "Score", text: "Every correct answer adds to your score." },
    ],
    controls: ["Tap an answer"],
  },
  math: {
    steps: [
      { icon: "➗", title: "Solve the sum", text: "A quick arithmetic problem appears. Type or tap the answer." },
      { icon: "⏱️", title: "12 seconds each", text: "The bar drains while you think. Answer before it empties." },
      { icon: "🔥", title: "8 rounds", text: "Faster correct answers score more. Keep the streak alive." },
    ],
    controls: ["Type the answer and press Enter", "Watch the timer bar"],
  },
  word: {
    steps: [
      { icon: "⌨️", title: "Type the word", text: "A word appears. Type it exactly as shown." },
      { icon: "⏱️", title: "7 seconds", text: "The timer bar drains for each word. Finish before it runs out." },
      { icon: "⭐", title: "Score", text: "Every word typed correctly in time adds points." },
    ],
    controls: ["Type, then press Enter", "Spelling must be exact"],
  },
  "higher-lower": {
    steps: [
      { icon: "🔢", title: "See the number", text: "A number is shown. Will the next one be higher or lower?" },
      { icon: "⬆️", title: "Make your call", text: "Tap Higher or Lower." },
      { icon: "🔥", title: "Build a streak", text: "Each right call grows your streak. One wrong call ends it. 30 points per correct guess." },
    ],
    controls: ["Tap Higher or Lower", "Numbers near the edges are the safest calls"],
  },
  "whack-a-mole": {
    steps: [
      { icon: "🐹", title: "Moles pop up", text: "Moles appear in the 9 holes, only for a moment." },
      { icon: "🔨", title: "Whack them", text: "Tap a mole before it ducks back down." },
      { icon: "⏱️", title: "20 seconds", text: "Hit as many as you can. 20 points per mole." },
    ],
    controls: ["Tap the mole"],
  },
  "color-match": {
    steps: [
      { icon: "🎨", title: "Find the odd one", text: "One tile is a slightly different shade. Tap it." },
      { icon: "⏱️", title: "Beat the timer", text: "Each level gives you a few seconds, a little less every level." },
      { icon: "📈", title: "Harder each level", text: "The difference gets smaller as you climb. A wrong tap or running out of time ends the game." },
    ],
    controls: ["Tap the odd shade", "Tilt your screen away from glare"],
  },
  "sliding-puzzle": {
    steps: [
      { icon: "🔢", title: "Put them in order", text: "Arrange the tiles 1 to 8 in order, with the gap in the bottom-right corner." },
      { icon: "↔️", title: "Slide into the gap", text: "Tap a tile next to the empty space to slide it in." },
      { icon: "⏱️", title: "Fastest solve", text: "The clock starts on your first move. Your best is your fastest solve." },
    ],
    controls: ["Tap a tile beside the gap", "Solve the top row first, then the rest"],
  },
  snake: {
    steps: [
      { icon: "🐍", title: "Steer", text: "Swipe, or use the arrow keys or WASD, to turn the snake." },
      { icon: "🍎", title: "Eat to grow", text: "Each fruit makes you longer and adds to your score. You speed up as you grow." },
      { icon: "💥", title: "Don't crash", text: "Hitting a wall or your own body ends the game." },
    ],
    controls: ["Swipe or arrow keys / WASD", "Leave yourself room to turn"],
  },
  stack: {
    steps: [
      { icon: "🧱", title: "Drop the slab", text: "A slab slides back and forth. Tap (or press Space) to drop it on the tower." },
      { icon: "✂️", title: "Overhang falls off", text: "Any part that misses the block below is sliced away, so your slab gets narrower." },
      { icon: "✨", title: "Perfect drops", text: "Land it almost exactly for a perfect. Three perfects in a row widen the slab again." },
      { icon: "🏆", title: "Score", text: "Your score is the tower's height." },
    ],
    controls: ["Tap or Space to drop"],
  },
  dodge: {
    steps: [
      { icon: "🚀", title: "Fly your ship", text: "Drag, or use the arrow keys or A / D, to move left and right." },
      { icon: "☄️", title: "Avoid meteors", text: "Meteors rain down faster and faster. One hit ends the run." },
      { icon: "⭐", title: "Score", text: "10 points per second survived, plus 5 for every near miss." },
    ],
    controls: ["Drag or arrow keys / A, D", "Skim past meteors for near-miss bonuses"],
  },
  "connect-four": {
    steps: [
      { icon: "🔴", title: "Drop a disc", text: "Tap a column to drop your disc. It falls to the lowest free spot." },
      { icon: "🟡", title: "The CPU replies", text: "The computer drops its own disc after each of yours." },
      { icon: "🏁", title: "Four in a row", text: "Connect four across, down or diagonally to win. Winning in fewer moves scores higher." },
    ],
    controls: ["Tap a column", "Take the middle column early"],
  },
  "lights-out": {
    steps: [
      { icon: "💡", title: "Turn them all off", text: "Some lights on the 5 × 5 grid are on. Switch every one of them off." },
      { icon: "✳️", title: "Each tap flips five", text: "Tapping a light flips it and the lights above, below, left and right of it." },
      { icon: "⭐", title: "Fewer moves", text: "Every puzzle can be solved. Fewer moves means a higher score." },
    ],
    controls: ["Tap a light", "Work row by row: clear one row by tapping the row below it"],
  },
  arrows: {
    steps: [
      { icon: "➡️", title: "Send arrows out", text: "Tap an arrow to send it off the board in the direction it points." },
      { icon: "🚧", title: "Only if the way is clear", text: "If another arrow is in its path, it bumps and you lose a life. You have three." },
      { icon: "🧩", title: "Clear the maze", text: "Remove every arrow to finish the level. Levels get bigger and trickier." },
      { icon: "💡", title: "Hints", text: "Stuck? A hint shows a safe arrow. You get free hints every level, and more in the Shop." },
      { icon: "⚔️", title: "Online race", text: "Online, both players get the same board: clear it first to win." },
    ],
    controls: ["Tap an arrow to move it", "Look for arrows with nothing in front of them"],
  },
  chess: {
    steps: [
      { icon: "♟️", title: "Pick a mode", text: "Play the CPU on three levels, a friend on the same device, or rated games online with a clock." },
      { icon: "👆", title: "Move a piece", text: "Tap a piece to see where it can go, then tap a highlighted square." },
      { icon: "👑", title: "Checkmate wins", text: "Trap the enemy king so it can't escape check. Stalemate and repetition are draws." },
      { icon: "♜", title: "Special moves", text: "Castling, en passant and pawn promotion all work as in real chess." },
      { icon: "⏱️", title: "Online", text: "Online games have a clock. Win for XP and a token; a loss costs some XP." },
    ],
    controls: ["Tap a piece, then a square", "Control the centre, develop pieces, castle early"],
  },
  ludo: {
    steps: [
      { icon: "🎲", title: "Roll the dice", text: "Tap the dice on your turn. You need a 6 to bring a token out of your yard." },
      { icon: "🏃", title: "Move a token", text: "Tap the token to move. Race all four around the board and up your home column." },
      { icon: "💥", title: "Capture", text: "Land on a rival token to send it back to its yard. Start squares and stars are safe." },
      { icon: "🔁", title: "Extra rolls", text: "A 6, a capture or reaching home gives another roll. Three 6s in a row lose the turn." },
      { icon: "🏠", title: "Get home first", text: "You need an exact roll to reach home. Bring all four tokens home to win." },
    ],
    controls: ["Tap the dice, then a token", "Play vs CPU, with friends on one device, or online"],
  },
  carrom: {
    steps: [
      { icon: "🎯", title: "Place the striker", text: "Slide the striker along your baseline (or A / D). It must cover an end circle fully or not touch it." },
      { icon: "🏹", title: "Aim and shoot", text: "Drag on the board to aim: pull back like a slingshot, or point where it should go. Release to shoot." },
      { icon: "⚪", title: "Pot your coins", text: "Pot all nine of your colour. Potting one of yours gives you another shot." },
      { icon: "👑", title: "Cover the queen", text: "Pot the red queen, then pot one of your coins on the next shot to keep it." },
      { icon: "⚠️", title: "Fouls", text: "Potting the striker is a foul: one of your coins goes back on the board." },
    ],
    controls: ["Slide to place · drag to aim · release to shoot", "Arrow keys fine-tune, Space shoots"],
  },
  blackjack: {
    steps: [
      { icon: "🪙", title: "Place a bet", text: "Bet free chips (never tokens), then deal." },
      { icon: "🃏", title: "Get close to 21", text: "Cards 2–10 count face value, J/Q/K count 10, an Ace counts 1 or 11." },
      { icon: "✋", title: "Hit or stand", text: "Hit for another card or stand to keep your total. Go over 21 and you bust." },
      { icon: "✌️", title: "Double and split", text: "Double your bet for exactly one more card, or split a pair into two hands." },
      { icon: "🏆", title: "Beat the dealer", text: "The dealer draws to 17. Higher total wins 1:1; a blackjack pays 3:2; ties push." },
    ],
    controls: ["Bet · Hit · Stand · Double · Split", "Stand on 17+, hit on 11 or less"],
  },
  pool: {
    steps: [
      { icon: "🎱", title: "Aim", text: "Drag on the table to point the cue. Use the fine-aim strip for tiny adjustments." },
      { icon: "💪", title: "Power and shoot", text: "Pull the power bar, then let go to shoot." },
      { icon: "🌀", title: "Spin", text: "Tap the cue-ball icon to hit it high (follow), low (draw) or to the side." },
      { icon: "🟡", title: "Pot your group", text: "The first ball potted after the break decides solids or stripes. Pot all of yours." },
      { icon: "⚫", title: "Then the 8", text: "Pot the 8 last to win. Potting it early, or scratching on it, loses the frame." },
    ],
    controls: ["Drag to aim · pull the bar to shoot", "Hit your own group first, or it's a foul"],
  },
};

export const howToFor = (engine: string | undefined) => (engine ? HOW_TO_PLAY[engine] ?? null : null);
