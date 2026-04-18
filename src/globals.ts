import { Client, type NetworkItem } from "archipelago.js";
import { type APGoSlotData, GameState, ItemType } from "./types";

export const DATAPACKAGE_KEY = "datapackage_cache";
export const PREFS_KEY = "connection_info";
export const SAVED_GAME_KEY = "saved_game";
export const DEFAULT_PAGE = "connect";

export const SCOUTING_DISTANCE_BASE = 30;
export const SCOUTING_DISTANCE_INCREMENT = 15;
export const COLLECTION_DISTANCE_BASE = 20;
export const COLLECTION_DISTANCE_INCREMENT = 10;
export const SHORT_MACGUFFIN_ITEMS = [
  ItemType.MacguffinA,
  ItemType.MacguffinP,
  ItemType.MacguffinHyphen,
  ItemType.MacguffinG,
  ItemType.MacguffinO,
  ItemType.MacguffinExclamation,
];
export const LONG_MACGUFFIN_ITEMS = [
  ItemType.MacguffinA,
  ItemType.MacguffinR,
  ItemType.MacguffinC,
  ItemType.MacguffinH,
  ItemType.MacguffinI,
  ItemType.MacguffinP,
  ItemType.MacguffinE,
  ItemType.MacguffinL,
  ItemType.MacguffinA2,
  ItemType.MacguffinHyphen,
  ItemType.MacguffinG,
  ItemType.MacguffinO,
  ItemType.MacguffinExclamation,
];

export let home: [number, number] | null = null;
export function setHome(new_home: [number, number]) {
  home = new_home;
}
export let slot_data: APGoSlotData | null = null;
export function setSlotData(new_slot_data: APGoSlotData) {
  slot_data = new_slot_data;
}
export const client = new Client();
export let points: Record<string, maplibregl.LngLatLike> = {};
export function setPoints(new_points: Record<string, maplibregl.LngLatLike>) {
  points = new_points;
}
export const cheat = !!localStorage.getItem("cheat");
export let scouted_locations: Record<number, NetworkItem> = {};
export function setScoutedLocations(
  new_locations: Record<number, NetworkItem>,
) {
  scouted_locations = new_locations;
}
export let game_state: GameState = GameState.Disconnected;
export function setGameState(new_state: GameState) {
  game_state = new_state;
}
