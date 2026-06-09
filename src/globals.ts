import { type Internal, SubgraphSelection } from "@pkgs/gen/gen";
import { Client, type NetworkItem } from "archipelago.js";
import { type APGoSlotData, GameState, ItemType } from "./types";

export const DATAPACKAGE_KEY = "datapackage_cache";
export const PREFS_KEY = "connection_info";
export const SAVED_GAME_KEY = "saved_game";
export const DEFAULT_PAGE = "connect";
export const AP_GAME_NAME = "Archipela-Go!";

export const SCOUTING_DISTANCE_BASE_M = 30;
export const SCOUTING_DISTANCE_INCREMENT_M = 15;
export const COLLECTION_DISTANCE_BASE_M = 20;
export const COLLECTION_DISTANCE_INCREMENT_M = 10;
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
const DIALOG_TRAP_ITEMS = [
  // Not just traps, anything that shows a full-screen dialog
  ItemType.PushUpTrap,
  ItemType.SocializingTrap,
  ItemType.SitUpTrap,
  ItemType.JumpingJackTrap,
  ItemType.TouchGrassTrap,
  ItemType.Hydrate,
  ItemType.TakeBreather,
];
const TIMED_TRAP_ITEMS = [
  ItemType.ShuffleTrap,
  ItemType.SilenceTrap,
  ItemType.FogOfWarTrap,
];
export const TRAP_ITEMS = DIALOG_TRAP_ITEMS.concat(TIMED_TRAP_ITEMS);

// NOTE: When updating this, remember to also update OLD_QUERY_DIGESTS below!
export const DEFAULT_OVERPASS_QUERY = `[out:json][timeout:{{timeout}}][maxsize:{{maxsize}}][bbox:{{bbox}}];
(
  way[highway~"^(footway|living_street|path|pedestrian|platform|primary|primary_link|residential|secondary|secondary_link|steps|tertiary|tertiary_link|track|unclassified)$"](around:{{maximum_distance}},{{center}});
  way[highway=service][service=alley](around:{{maximum_distance}},{{center}});
  way[leisure=track](around:{{maximum_distance}},{{center}});
  way[man_made=pier](around:{{maximum_distance}},{{center}});
  way[railway=platform](around:{{maximum_distance}},{{center}});
);
way._
  [access!~"^(agricultural|customers|delivery|destination|discouraged|forestry|no|permit|private|unknown|use_sidepath)$"]
  [foot!~"^(agricultural|customers|delivery|destination|discouraged|forestry|no|permit|private|unknown|use_sidepath)$"]
  [sidewalk!=separate]
  [tunnel!=yes]
;
(
  ._;
  way[highway][foot~"^(designated|permissive|yes)$"][tunnel!=yes](around:{{maximum_distance}},{{center}});
);
(
  ._;
  >;
);
out skel qt;`;
export const OLD_QUERY_DIGESTS: string[] = [
  "2cf5d496485134db8a62fa42c61b2d06b4bad32e",
  "70fe8057f9e3ceddff08763aa63e98d76fb24c73",
  "bf827c93c51c4085a49aa556d10f62a117614921",
];

export const prefs: {
  countdown_vox: string;
  countdown_vox_volume: number;
  home: [number, number] | null;
  overpass_query: string;
  overpass_server: string;
  receive_sfx: string;
  receive_sfx_volume: number;
  send_sfx: string;
  send_sfx_volume: number;
  show_checked_locations: boolean;
  subgraph_selection: SubgraphSelection;
  trap_duration: number;
} = {
  countdown_vox: "",
  countdown_vox_volume: 1.0,
  home: null,
  overpass_query: DEFAULT_OVERPASS_QUERY,
  overpass_server: "https://overpass.private.coffee/api/interpreter",
  receive_sfx: "",
  receive_sfx_volume: 0.75,
  send_sfx: "",
  send_sfx_volume: 1.0,
  show_checked_locations: true,
  subgraph_selection: SubgraphSelection.FullGraph,
  trap_duration: 60,
};
export let slot_data: APGoSlotData | null = null;
export function setSlotData(new_slot_data: APGoSlotData | null) {
  slot_data = new_slot_data;
}
export const client = new Client();
export const game_data: {
  last_displayed_dialog_trap: number;
  points: Map<number, [number, number]>;
  scouted_locations: Map<number, NetworkItem>;
} = {
  last_displayed_dialog_trap: -1,
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
