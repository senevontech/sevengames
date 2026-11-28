/* "How to play" tutorials for every built-in game, keyed by engine. Shown from the "?" icon in
   the game page's icon bar (src/components/HowToPlay.tsx). Keep each step short: a title and one
   or two lines. `controls` is the summary card at the end. */

export type HowStep = { icon: string; title: string; text: string };
export type HowTo = { steps: HowStep[]; controls: string[] };

export const HOW_TO_PLAY: Record<string, HowTo> = {
  tictactoe: {
    steps: [
      { icon: "❌", title: "You are X", text: "You move first. Tap any empty square to place your X." },
      { icon: "⭕", title: "Senevi answers", text: "Senevi places his O straight after your move. He plays well, so watch his threats." },
      { icon: "🏁", title: "Three in a row", text: "Line up three Xs across, down or diagonally to win. A full board with no line is a draw." },
      { icon: "⭐", title: "Points", text: "Win 120 · draw 75 · loss 35." },
    ],
    controls: ["Tap a square to play", "Block Senevi's two-in-a-row before building your own"],
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
      { icon: "🚀", title: "Fly and fire", text: "Drag, or use the arrow keys or A / D, to move. Your blaster fires on its own: steer to aim." },
      { icon: "☄️", title: "Meteors and creatures", text: "Rocks, comets, jellies, stingers and the big Eye. Tougher ones take more hits, and they toughen as the run goes on. One hit on your ship ends the run." },
      { icon: "🔋", title: "Upgrade your blaster", text: "Destroyed foes drop capsules; fly into them. P: more damage. W: more laser rows (up to 7). R: faster fire. ★: a special: mega laser, homing missiles, a shield that blocks one hit, or a nova blast." },
      { icon: "⭐", title: "Score", text: "10 per second survived, 5 per near miss, 25 per capsule and points for every kill. Quick kills build a combo (up to ×4)." },
    ],
    controls: ["Drag or arrow keys / A, D", "Blaster fires automatically", "Fly into capsules to upgrade", "Chain kills for a combo"],
  },
  "connect-four": {
    steps: [
      { icon: "🔴", title: "Drop a disc", text: "Tap a column to drop your disc. It falls to the lowest free spot." },
      { icon: "🟡", title: "Senevi replies", text: "Senevi drops his own disc after each of yours." },
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
      { icon: "♟️", title: "Pick a mode", text: "Play Senevi on three levels, a friend on the same device, or rated games online with a clock." },
      { icon: "👆", title: "Move a piece", text: "Tap a piece to see where it can go, then tap a highlighted square." },
      { icon: "👑", title: "Checkmate wins", text: "Trap the enemy king so it can't escape check. Stalemate and repetition are draws." },
      { icon: "♜", title: "Special moves", text: "Castling, en passant and pawn promotion all work as in real chess." },
      { icon: "⏱️", title: "Online", text: "Online games have a clock. Win for XP and a chip; a loss costs some XP." },
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
    controls: ["Tap the dice, then a token", "Play vs Senevi, with friends on one device, or online"],
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
      { icon: "🪙", title: "Place your chips", text: "Put down free table chips (never the Chips you buy), then deal." },
      { icon: "🃏", title: "Get close to 21", text: "Cards 2–10 count face value, J/Q/K count 10, an Ace counts 1 or 11." },
      { icon: "✋", title: "Hit or stand", text: "Hit for another card or stand to keep your total. Go over 21 and you bust." },
      { icon: "✌️", title: "Double and split", text: "Double your chips for exactly one more card, or split a pair into two hands." },
      { icon: "🏆", title: "Beat the dealer", text: "The dealer draws to 17. Higher total wins 1:1; a blackjack pays 3:2; ties push." },
      { icon: "♠️", title: "Call Break", text: "4 players, 13 cards each, spades are trumps. Call how many tricks you'll take; make it to score your call (+0.1 per extra), miss and you lose it. 5 rounds." },
      { icon: "📏", title: "Call Break play", text: "Follow the suit led and beat the best card if you can. Out of that suit? Play a spade. The best spade, else the best card of the suit led, wins the trick." },
    ],
    controls: ["Blackjack: Chips · Hit · Stand · Double · Split", "Call Break: call your tricks, then tap a raised card to play it"],
  },
  pool: {
    steps: [
      { icon: "🎱", title: "Aim", text: "Mouse: point at where to shoot. Touch: tap a spot to aim there, or drag to turn the cue slowly. Use the fine-aim strip for tiny adjustments." },
      { icon: "💪", title: "Power and shoot", text: "Pull the power bar, then let go to shoot." },
      { icon: "🌀", title: "Spin", text: "Tap the cue-ball icon to hit it high (follow), low (draw) or to the side." },
      { icon: "🟡", title: "Pot your group", text: "The first ball potted after the break decides solids or stripes. Pot all of yours." },
      { icon: "⚫", title: "Then the 8", text: "Pot the 8 last to win. Potting it early, or scratching on it, loses the frame." },
      { icon: "⏱️", title: "Endless", text: "Solo against the clock, starting at 60 seconds: +5s for every ball you pot, +10s for 5 potting shots in a row, +15s when you clear the table (then a fresh rack). A scratch costs time." },
    ],
    controls: ["Drag to aim · pull the bar to shoot", "Hit your own group first, or it's a foul"],
  },
  chain: {
    steps: [
      { icon: "🔮", title: "Glass Orbs", text: "Tap to set off a spark. Orbs it touches shatter and their shards break more. Amber orbs blast everything nearby, blue ones fire a bolt across the tray, big ones split in two." },
      { icon: "⚙️", title: "Bead Grid", text: "Each cup holds one bead fewer than it has neighbours. Drop a bead into a full cup and it bursts, sending a bead into every neighbour. Glowing cups are one bead from bursting." },
      { icon: "🁢", title: "Dominoes", text: "Swipe a domino to push it that way (a tap pushes it along its line). Giant dominoes reach further; steel balls roll on into whatever is in their way." },
      { icon: "📅", title: "Daily board", text: "Everyone gets the same board each day. Your first finished run is your official one; play more as practice. Keep your streak going." },
      { icon: "♾️", title: "Endless", text: "Each round has a target. Reach it to go on; the targets grow. One miss ends the run." },
    ],
    controls: ["Tap to set it off · swipe a domino to push it", "Bigger chains score more per piece"],
  },
  lastcard: {
    steps: [
      { icon: "🎯", title: "Match it", text: "Play a card that matches the top card's colour, or its number or symbol. Can't? Draw one card: if it fits you may play it straight away, or keep it." },
      { icon: "⚡", title: "Action cards", text: "Skip: the next player misses a turn. Reverse: play changes direction (with two players it's a skip). +2: the next player takes two and misses a turn." },
      { icon: "🌈", title: "Wilds", text: "A Wild can go on anything: you pick the colour. A Wild +4 also makes the next player take four." },
      { icon: "✋", title: "One card!", text: "When you play your second-last card, tap “One card!” first, or you draw 2 as a penalty." },
      { icon: "🏆", title: "Win", text: "First to play their last card wins, and scores the points left in everyone else's hand (numbers by face value, action cards 20, wilds 50)." },
      { icon: "🧩", title: "House rules", text: "In the ⚙ settings: stack +2/+4 to pass the pile on (on by default), 7 swaps hands and 0 passes them along, jump in with an identical card (vs Senevi), or keep drawing until you can play." },
    ],
    controls: ["Tap a raised card to play it · tap the deck to draw", "Online: 2–4 players, the host deals, 25 s a turn"],
  },
  spacefall: {
    steps: [
      { icon: "🚀", title: "Fly", text: "Move anywhere with WASD or the arrow keys, or drag anywhere on the screen (your finger never covers the ship). Your guns fire on their own." },
      { icon: "🎯", title: "Special weapons", text: "Q fires a salvo of homing missiles, E drops a bomb that wipes out enemy fire, Space is your special: an energy blast, later a laser beam. On a phone, use the round buttons." },
      { icon: "🧬", title: "Evolve", text: "Destroying things and travelling gives XP. Every level makes your ship stronger, and every few levels it evolves: Scout, Fighter, Interceptor, Heavy Assault, Elite Warship, Ultimate Destroyer." },
      { icon: "💎", title: "Pick-ups", text: "Wrecks drop crystals and capsules: weapon upgrades, missiles, shields, repairs, rapid fire, double damage, bombs, combat drones and rare invincibility. Ring colour shows rarity." },
      { icon: "👾", title: "Bosses", text: "Every 5 levels a boss arrives. Shoot its glowing core for double damage, knock out turrets to silence them, and watch for red warning bands before lasers fire." },
      { icon: "🛡️", title: "Survive", text: "Your shield takes hits first and recharges if you avoid damage for a moment. When the hull runs out, the run is over. Space gets more dangerous the further you go." },
    ],
    controls: ["WASD / arrows or drag to fly · Q missiles · E bomb · Space special", "P or Esc pauses · M mutes"],
  },
  snakeladder: {
    steps: [
      { icon: "🎲", title: "Roll", text: "Tap the dice on your turn. Your token walks that many squares, following the numbers: left to right along the bottom row, then back the other way." },
      { icon: "🪜", title: "Ladders", text: "Stop at the foot of a ladder and you climb straight to its top." },
      { icon: "🐍", title: "Snakes", text: "Stop on a snake's head and you slide all the way down to its tail." },
      { icon: "🎯", title: "Exactly 100", text: "You need the exact number to land on 100. Roll too high and you stay where you are." },
      { icon: "🏆", title: "Win", text: "The first player to reach square 100 wins." },
    ],
    controls: ["Tap the dice to roll", "Online: 2–4 players, the host rolls for you after 15 s"],
  },
  tune: {
    steps: [
      { icon: "✏️", title: "Draw", text: "Draw anything on the canvas. When you press Play, a bar sweeps from left to right and plays every line it touches." },
      { icon: "🎵", title: "Higher is higher", text: "Lines near the top play high notes, near the bottom low ones. Notes always snap to the scale, so it stays in tune. A line straight up and down plays a chord." },
      { icon: "🎨", title: "Colours are instruments", text: "Piano, bells, strings, bass and drums. For drums, the height picks the drum: kick at the bottom, then tom, snare, and hi-hat at the top. A thicker pen plays louder." },
      { icon: "🎚️", title: "Make it yours", text: "Change the tempo, the scale (happy, sad, blues, raags), the key, and add a backing beat. Loop it, undo, erase." },
      { icon: "🪞", title: "Mirror and mix", text: "The mirror pen draws a flipped copy of every line, so a phrase gets its answer. In Sound, tap an instrument in the mixer to mute it." },
      { icon: "📅", title: "Daily prompt", text: "Each day has a prompt. Post your song for XP and a streak, listen to everyone else's, like them, or remix one into your own." },
      { icon: "🎸", title: "Music shop", text: "Unlock studio instruments (guitar, sitar, flute, synth, tabla), more beats, world scales and echo with chips. Tap any locked item to hear it first." },
      { icon: "📲", title: "Share", text: "Share makes a short video of your drawing playing, ready for WhatsApp, Instagram and Facebook. Saving and sharing are always free." },
    ],
    controls: ["Draw with mouse or finger · press Play", "Space play · Ctrl+Z undo · 1–5 instruments · E eraser · M mirror · L loop"],
  },
};

export const howToFor = (engine: string | undefined) => (engine ? HOW_TO_PLAY[engine] ?? null : null);
