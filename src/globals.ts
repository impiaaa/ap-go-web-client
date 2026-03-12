import { Client, type NetworkItem } from "archipelago.js";
import type { APGoSlotData } from "./types";

export const DATAPACKAGE_KEY = "datapackage_cache";
export const PREFS_KEY = "connection_info";
export const SAVED_GAME_KEY = "saved_game";
export const DEFAULT_PAGE = "connect";

export let home: [number, number] | null = null;
export function setHome(new_home: [number, number]) {
  home = new_home;
}
export let slot_data: APGoSlotData | null = null;
export function setSlotData(new_slot_data: APGoSlotData) {
  slot_data = new_slot_data;
}
export const client = new Client();
export let points: Record<number, maplibregl.LngLatLike> = {};
export function clearPoints() {
  points = {};
}
export const cheat = !!localStorage.getItem("cheat");
export let scouted_locations: Record<number, NetworkItem> = {};
export function setScoutedLocations(
  new_locations: Record<number, NetworkItem>,
) {
  scouted_locations = new_locations;
}
