# Senevon Games — Android app

The Android app is the same React site, packaged with Capacitor (`com.senevon.games`).
The whole site ships inside the app, so built-in games play offline; online features
(matches, leaderboards, shop, tokens) need a connection.

## Build and run

Needs: Node, Android Studio (or the Android SDK) and **Java 21** (Gradle doesn't run on Java 25 yet).

```bash
npm run build:app          # web build for the app (no AdSense)
npx cap sync android       # copy it into android/
npm run android            # build:app + sync, then open Android Studio (Run ▶ on a phone/emulator)
```

From the command line (Windows), with Java 21:

```bash
set JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot
npm run android:apk        # → android/app/build/outputs/apk/debug/app-debug.apk
```

Icons / splash come from `resources/` (`npm run app:assets` regenerates all sizes).

## One-time setup

### 1. Supabase
1. Run `supabase/play.sql` in the SQL Editor (after `tokens.sql` and `adfree.sql`).
2. Auth → URL Configuration → **Redirect URLs**: add `com.senevon.games://auth/callback`
   (Google sign-in in the app returns there).
3. Deploy the functions:
   ```bash
   supabase functions deploy play-billing
   supabase functions deploy admob-ssv --no-verify-jwt
   ```

### 2. Google Play Console
1. Create the app with package name `com.senevon.games`.
2. **Upload key** (keep it safe — you need it for every update):
   ```bash
   keytool -genkeypair -v -keystore senevon-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   Put it next to `android/` and create `android/keystore.properties` (never commit either):
   ```
   storeFile=../senevon-upload.jks
   storePassword=…
   keyAlias=upload
   keyPassword=…
   ```
   Release bundle: Android Studio → Build → Generate Signed App Bundle, or
   `cd android && gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`.
3. **Products** (Monetize → Products). IDs must match exactly:

   | Type | Product ID | Base plans | Gives |
   |---|---|---|---|
   | In-app (consumable) | `tokens_starter` | — | Starter pack |
   | In-app | `tokens_player` | — | Player pack |
   | In-app | `tokens_pro` | — | Pro pack |
   | In-app | `tokens_legend` | — | Legend pack |
   | Subscription | `senevon_plus` | `monthly`, `yearly` | 5,000 tokens / month |
   | Subscription | `adfree_monthly` | `monthly` | No ads |

   Token amounts come from `token_packs` in Supabase. Until a product exists, its button shows "Soon".
4. **Service account** (lets the server check purchases): Google Cloud → create a service account →
   JSON key → Play Console → Users and permissions → invite its email with *View financial data* and
   *Manage orders and subscriptions*. Then:
   ```bash
   supabase secrets set GOOGLE_PLAY_SERVICE_ACCOUNT="$(cat service-account.json)"
   ```
5. Optional, recommended — renewals while the app is closed: Play Console → Monetization setup →
   Real-time developer notifications → a Pub/Sub topic with a push subscription to
   `https://<project>.supabase.co/functions/v1/play-billing?rtdn=<random-key>`, and
   `supabase secrets set PLAY_RTDN_KEY=<random-key>`.
6. Test purchases: add tester accounts (License testing) and use an internal-testing release.

### 3. AdMob
Until this is done the app uses **Google's test ads** (safe while developing).
1. AdMob → add the app → create three ad units: Banner, Interstitial, Rewarded.
2. App id → `android/app/src/main/res/values/strings.xml` (`admob_app_id`).
3. Ad unit ids → `.env.app` (not committed):
   ```
   VITE_ADMOB_BANNER=ca-app-pub-…/…
   VITE_ADMOB_INTERSTITIAL=ca-app-pub-…/…
   VITE_ADMOB_REWARDED=ca-app-pub-…/…
   ```
4. Rewarded unit → **Server-side verification** → callback URL
   `https://<project>.supabase.co/functions/v1/admob-ssv`. Tokens for watching are credited only
   through this signed callback (same daily cap as the website).
5. Before release, fill in the Play Console *Data safety* form (ads + purchases) and add a consent
   message (AdMob → Privacy & messaging) for players in the EU/UK.

## How the app behaves

- **Offline:** free games work; premium (token) games show "Connect to play"; online menus show an
  offline notice. Scores, XP and boosters used offline are queued on the phone and sent when the
  connection returns (server limits still apply).
- **Purchases:** never credited on the phone — `play-billing` checks each one with Google, checks it
  belongs to the signed-in player, credits it once, then acknowledges it. Packs are consumed only
  after the server has credited them; anything left open is retried on the next app start.
- **Ads:** a banner at the bottom while a page with an ad slot is open, an interstitial after every
  3rd finished game (never mid-game), rewarded ads for tokens. Ad-free players see none.
- **Sign-in:** Google sign-in opens in an in-app browser tab and returns by deep link.

## iOS (later)
Needs a Mac with Xcode: `npm i @capacitor/ios && npx cap add ios`, then App Store products and
StoreKit on the server side (the client billing plugin already supports iOS).
