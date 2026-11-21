# Senevon account (Godot 4, web export). Add as an autoload named "Senevon"
# (Project → Project Settings → Globals → Autoload). Needs supabase-js and senevon-account.js
# in the HTML shell (see README.md).
#
#   Senevon.state_changed            → re-check unlocks (sign-in, Plus, a purchase)
#   Senevon.has_item("weapon_plasma") → can the player use it?
#   Senevon.is_all_access()           → Senevon Plus / Pro / unlimited: everything unlocked
#   Senevon.buy("weapon_plasma", "Plasma gun") → purchase box; answer in purchase_finished
#   Senevon.sign_in()                 → "Sign in with Senevon" (comes back signed in)
#   Senevon.open_page("plus")         → "plus" | "tokens": opens Senevon in a new tab
#
# Outside the web build (editor, desktop) nothing is connected: only free items are usable,
# unless DEV_UNLOCK_ALL is on for testing.
extends Node

signal state_changed
signal purchase_finished(item: String, ok: bool, reason: String)

## Editor / desktop testing only: treat everything as unlocked. Never ships in a web build.
const DEV_UNLOCK_ALL := false

var signed_in := false
var all_access := false
var tokens := 0
var owned: PackedStringArray = []
## Everything for sale: [{ "id", "kind", "price", "name" }]
var items: Array = []

var _bridge: JavaScriptObject
# keep the callbacks referenced, or Godot frees them and JS calls into nothing
var _on_state_cb: JavaScriptObject
var _on_purchase_cb: JavaScriptObject


func _ready() -> void:
	if not OS.has_feature("web"):
		return
	_bridge = JavaScriptBridge.get_interface("SenevonAccount")
	if _bridge == null:
		push_warning("Senevon: senevon-account.js is not in the HTML shell")
		return
	_on_state_cb = JavaScriptBridge.create_callback(_on_state)
	_on_purchase_cb = JavaScriptBridge.create_callback(_on_purchase)
	_bridge.onState(_on_state_cb)
	_bridge.onPurchase(_on_purchase_cb)
	_apply(str(_bridge.getState()))


func is_connected_to_senevon() -> bool:
	return _bridge != null


func is_all_access() -> bool:
	return all_access or (DEV_UNLOCK_ALL and not OS.has_feature("web"))


func has_item(id: String) -> bool:
	return is_all_access() or owned.has(id)


func price_of(id: String) -> int:
	for it in items:
		if it.get("id") == id:
			return int(it.get("price", 0))
	return -1


## `display_name` is shown in the purchase box (e.g. "Plasma gun").
func buy(id: String, display_name: String = "") -> void:
	if _bridge == null:
		purchase_finished.emit(id, false, "error")
		return
	_bridge.buy(id, display_name)


func sign_in() -> void:
	open_page("signin")


func sign_out() -> void:
	if _bridge != null:
		_bridge.signOut()


func open_page(page: String) -> void:
	if _bridge != null:
		_bridge.open(page)


func _on_state(args: Array) -> void:
	_apply(str(args[0]))


func _on_purchase(args: Array) -> void:
	var res = JSON.parse_string(str(args[0]))
	if typeof(res) != TYPE_DICTIONARY:
		return
	purchase_finished.emit(str(res.get("item", "")), bool(res.get("ok", false)), str(res.get("reason", "")))


func _apply(json: String) -> void:
	var s = JSON.parse_string(json)
	if typeof(s) != TYPE_DICTIONARY:
		return
	signed_in = bool(s.get("signedIn", false))
	all_access = bool(s.get("allAccess", false))
	tokens = int(s.get("tokens", 0))
	owned = PackedStringArray(s.get("owned", []))
	items = s.get("items", [])
	state_changed.emit()
