/* Senevon account for DroidDoom's web build (runs on DroidDoom's own site).
   Load it in the Godot HTML shell, after supabase-js (see README.md). It:
     1. signs the player in with their Senevon account: automatically when they arrive from
        Senevon (one-time #senevon_code), or with "Sign in with Senevon";
     2. reads what they've unlocked (Senevon Plus / Pro / unlimited = everything) and keeps it fresh;
     3. sells items for Senevon tokens with its own small purchase box.
   The game reads it through senevon.gd (JavaScriptBridge). */
(function () {
  "use strict";

  // ---- settings: Senevon's PUBLIC Supabase address and anon key (from Senevon's .env:
  // VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Never put the service-role key here.
  var SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
  var SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
  var SENEVON_URL = "https://7games.onrender.com";
  var GAME_ID = "droiddoom";
  var PREFIX = "dd:";

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, storageKey: "senevon-auth", detectSessionInUrl: false },
  });

  var state = { signedIn: false, allAccess: false, accessReason: null, owned: [], tokens: 0, items: [] };
  var stateListeners = [];
  var purchaseListeners = [];

  function strip(id) {
    return id.indexOf(PREFIX) === 0 ? id.slice(PREFIX.length) : id;
  }

  function emitState() {
    var json = JSON.stringify(state);
    stateListeners.forEach(function (cb) {
      cb(json);
    });
  }

  function emitPurchase(item, ok, reason) {
    var json = JSON.stringify({ item: item, ok: ok, reason: reason || "" });
    purchaseListeners.forEach(function (cb) {
      cb(json);
    });
  }

  // ---- 1. arriving from Senevon: swap the one-time code for a session ----
  function codeFromUrl() {
    var m = /[#&]senevon_code=([0-9a-f]{64})/.exec(window.location.hash);
    if (!m) return null;
    // remove it from the address bar and history straight away
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return m[1];
  }

  function useCode(code) {
    return fetch(SUPABASE_URL + "/functions/v1/game-signin", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ code: code }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (res) {
        if (!res || !res.token_hash) return null;
        return sb.auth.verifyOtp({ token_hash: res.token_hash, type: "email" });
      })
      .catch(function () {
        return null;
      });
  }

  // ---- 2. what the player has ----
  function loadItems() {
    return sb
      .from("shop_items")
      .select("item_id, kind, price, active, sort")
      .like("item_id", PREFIX + "%")
      .eq("active", true)
      .order("sort")
      .then(function (r) {
        return (r.data || []).map(function (i) {
          return { id: strip(i.item_id), kind: i.kind, price: i.price };
        });
      });
  }

  function refresh() {
    return Promise.all([sb.auth.getSession(), loadItems()]).then(function (res) {
      var session = res[0].data.session;
      state.items = res[1];
      if (!session) {
        state.signedIn = false;
        state.allAccess = false;
        state.accessReason = null;
        state.tokens = 0;
        state.owned = state.items.filter(function (i) { return i.price === 0; }).map(function (i) { return i.id; });
        return emitState();
      }
      return sb.rpc("droiddoom_state").then(function (r) {
        if (r.error || !r.data) return;
        state.signedIn = true;
        state.allAccess = !!r.data.all_access;
        state.accessReason = r.data.access_reason || null;
        state.tokens = r.data.tokens || 0;
        state.owned = (r.data.owned || []).map(strip);
        emitState();
      });
    });
  }

  // ---- 3. buying: a small box over the game ----
  function openSenevon(page) {
    var path = page === "plus" ? "/tokens#plus" : page === "tokens" ? "/tokens#buy" : "/connect/" + GAME_ID;
    if (page === "signin") window.location.assign(SENEVON_URL + path); // comes back signed in
    else window.open(SENEVON_URL + path, "_blank", "noopener");
  }

  function box(html) {
    var el = document.createElement("div");
    el.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.55);font:15px/1.45 system-ui,sans-serif");
    el.innerHTML =
      '<div style="width:min(380px,100%);padding:22px 20px 16px;border-radius:22px;background:#1c1d21;color:#f4f4f6;text-align:center;display:grid;gap:10px">' +
      html + "</div>";
    document.body.appendChild(el);
    return el;
  }

  var BTN = "border:0;border-radius:999px;height:46px;font:inherit;font-weight:700;cursor:pointer;";
  var MAIN = BTN + "background:#ff6a00;color:#fff;";
  var LINK = "border:0;background:none;font:inherit;color:#ff8a3d;cursor:pointer;text-decoration:underline;";
  var MUTED = "border:0;background:none;font:inherit;color:rgba(244,244,246,.6);cursor:pointer;";

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function buy(itemId, name) {
    var item = state.items.filter(function (i) { return i.id === itemId; })[0];
    if (!item) return emitPurchase(itemId, false, "error");
    if (state.allAccess || state.owned.indexOf(itemId) !== -1) return emitPurchase(itemId, true, "");
    var title = esc(name || itemId);
    var price = item.price.toLocaleString();
    var body;
    if (!state.signedIn) {
      body = '<p style="margin:0">Sign in with your Senevon account to buy, and keep it on every device.</p>' +
        '<button data-a="signin" style="' + MAIN + '">Sign in with Senevon</button>';
    } else if (state.tokens < item.price) {
      body = '<p style="margin:0">You have ' + state.tokens.toLocaleString() + " tokens.</p>" +
        '<button data-a="tokens" style="' + MAIN + '">Get tokens</button>';
    } else {
      body = '<p style="margin:0;opacity:.7">You have ' + state.tokens.toLocaleString() + " tokens</p>" +
        '<button data-a="buy" style="' + MAIN + '">Buy for ' + price + " tokens</button>";
    }
    var el = box(
      '<b style="font-size:19px">' + title + "</b>" +
      '<span style="font-weight:700">' + price + " tokens</span>" + body +
      '<p data-err style="margin:0;color:#ff6b6b"></p>' +
      '<p style="margin:0;font-size:13px">Or unlock everything with <button data-a="plus" style="' + LINK + '">Senevon Plus</button></p>' +
      '<button data-a="close" style="' + MUTED + '">Not now</button>'
    );
    el.addEventListener("click", function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
      if (e.target === el || a === "close") {
        el.remove();
        return emitPurchase(itemId, false, state.signedIn ? "cancelled" : "not_signed_in");
      }
      if (a === "signin" || a === "tokens" || a === "plus") return openSenevon(a);
      if (a === "buy") {
        e.target.disabled = true;
        e.target.textContent = "Buying…";
        sb.rpc("droiddoom_buy", { p_item: PREFIX + itemId }).then(function (r) {
          if (r.error) {
            e.target.disabled = false;
            e.target.textContent = "Buy for " + price + " tokens";
            el.querySelector("[data-err]").textContent = /insufficient/.test(r.error.message)
              ? "Not enough tokens." : "Couldn't buy it. Try again.";
            return;
          }
          el.remove();
          refresh().then(function () {
            emitPurchase(itemId, true, "");
          });
        });
      }
    });
  }

  // ---- start ----
  var code = codeFromUrl();
  (code ? useCode(code) : Promise.resolve()).then(refresh);
  sb.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") refresh();
  });
  // back from Senevon (bought Plus or tokens in another tab): check again
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refresh();
  });

  window.SenevonAccount = {
    getState: function () {
      return JSON.stringify(state);
    },
    onState: function (cb) {
      stateListeners.push(cb);
    },
    onPurchase: function (cb) {
      purchaseListeners.push(cb);
    },
    /** Sell an item (id without prefix). `name` is shown in the purchase box. */
    buy: function (item, name) {
      buy(String(item), name ? String(name) : "");
    },
    /** "plus" | "tokens" | "signin" */
    open: function (page) {
      openSenevon(String(page));
    },
    signOut: function () {
      sb.auth.signOut();
    },
    refresh: refresh,
  };
})();
