import type { Internal } from "@pkgs/gen/gen";
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

export const prefs: { home: [number, number] | null; overpass_server: string } =
  {
    home: null,
    overpass_server: "https://overpass.private.coffee/api/interpreter",
  };
export let slot_data: APGoSlotData | null = null;
export function setSlotData(new_slot_data: APGoSlotData) {
  slot_data = new_slot_data;
}
export const client = new Client();
export let points = new Map<number, [number, number]>();
export function setPoints(new_points: Map<number, [number, number]>) {
  points = new_points;
}
export const cheat = !!localStorage.getItem("cheat");
export const scouted_locations = new Map<number, NetworkItem>();
export let game_state: GameState = GameState.Disconnected;
export function setGameState(new_state: GameState) {
  game_state = new_state;
}
export let generator_internal: Internal | null = null;
export function setGeneratorInternal(new_data: Internal) {
  generator_internal = new_data;
}
