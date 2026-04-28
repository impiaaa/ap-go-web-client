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

// TODO: timeout is also used in prioritization
export const DEFAULT_OVERPASS_QUERY = `[out:json][timeout:180][maxsize:{{maxsize}}][bbox:{{bbox}}];
(
  (
    way[highway=footway](around:{{maximum_distance}},{{center}});
    way[highway=living_street](around:{{maximum_distance}},{{center}});
    way[highway=path](around:{{maximum_distance}},{{center}});
    way[highway=pedestrian](around:{{maximum_distance}},{{center}});
    way[highway=platform](around:{{maximum_distance}},{{center}});
    way[highway=primary](around:{{maximum_distance}},{{center}});
    way[highway=primary_link](around:{{maximum_distance}},{{center}});
    way[highway=residential](around:{{maximum_distance}},{{center}});
    way[highway=secondary](around:{{maximum_distance}},{{center}});
    way[highway=secondary_link](around:{{maximum_distance}},{{center}});
    way[highway=service](around:{{maximum_distance}},{{center}});
    way[highway=steps](around:{{maximum_distance}},{{center}});
    way[highway=tertiary](around:{{maximum_distance}},{{center}});
    way[highway=tertiary_link](around:{{maximum_distance}},{{center}});
    way[highway=track](around:{{maximum_distance}},{{center}});
    way[highway=unclassified](around:{{maximum_distance}},{{center}});
    way[leisure=track](around:{{maximum_distance}},{{center}});
    way[man_made=pier](around:{{maximum_distance}},{{center}});
    way[railway=platform](around:{{maximum_distance}},{{center}});
  );
  -
  (
    way[access=agricultural](around:{{maximum_distance}},{{center}});
    way[access=customers](around:{{maximum_distance}},{{center}});
    way[access=delivery](around:{{maximum_distance}},{{center}});
    way[access=destination](around:{{maximum_distance}},{{center}});
    way[access=discouraged](around:{{maximum_distance}},{{center}});
    way[access=forestry](around:{{maximum_distance}},{{center}});
    way[access=no](around:{{maximum_distance}},{{center}});
    way[access=permit](around:{{maximum_distance}},{{center}});
    way[access=private](around:{{maximum_distance}},{{center}});
    way[access=unknown](around:{{maximum_distance}},{{center}});
    way[access=use_sidepath](around:{{maximum_distance}},{{center}});
    way[foot=agricultural](around:{{maximum_distance}},{{center}});
    way[foot=customers](around:{{maximum_distance}},{{center}});
    way[foot=delivery](around:{{maximum_distance}},{{center}});
    way[foot=destination](around:{{maximum_distance}},{{center}});
    way[foot=discouraged](around:{{maximum_distance}},{{center}});
    way[foot=forestry](around:{{maximum_distance}},{{center}});
    way[foot=no](around:{{maximum_distance}},{{center}});
    way[foot=permit](around:{{maximum_distance}},{{center}});
    way[foot=private](around:{{maximum_distance}},{{center}});
    way[foot=unknown](around:{{maximum_distance}},{{center}});
    way[foot=use_sidepath](around:{{maximum_distance}},{{center}});
    way[sidewalk=separate](around:{{maximum_distance}},{{center}});
  );
);
(
  ._;
  way[highway][foot=designated](around:{{maximum_distance}},{{center}});
  way[highway][foot=permissive](around:{{maximum_distance}},{{center}});
  way[highway][foot=yes](around:{{maximum_distance}},{{center}});
);
(
  ._;
  >;
);
out skel qt;`;

export const prefs: {
  home: [number, number] | null;
  overpass_server: string;
  overpass_query: string;
} = {
  home: null,
  overpass_query: DEFAULT_OVERPASS_QUERY,
  overpass_server: "https://overpass.private.coffee/api/interpreter",
};
export let slot_data: APGoSlotData | null = null;
export function setSlotData(new_slot_data: APGoSlotData) {
  slot_data = new_slot_data;
}
export const client = new Client();
export const game_data: {
  displayed_trap_locations: [string, number][];
  points: Map<number, [number, number]>;
  scouted_locations: Map<number, NetworkItem>;
} = {
  displayed_trap_locations: [],
  points: new Map<number, [number, number]>(),
  scouted_locations: new Map<number, NetworkItem>(),
};
export const cheat = !!localStorage.getItem("cheat");
export let game_state: GameState = GameState.Disconnected;
export function setGameState(new_state: GameState) {
  game_state = new_state;
}
export let generator_internal: Internal | null = null;
export function setGeneratorInternal(new_data: Internal) {
  generator_internal = new_data;
}
