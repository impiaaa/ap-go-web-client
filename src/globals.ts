import { type Internal, SubgraphSelection } from "@pkgs/gen/gen";
import { Client, type NetworkItem } from "archipelago.js";
import { type APGoSlotData, GameState, ItemType } from "./types";

export const DATAPACKAGE_KEY = "datapackage_cache";
export const PREFS_KEY = "connection_info";
export const SAVED_GAME_KEY = "saved_game";
export const DEFAULT_PAGE = "connect";

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
export const TRAP_ITEMS = [
  // Not just traps, anything that has a temporary effect
  ItemType.ShuffleTrap,
  ItemType.SilenceTrap,
  ItemType.FogOfWarTrap,
  ItemType.PushUpTrap,
  ItemType.SocializingTrap,
  ItemType.SitUpTrap,
  ItemType.JumpingJackTrap,
  ItemType.TouchGrassTrap,
  ItemType.Hydrate,
  ItemType.TakeBreather,
];

export const DEFAULT_OVERPASS_QUERY = `[out:json][timeout:{{timeout}}][maxsize:{{maxsize}}][bbox:{{bbox}}];
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
way._
  [access!=agricultural]
  [access!=customers]
  [access!=delivery]
  [access!=destination]
  [access!=discouraged]
  [access!=forestry]
  [access!=no]
  [access!=permit]
  [access!=private]
  [access!=unknown]
  [access!=use_sidepath]
  [foot!=agricultural]
  [foot!=customers]
  [foot!=delivery]
  [foot!=destination]
  [foot!=discouraged]
  [foot!=forestry]
  [foot!=no]
  [foot!=permit]
  [foot!=private]
  [foot!=unknown]
  [foot!=use_sidepath]
  [sidewalk!=separate];
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
export const OLD_QUERY_DIGESTS: string[] = [
  "2cf5d496485134db8a62fa42c61b2d06b4bad32e",
];

export const prefs: {
  home: [number, number] | null;
  overpass_query: string;
  overpass_server: string;
  show_checked_locations: boolean;
  subgraph_selection: SubgraphSelection;
  trap_duration: number;
} = {
  home: null,
  overpass_query: DEFAULT_OVERPASS_QUERY,
  overpass_server: "https://overpass.private.coffee/api/interpreter",
  show_checked_locations: true,
  subgraph_selection: SubgraphSelection.FullGraph,
  trap_duration: 60,
};
export let slot_data: APGoSlotData | null = null;
export function setSlotData(new_slot_data: APGoSlotData) {
  slot_data = new_slot_data;
}
export const client = new Client();
export const game_data: {
  displayed_trap_locations: [number, number][];
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
