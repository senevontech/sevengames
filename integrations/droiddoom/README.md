# Connecting DroidDoom to Senevon accounts

DroidDoom runs on its own site (droiddoom.onrender.com), not inside Senevon. Senevon still keeps
the player's account, the payments (tokens, Senevon Plus) and the record of what they've unlocked.

- **Opening DroidDoom from Senevon** opens DroidDoom's site with the player already signed in with
  their Senevon account, using a one-time code that works once, within 60 seconds.
  - On Android phones and in the Senevon app, Senevon first asks **Open in app / Open in web**.
    "Open in app" opens the DroidDoom app, or its Google Play page when it isn't installed.
  - On computers and iPhones, DroidDoom opens straight away in a new tab.
- **Visiting DroidDoom directly** works too. Players can use **Sign in with Senevon**, or play
  signed out with only the free items.
- **Senevon Plus, Pro and unlimited accounts** have every DroidDoom item unlocked.
- **Everyone else** can buy items one at a time with Senevon tokens, from a small purchase box in
  the game.

## 1. Senevon side (this repo)

Run in Supabase → SQL Editor:
1. `supabase/shop.sql`, re-run so the shop accepts the DroidDoom item types.
2. `supabase/droiddoom.sql`, which adds the items and the `droiddoom_state` / `droiddoom_buy` functions.
3. `supabase/game_signin.sql`, which adds the one-time sign-in codes.

Then deploy the sign-in function. It has to accept calls from players who aren't signed in yet,
hence the flag:
```
supabase functions deploy game-signin --no-verify-jwt
```
It accepts calls from `https://droiddoom.onrender.com` by default. To allow more sites, set
`GAME_SIGNIN_ORIGINS` (comma-separated) with `supabase secrets set`.

The items in `droiddoom.sql` are placeholders. Replace them with the game's real ones, keeping the
`dd:` prefix there, for example `dd:weapon_plasma`. The game uses the same ids without the prefix,
for example `Senevon.has_item("weapon_plasma")`. Prices are in tokens and can be changed any time
in Admin → Tokens.

## 2. DroidDoom side (the Godot project)

1. **Settings.** Open `senevon-account.js` and fill in Senevon's **public** Supabase address and
   anon key, from Senevon's `.env`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key
   is meant to be public. Never use the service-role key here.
2. **Copy** `senevon-account.js` into the folder you deploy, next to `index.html`.
3. **HTML shell.** In Godot, go to Project → Export → Web → HTML → Head Include and paste:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js"></script>
   <script src="senevon-account.js"></script>
   ```
4. **Autoload.** Add `senevon.gd` as an autoload named `Senevon` (Project Settings → Globals → Autoload).
5. **Use it in the game.**
   ```gdscript
   func _ready():
       Senevon.state_changed.connect(_refresh_locks)
       Senevon.purchase_finished.connect(_on_purchase)
       _refresh_locks()

   func _refresh_locks():
       premium_levels_button.disabled = not Senevon.has_item("levels_premium")
       plasma_button.text = "Equip" if Senevon.has_item("weapon_plasma") else "Unlock"
       sign_in_button.visible = not Senevon.signed_in

   func _on_plasma_pressed():
       if Senevon.has_item("weapon_plasma"):
           equip("weapon_plasma")
       else:
           Senevon.buy("weapon_plasma", "Plasma gun")   # shows the purchase box

   func _on_sign_in_pressed():
       Senevon.sign_in()   # goes to Senevon and comes back signed in

   func _on_purchase(item: String, ok: bool, reason: String):
       if ok:
           _refresh_locks()
   ```
   - Ask `Senevon.has_item()` each session and don't save unlocks in `profile.json`. Senevon is
     the record, so unlocks follow the player to other devices and end when Plus ends.
   - Keep progress, such as the levels a player has finished, saving locally as it does now.
   - After a player buys Plus or tokens on Senevon in another tab, the game checks again as soon
     as they come back to its tab.

## 3. Later: the DroidDoom Android app

Senevon already offers "Open in app" for package `com.senevon.droiddoom` with link scheme
`droiddoom` (`src/catalog.ts`). Until the app exists, "Open in app" leads to its Play Store page.
When you build the app:
- Use that package name, or change it in Senevon's `src/catalog.ts` and
  `android/app/src/main/AndroidManifest.xml` (`<queries>`).
- Give its main activity an intent filter for `droiddoom://open` with the
  `android.intent.category.BROWSABLE` category, so browsers and Senevon can open it.
- When Senevon opens it, the link may carry `#senevon_code=…`. Send that code to the
  `game-signin` function exactly as `senevon-account.js` does, so the player arrives signed in.
- In-app purchases in a Play Store app must use Google Play Billing. Senevon's `play-billing`
  function already verifies Play purchases, and can be extended to accept the DroidDoom app's
  purchases and record them in the same place.

## Testing locally

- In the Godot editor or a desktop build nothing is connected, so only free items work. Set
  `DEV_UNLOCK_ALL := true` in `senevon.gd` to test locked content; it has no effect in web builds.
- To test the sign-in hand-off against a local DroidDoom server, add its address to
  `GAME_SIGNIN_ORIGINS`.

## Limits

DroidDoom has no server of its own and runs on the player's device. Someone who edits the game in
their browser's developer tools could still unlock items for themselves. Money and tokens are safe
regardless: they only move on Senevon's server. If DroidDoom ever gets online play or a
leaderboard, check unlocks on the server at that point.
