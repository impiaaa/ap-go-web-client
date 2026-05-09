import {
  type ConnectedPacket,
  type Hint,
  Item,
  itemClassifications,
} from "archipelago.js";
import i18next from "i18next";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import {
  checkLocations,
  getCollectionDistance,
  getKeyProgress,
  getScoutingDistance,
  moveGameState,
} from "./gameplay";
import {
  COLLECTION_DISTANCE_BASE,
  cheat,
  client,
  game_data,
  game_state,
  LONG_MACGUFFIN_ITEMS,
  prefs,
  SHORT_MACGUFFIN_ITEMS,
  slot_data,
} from "./globals";
import icons_caution_svg from "./icons/caution.svg?raw";
import icons_checkmark_svg from "./icons/checkmark.svg?raw";
import icons_exclamation_mark_svg from "./icons/exclamation_mark.svg?raw";
import icons_home_svg from "./icons/home.svg?raw";
import icons_locked_lock_svg from "./icons/locked_lock.svg?raw";
import icons_question_mark_svg from "./icons/question_mark.svg?raw";
import icons_star_svg from "./icons/star.svg?raw";
import { stylePlayerElement } from "./log";
import marker_svg from "./marker.svg?raw";
import { type APGoSlotData, GameState, Goal, ItemType } from "./types";

import { styleItemElement } from "./utils";

const icon_parser = new DOMParser();
const marker_svg_doc = icon_parser.parseFromString(marker_svg, "image/svg+xml");

const icons: Record<string, Document> = {
  caution: icon_parser.parseFromString(icons_caution_svg, "image/svg+xml"),
  checkmark: icon_parser.parseFromString(icons_checkmark_svg, "image/svg+xml"),
  exclamation_mark: icon_parser.parseFromString(
    icons_exclamation_mark_svg,
    "image/svg+xml",
  ),
  home: icon_parser.parseFromString(icons_home_svg, "image/svg+xml"),
  locked_lock: icon_parser.parseFromString(
    icons_locked_lock_svg,
    "image/svg+xml",
  ),
  question_mark: icon_parser.parseFromString(
    icons_question_mark_svg,
    "image/svg+xml",
  ),
  star: icon_parser.parseFromString(icons_star_svg, "image/svg+xml"),
};

export let game_map: maplibregl.Map | null = null;
let home_marker: maplibregl.Marker | null = null;
type LocationFlagsObject = {
  progression: boolean;
  useful: boolean;
  trap: boolean;
};
type LocationGeoJSON = {
  checked: boolean;
  hinted: boolean;
  item?: LocationFlagsObject;
  key_needed: number;
  random: number;
};
let location_features = new Map<
  number,
  GeoJSON.Feature<GeoJSON.Point, LocationGeoJSON>
>();
const locations_geojson: GeoJSON.FeatureCollection<
  GeoJSON.Point,
  LocationGeoJSON
> = {
  features: [],
  type: "FeatureCollection",
};
const locations_layer: maplibregl.SymbolLayerSpecification = {
  id: "locations",
  layout: {
    "icon-allow-overlap": true,
    "icon-image": [
      "case",
      ["<", ["global-state", "key_progression"], ["get", "key_needed"]],
      "marker-locked",
      ["get", "checked"],
      "marker-checked",
      ["!", ["to-boolean", ["get", "item"]]],
      "marker-available",
      ["get", "progression", ["get", "item"]],
      "marker-progression",
      ["get", "useful", ["get", "item"]],
      "marker-useful",
      ["all", ["get", "trap", ["get", "item"]], ["get", "hinted"]],
      "marker-trap",
      ["get", "trap", ["get", "item"]],
      [
        "step",
        ["get", "random"],
        "marker-progression-trap",
        1,
        "marker-useful-trap",
        4,
        "marker-filler-trap",
      ],
      "marker-filler",
    ],
    "icon-offset": [0, -14],
    "symbol-sort-key": [
      "case",
      ["<", ["global-state", "key_progression"], ["get", "key_needed"]],
      5,
      ["get", "checked"],
      6,
      ["!", ["to-boolean", ["get", "item"]]],
      3,
      ["get", "progression", ["get", "item"]],
      0,
      ["get", "useful", ["get", "item"]],
      1,
      ["all", ["get", "trap", ["get", "item"]], ["get", "hinted"]],
      2,
      ["get", "trap", ["get", "item"]],
      ["step", ["get", "random"], 0, 1, 1, 4, 4],
      4,
    ],
    "symbol-z-order": "viewport-y",
  },
  source: "locations",
  type: "symbol",
};
let wake_lock: WakeLockSentinel | null = null;
let geolocate_control: MyGeolocateControl | null = null;
const circles_geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  features: [
    {
      geometry: {
        coordinates: [0, 0],
        type: "Point",
      },
      properties: { lat: 0, radius: 0, type: "collection" },
      type: "Feature",
    },
    {
      geometry: {
        coordinates: [0, 0],
        type: "Point",
      },
      properties: { lat: 0, radius: 0, type: "scouting" },
      type: "Feature",
    },
  ],
  type: "FeatureCollection",
};
const circles_layer: maplibregl.CircleLayerSpecification = {
  id: "circles",
  layout: { visibility: client.socket.connected ? "visible" : "none" },
  paint: {
    "circle-color": "transparent",
    "circle-radius": [
      "let",
      "mpp0",
      ["*", 78271.517, ["cos", ["*", ["get", "lat"], Math.PI / 180]]],
      [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        0,
        ["/", ["get", "radius"], ["var", "mpp0"]],
        24,
        ["/", ["*", ["get", "radius"], 2 ** 24], ["var", "mpp0"]],
      ],
    ],
    "circle-stroke-color": window.matchMedia?.("(prefers-color-scheme: dark)")
      ?.matches
      ? "white"
      : "black",
    "circle-stroke-opacity": ["match", ["get", "type"], "collection", 0.8, 0.4],
    "circle-stroke-width": 1,
  },
  source: "circles",
  type: "circle",
};

export function clearMarkers() {
  locations_geojson.features = [];
  game_map
    ?.getSource<GeoJSONSource>("locations")
    ?.updateData({ removeAll: true }, false);
  location_features.clear();
}

export function createMap(
  container: string,
  layers: maplibregl.LayerSpecification[] = [],
  sources: {
    [_: string]: maplibregl.SourceSpecification;
  } = {},
) {
  const darkModeMql = window.matchMedia?.("(prefers-color-scheme: dark)");
  const map = new maplibregl.Map({
    container: container,
    // https://stackoverflow.com/a/57795495
    style: `https://tiles.versatiles.org/assets/styles/${darkModeMql?.matches ? "eclipse" : "colorful"}/style.json`,
    validateStyle: import.meta.env.DEV,
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (event) => {
      map.setStyle(
        `https://tiles.versatiles.org/assets/styles/${event.matches ? "eclipse" : "colorful"}/style.json`,
        {
          diff: true,
          transformStyle: (_, next) => ({
            ...next,
            layers: [...next.layers, ...layers],
            sources: { ...next.sources, ...sources },
          }),
          validate: import.meta.env.DEV,
        },
      );
    });
  return map;
}

function getFlagsObjectFromNumber(flags: number): LocationFlagsObject {
  return {
    progression:
      (flags & itemClassifications.progression) ===
      itemClassifications.progression,
    trap: (flags & itemClassifications.trap) === itemClassifications.trap,
    useful: (flags & itemClassifications.useful) === itemClassifications.useful,
  };
}

function hintReceived(hint: Hint) {
  const feat = location_features.get(hint.item.locationId);
  const flags = getFlagsObjectFromNumber(hint.item.flags);
  if (feat?.properties) {
    feat.properties.item = flags;
    feat.properties.hinted = true;
  }
  return {
    addOrUpdateProperties: [
      { key: "item", value: flags },
      { key: "hinted", value: true },
    ],
    id: hint.item.locationId,
  };
}

function lateSetUpMap() {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (event) => {
      circles_layer.paint!["circle-stroke-color"] = event.matches
        ? "white"
        : "black";
    });
  game_map = createMap("map", [circles_layer, locations_layer], {
    circles: {
      data: circles_geojson,
      type: "geojson",
    },
    locations: {
      data: locations_geojson,
      type: "geojson",
    },
  });

  setUpHomeMarker();
  game_map.addControl(new MacguffinDisplayControl());
  game_map.addControl(new KeyDisplayControl());
  geolocate_control = new MyGeolocateControl();
  game_map.addControl(geolocate_control);
  game_map.addControl(new FitMapToPointsControl());

  client.items.on("itemsReceived", () => {
    updateCircleRadii();
    game_map!.setGlobalStateProperty("key_progression", getKeyProgress());
  });
  client.socket.on("connected", () => {
    updateCircleRadii();
    game_map!.setGlobalStateProperty("key_progression", getKeyProgress());
    game_map!.setLayoutProperty("circles", "visibility", "visible");
  });
  client.socket.on("disconnected", () => {
    game_map!.setLayoutProperty("circles", "visibility", "none");
  });
  client.room.on("locationsChecked", (locations) => {
    game_map!.getSource<GeoJSONSource>("locations")?.updateData(
      {
        update: locations.map((location_id) => {
          const feat = location_features.get(location_id);
          if (feat?.properties) {
            feat.properties.checked = true;
          }
          return {
            addOrUpdateProperties: [{ key: "checked", value: true }],
            id: location_id,
          };
        }),
      },
      false,
    );
  });
  client.socket.on("locationInfo", (location_info) => {
    game_map!.getSource<GeoJSONSource>("locations")?.updateData(
      {
        update: location_info.locations.map((item) => {
          const feat = location_features.get(item.location);
          const flags = getFlagsObjectFromNumber(item.flags);
          if (feat?.properties) {
            feat.properties.item = flags;
          }
          return {
            addOrUpdateProperties: [{ key: "item", value: flags }],
            id: item.location,
          };
        }),
      },
      false,
    );
  });
  client.items.on("hintsInitialized", (hints) => {
    game_map!.getSource<GeoJSONSource>("locations")?.updateData(
      {
        update: hints.map(hintReceived),
      },
      false,
    );
  });
  client.items.on("hintReceived", (hint) => {
    game_map!.getSource<GeoJSONSource>("locations")?.updateData(
      {
        update: [hintReceived(hint)],
      },
      false,
    );
  });

  const marker_icons: [string, string, string | null, boolean?][] = [
    ["marker-locked", "gray", "locked_lock"],
    ["marker-checked", "black", "checkmark"],
    ["marker-available", "green", "question_mark"],
    ["marker-progression", "purple", "star"],
    ["marker-useful", "blue", "exclamation_mark"],
    ["marker-filler", "darkturquoise", null],
    ["marker-trap", "crimson", "caution"],
    ["marker-progression-trap", "#802080", "star", true],
    ["marker-useful-trap", "#4040ff", "exclamation_mark", true],
    ["marker-filler-trap", "#34ced1", null, true],
  ];
  marker_icons.forEach(([marker_name, color, icon_name, trap]) => {
    const marker_svg = getMarkerSvg(color, icon_name, trap);
    const svg =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(marker_svg.documentElement.outerHTML);
    const image = new Image();
    image.addEventListener("load", () => {
      game_map!.addImage(marker_name, image);
    });
    image.src = svg;
  });

  game_map.on("load", () => {
    game_map!.addSource("circles", {
      data: circles_geojson,
      type: "geojson",
    });
    if (client.socket.connected) {
      updateCircleRadii();
      game_map!.setGlobalStateProperty("key_progression", getKeyProgress());
    }

    game_map!.addSource("locations", {
      data: locations_geojson,
      type: "geojson",
    });
    if (game_data.points.size > 0) {
      setUpMapLocations();
    }

    game_map!.addLayer(circles_layer);
    game_map!.addLayer(locations_layer);

    game_map!.on("click", "locations", (e) => {
      if (!e.features) {
        return;
      }
      if (typeof e.features[0].id !== "number") {
        throw `Unexpected ID ${e.features[0].id}`;
      }
      const coordinates = (e.features[0].geometry as GeoJSON.Point)
        .coordinates as [number, number];

      // Ensure that if the map is zoomed out such that multiple
      // copies of the feature are visible, the popup appears
      // over the copy being pointed to.
      while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
      }

      makePopup(e.features[0].id, e.features[0].properties as LocationGeoJSON)
        .setLngLat(coordinates)
        .addTo(game_map!);
    });
    game_map!.on("mouseenter", "locations", () => {
      game_map!.getCanvas().style.cursor = "pointer";
    });
    game_map!.on("mouseleave", "locations", () => {
      game_map!.getCanvas().style.cursor = "";
    });

    if (game_data.points.size > 0) {
      fitMapToPoints(false);
    } else if (prefs.home) {
      game_map!.jumpTo({ center: prefs.home, zoom: 9 });
    }
  });
}

function updateCircleCenters(lng: number, lat: number) {
  circles_geojson.features.forEach((feat) => {
    feat.geometry.coordinates[0] = lng;
    feat.geometry.coordinates[1] = lat;
    feat.properties!.lat = lat;
  });
  game_map
    ?.getSource<GeoJSONSource>("circles")
    ?.setData(circles_geojson, false);
}

function updateCircleRadii() {
  circles_geojson.features[0].properties!.radius = getCollectionDistance();
  circles_geojson.features[1].properties!.radius = getScoutingDistance();
  game_map
    ?.getSource<GeoJSONSource>("circles")
    ?.setData(circles_geojson, false);
}

export function updateMapLocation(position: GeolocationPosition) {
  geolocate_control?.onSuccess(position);
  updateCircleCenters(position.coords.longitude, position.coords.latitude);
}

export function updateMapLocationError(error: GeolocationPositionError) {
  geolocate_control?.onError(error);
}

function requestWakeLock() {
  if (wake_lock) {
    wake_lock.release().then(() => {
      wake_lock = null;
      requestWakeLock();
    });
    return;
  }
  if (document.visibilityState === "visible") {
    navigator.wakeLock.request("screen").then((result) => {
      wake_lock = result;
      wake_lock.addEventListener("release", requestWakeLock);
    });
  }
}

export function showMapPage() {
  if (!game_map) {
    lateSetUpMap();
  }
  if (game_state === GameState.Tracking) {
    requestWakeLock();
  }
}

export function hideMapPage() {
  if (wake_lock) {
    wake_lock.release().then(() => {
      wake_lock = null;
    });
  }
}

function getMarkerSvg(
  color: string,
  icon_name: string | null,
  trap: boolean = false,
) {
  const svg_doc = marker_svg_doc.cloneNode(true) as Document;
  svg_doc.getElementById("background")?.setAttribute("fill", color);
  if (icon_name) {
    const icon_svg = icons[icon_name].firstElementChild;
    const icon_path = icon_svg?.firstElementChild?.cloneNode(true) as
      | Element
      | undefined;
    if (icon_path) {
      icon_path.setAttribute("fill", "#fff");
      icon_path.setAttribute(
        "transform",
        `translate(6, 6) ${trap ? "rotate(180, 7.5, 7.5)" : ""}`,
      );
      svg_doc.getElementById("icon")?.replaceWith(icon_path);
    }
  }
  return svg_doc;
}

export function setUpHomeMarker() {
  if (!prefs.home) {
    return;
  }
  if (!game_map) {
    return;
  }
  if (!game_map.loaded) {
    game_map.once("load", setUpHomeMarker);
    return;
  }
  if (home_marker) {
    home_marker.setLngLat(prefs.home);
  } else {
    const el = document.createElement("div");
    el.appendChild(getMarkerSvg("goldenrod", "home").firstElementChild!);
    home_marker = new maplibregl.Marker({
      element: el,
      offset: [0, -14],
    });
    home_marker.setLngLat(prefs.home);
    home_marker.addTo(game_map);
  }
}

export function setUpMapLocations() {
  if (!slot_data) {
    throw "setUpLocations called without being connected";
  }
  const checked_locations = new Set<number>(client.room.checkedLocations);
  const hinted_locations = new Set<number>(
    client.items.hints
      .map((h) => h.item)
      .filter((i) => i.locationGame === client.game)
      .map((i) => i.locationId),
  );
  const generator = xoroshiro128plus(parseInt(client.room.seedName, 10));
  location_features = new Map<
    number,
    GeoJSON.Feature<GeoJSON.Point, LocationGeoJSON>
  >(
    client.room.allLocations.map((location_id) => {
      const location_name = client.package.lookupLocationName(
        client.game,
        location_id,
        false,
      );
      if (!location_name) {
        throw new Error(`Unknown local location_id ${location_id}`);
      }

      const trip = slot_data!.trips[location_name];
      if (!trip) {
        throw new Error(`Unknown trip ${location_name}`);
      }

      const point = game_data.points.get(location_id);
      if (!point) {
        throw new Error(
          `Location ID ${location_id} "${location_name}" has no point`,
        );
      }

      const scouted_location = game_data.scouted_locations.get(location_id);
      const props: LocationGeoJSON = {
        checked: checked_locations.has(location_id),
        hinted: hinted_locations.has(location_id),
        item: scouted_location
          ? getFlagsObjectFromNumber(scouted_location.flags)
          : undefined,
        key_needed: trip.key_needed,
        random: uniformInt(generator, 0, 13),
      };

      return [
        location_id,
        {
          geometry: { coordinates: point, type: "Point" },
          id: location_id,
          properties: props,
          type: "Feature",
        },
      ];
    }),
  );
  locations_geojson.features = Array.from(location_features.values());
  game_map
    ?.getSource<GeoJSONSource>("locations")
    ?.setData(locations_geojson, false);
}

function makePopup(location_id: number, props: LocationGeoJSON) {
  if (!slot_data) {
    throw "updateMarker called without being connected";
  }
  const scouted_location = game_data.scouted_locations.get(location_id);
  const item = scouted_location
    ? new Item(
        client,
        scouted_location,
        client.players.self,
        client.players.findPlayer(scouted_location.player)!,
      )
    : null;
  const location_name = client.package.lookupLocationName(
    client.game,
    location_id,
  );
  const trip = slot_data.trips[location_name];
  if (!trip) {
    throw `Unknown trip ${location_name}`;
  }

  const popup = document.createElement("div");
  popup.appendChild(document.createTextNode(location_name));
  if (getKeyProgress() < trip.key_needed) {
    popup.appendChild(document.createElement("br"));
    popup.appendChild(
      document.createTextNode(
        i18next.t("map.popup.requires-key", {
          defaultValue: "Requires key {{trip.key_needed}}",
          trip: trip,
        }),
      ),
    );
  }
  if ((props.hinted || props.checked) && item) {
    popup.appendChild(document.createElement("br"));

    const player_el = document.createElement("span");
    player_el.appendChild(document.createTextNode(item.receiver.name));
    player_el.classList.add("player");
    stylePlayerElement(player_el, item.receiver);
    popup.appendChild(player_el);

    popup.appendChild(document.createTextNode(" "));

    const item_el = document.createElement("span");
    item_el.appendChild(document.createTextNode(item.name));
    item_el.classList.add("item");
    styleItemElement(item_el, item);
    popup.appendChild(item_el);
  }
  const markerHeight = 41 - 5.8 / 2;
  const markerRadius = 13.5;
  const linearOffset = Math.abs(markerRadius) / Math.SQRT2;
  const offset: maplibregl.Offset = {
    bottom: [0, -markerHeight],
    "bottom-left": [
      linearOffset,
      (markerHeight - markerRadius + linearOffset) * -1,
    ],
    "bottom-right": [
      -linearOffset,
      (markerHeight - markerRadius + linearOffset) * -1,
    ],
    center: [0, 0],
    left: [markerRadius, (markerHeight - markerRadius) * -1],
    right: [-markerRadius, (markerHeight - markerRadius) * -1],
    top: [0, 0],
    "top-left": [0, 0],
    "top-right": [0, 0],
  };
  return new maplibregl.Popup({
    offset: offset,
  }).setDOMContent(popup);
}

// Source - https://stackoverflow.com/a/2450976
// Posted by ChristopheD, modified by community. See post 'Timeline' for change history
// Retrieved 2026-03-12, License - CC BY-SA 4.0

function shuffle<T>(array: Array<T>) {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex !== 0) {
    // Pick a remaining element...
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
}

const APColors = [
  "#C97682",
  "#75C275",
  "#EEE391",
  "#CA94C2",
  "#767EBD",
  "#D9A07D",
];

class MacguffinDisplayControl implements maplibregl.IControl {
  private _map?: maplibregl.Map;
  private _container?: HTMLDivElement;
  private _letters: HTMLSpanElement[] = [];
  private _item_ids: number[] = [];
  onAdd(map: maplibregl.Map): HTMLElement {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "macguffin-control";

    if (slot_data) {
      this.setUpLetters(slot_data);
    }
    client.socket.on("connected", this.onConnected.bind(this));
    client.socket.on("disconnected", this.onDisconnected.bind(this));
    client.items.on("itemsReceived", this.onItemsReceived.bind(this));

    return this._container;
  }
  private onConnected(packet: ConnectedPacket) {
    this.setUpLetters(packet.slot_data as APGoSlotData);
  }
  private onDisconnected() {
    this._letters.forEach((el) => {
      this._container?.removeChild(el);
    });
    this._letters = [];
    this._item_ids = [];
  }
  private setItemReceived(index: number, el?: HTMLSpanElement) {
    if (!el) el = this._letters[index];
    el.className = "received";
    el.style.setProperty("color", APColors[index % APColors.length]);
  }
  private onItemsReceived(items: Item[]) {
    items.forEach((item) => {
      if (this._item_ids.includes(item.id)) {
        this.setItemReceived(this._item_ids.indexOf(item.id));
      }
    });
  }
  private setUpLetters(slot_data: APGoSlotData) {
    if (!slot_data) {
      console.error(
        "Trying to set up MacguffinDisplayControl with no slot data",
      );
      return;
    }
    shuffle(APColors);
    let letters: string;
    switch (slot_data.goal) {
      case Goal.ShortMacGuffin:
        letters = "AP-GO!";
        this._item_ids = SHORT_MACGUFFIN_ITEMS;
        break;
      case Goal.LongMacGuffin:
        letters = "Archipela-GO!";
        this._item_ids = LONG_MACGUFFIN_ITEMS;
        break;
      default:
        this._map?.removeControl(this);
        return;
    }
    this._letters = Array.from(letters).map((letter, index) => {
      const el = document.createElement("span");
      el.textContent = letter;
      if (
        client.items.received.some((item) => item.id === this._item_ids[index])
      ) {
        this.setItemReceived(index, el);
      }
      this._container?.appendChild(el);
      return el;
    });
  }
  onRemove(_map: maplibregl.Map): void {
    this._container?.parentNode?.removeChild(this._container);
    this._letters = [];
    this._item_ids = [];
    this._map = undefined;
    client.socket.off("connected", this.onConnected.bind(this));
    client.socket.off("disconnected", this.onDisconnected.bind(this));
    client.items.off("itemsReceived", this.onItemsReceived.bind(this));
  }
  getDefaultPosition(): maplibregl.ControlPosition {
    return "top-left";
  }
}

class KeyDisplayControl implements maplibregl.IControl {
  private _map?: maplibregl.Map;
  private _container?: HTMLDivElement;
  private _keys: HTMLImageElement[] = [];
  onAdd(map: maplibregl.Map): HTMLElement {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "keys-control";

    if (slot_data) {
      this.setUpKeys(slot_data);
    }
    client.socket.on("connected", this.onConnected.bind(this));
    client.socket.on("disconnected", this.onDisconnected.bind(this));
    client.items.on("itemsReceived", this.onItemsReceived.bind(this));

    return this._container;
  }
  private onConnected(packet: ConnectedPacket) {
    this.setUpKeys(packet.slot_data as APGoSlotData);
  }
  private onDisconnected() {
    this._keys.forEach((el) => {
      this._container?.removeChild(el);
    });
    this._keys = [];
  }
  private onItemsReceived(items: Item[]) {
    if (items.some((item) => item.id === ItemType.Key)) {
      this.updateKeys();
    }
  }
  private setUpKeys(slot_data: APGoSlotData) {
    if (!slot_data) {
      console.error("Trying to set up KeyDisplayControl with no slot data");
      return;
    }
    const max_keys = Math.max(
      ...Object.values(slot_data.trips).map((trip) => trip.key_needed),
    );
    if (max_keys === 0) {
      this._map?.removeControl(this);
      return;
    }
    this._keys = new Array(max_keys);
    for (let i = 0; i < max_keys; i++) {
      const el = document.createElement("img");
      this._container?.appendChild(el);
      this._keys[i] = el;
    }
    this.updateKeys();
  }
  private updateKeys() {
    const key_count = getKeyProgress();
    this._keys.forEach((el, key) => {
      const has_key = key < key_count;
      el.src = has_key ? "key.svg" : "dot.svg";
      el.alt = `Key ${key + 1}`;
      if (!has_key) {
        el.alt += " (missing)";
      }
    });
  }
  onRemove(_map: maplibregl.Map): void {
    this._container?.parentNode?.removeChild(this._container);
    this._keys = [];
    this._map = undefined;
    client.socket.off("connected", this.onConnected.bind(this));
    client.socket.off("disconnected", this.onDisconnected.bind(this));
    client.items.off("itemsReceived", this.onItemsReceived.bind(this));
  }
  getDefaultPosition(): maplibregl.ControlPosition {
    return "bottom-left";
  }
}

class MyGeolocateControl
  extends maplibregl.Evented
  implements maplibregl.IControl
{
  // Simplified version of the MapLibre geolocate control.
  // - Receives location updates from game, only toggle between tracking/not
  // - Draggable in cheat mode
  _map: maplibregl.Map | undefined;
  _container: HTMLElement | undefined;
  _dotElement: HTMLElement | undefined;
  _geolocateButton: HTMLButtonElement | undefined;
  _watchState:
    | "OFF"
    | "ACTIVE_LOCK"
    | "WAITING_ACTIVE"
    | "WAITING_BACKGROUND"
    | "ACTIVE_ERROR"
    | "BACKGROUND"
    | "BACKGROUND_ERROR" = "OFF";
  _lastKnownPosition: GeolocationPosition | undefined;
  _userLocationDotMarker: maplibregl.Marker | undefined;
  _setup: boolean = false; // set to true once the control has been setup

  onAdd(map: maplibregl.Map): HTMLElement {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this._setupUI();
    return this._container!;
  }

  onRemove() {
    // clear the markers from the map
    this._userLocationDotMarker?.remove();

    this._container?.remove();
    if (this._map) {
      this._map.off("movestart", this._onMoveStart);
      this._map = undefined;
    }

    client.socket.off("connected", this._onSocketConnected.bind(this));
    client.socket.off("disconnected", this._onSocketDisconnected.bind(this));
  }

  _isOutOfMapMaxBounds(position: GeolocationPosition) {
    if (!this._map) {
      return true;
    }
    const bounds = this._map.getMaxBounds();
    const coordinates = position.coords;

    return (
      bounds &&
      (coordinates.longitude < bounds.getWest() ||
        coordinates.longitude > bounds.getEast() ||
        coordinates.latitude < bounds.getSouth() ||
        coordinates.latitude > bounds.getNorth())
    );
  }

  _setErrorState() {
    switch (this._watchState) {
      case "WAITING_ACTIVE":
      case "ACTIVE_LOCK":
        this._moveToState("ACTIVE_ERROR");
        break;
      case "BACKGROUND":
      case "WAITING_BACKGROUND":
        this._moveToState("BACKGROUND_ERROR");
        break;
      case "ACTIVE_ERROR":
      case "BACKGROUND_ERROR":
        // already in error state
        break;
      case "OFF":
        // when not activated, watchState is 'OFF'
        // no error state transition is needed
        break;
      default:
        throw new Error(`Unexpected watchState ${this._watchState}`);
    }
  }

  onSuccess = (position: GeolocationPosition) => {
    if (!this._map) {
      // control has since been removed
      return;
    }

    if (this._isOutOfMapMaxBounds(position)) {
      this._setErrorState();

      return;
    }
    // keep a record of the position so that if the state is BACKGROUND and the user
    // clicks the button, we can move to ACTIVE_LOCK immediately without waiting for
    // watchPosition to trigger _onSuccess
    this._lastKnownPosition = position;

    switch (this._watchState) {
      case "WAITING_ACTIVE":
      case "ACTIVE_LOCK":
      case "ACTIVE_ERROR":
        this._moveToState("ACTIVE_LOCK");
        break;
      case "WAITING_BACKGROUND":
      case "BACKGROUND":
      case "BACKGROUND_ERROR":
      case "OFF":
        this._moveToState("BACKGROUND");
        break;
      default:
        throw new Error(`Unexpected watchState ${this._watchState}`);
    }

    // if showUserLocation and the watch state isn't off then update the marker location
    this._updateMarker(position);

    // if in normal mode (not watch mode), or if in watch mode and the state is active watch
    // then update the camera
    if (this._watchState === "ACTIVE_LOCK") {
      this._updateCamera(position);
    }

    this._dotElement?.classList.remove("maplibregl-user-location-dot-stale");
  };

  _updateCamera = (position: GeolocationPosition) => {
    if (!this._map) {
      return;
    }
    const center = new maplibregl.LngLat(
      position.coords.longitude,
      position.coords.latitude,
    );
    const radius = position.coords.accuracy;
    const bearing = this._map.getBearing();
    const options = { bearing, maxZoom: 15 };
    const newBounds = maplibregl.LngLatBounds.fromLngLat(center, radius);

    this._map.fitBounds(newBounds, options, {
      geolocateSource: true, // tag this camera change so it won't cause the control to change to background state
    });
  };

  _updateMarker = (position: GeolocationPosition) => {
    if (this._map)
      this._userLocationDotMarker
        ?.setLngLat(
          new maplibregl.LngLat(
            position.coords.longitude,
            position.coords.latitude,
          ),
        )
        .addTo(this._map);
  };

  onError = (error: GeolocationPositionError) => {
    if (!this._map) {
      // control has since been removed
      return;
    }

    if (error.code === 1) {
      // PERMISSION_DENIED
      this._moveToState("OFF");
      if (this._geolocateButton) {
        this._geolocateButton.disabled = true;
        const title = this._map._getUIString(
          "GeolocateControl.LocationNotAvailable",
        );
        this._geolocateButton.title = title;
        this._geolocateButton.setAttribute("aria-label", title);
      }
    } else {
      this._setErrorState();
    }

    if (this._watchState !== "OFF") {
      this._dotElement?.classList.add("maplibregl-user-location-dot-stale");
    }
  };

  _onMoveStart = (event: {
    geolocateSource: undefined | boolean;
    0: undefined | ResizeObserverEntry;
  }) => {
    if (!this._map) return;
    const fromResize = event?.[0] instanceof ResizeObserverEntry;
    if (!event.geolocateSource && !fromResize && !this._map.isZooming()) {
      if (this._watchState === "ACTIVE_LOCK") {
        this._moveToState("BACKGROUND");
      } else if (this._watchState === "WAITING_ACTIVE") {
        this._moveToState("WAITING_BACKGROUND");
      }
    }
  };

  _setupUI = () => {
    // the control could have been removed before reaching here
    if (!this._map) {
      return;
    }

    this._container?.addEventListener("contextmenu", (e: MouseEvent) => {
      e.preventDefault();
    });
    this._geolocateButton = document.createElement("button");
    this._geolocateButton.classList.add("maplibregl-ctrl-geolocate");
    this._container?.appendChild(this._geolocateButton);
    const icon = document.createElement("span");
    icon.classList.add("maplibregl-ctrl-icon");
    this._geolocateButton.appendChild(icon);
    icon.setAttribute("aria-hidden", "true");
    this._geolocateButton.type = "button";
    this._geolocateButton.disabled = true;

    // this method is called asynchronously during onAdd
    if (!this._map) {
      // control has since been removed
      return;
    }

    if (this._geolocateButton) {
      const title = this._map._getUIString("GeolocateControl.FindMyLocation");
      this._geolocateButton.disabled = false;
      this._geolocateButton.title = title;
      this._geolocateButton.setAttribute("aria-label", title);
      this._geolocateButton.setAttribute("aria-pressed", "false");
    }

    this._dotElement = document.createElement("div");
    this._dotElement.classList.add("maplibregl-user-location-dot");

    this._userLocationDotMarker = new maplibregl.Marker({
      element: this._dotElement,
    });
    if (cheat) {
      this._userLocationDotMarker.setDraggable(true);
      this._userLocationDotMarker.on("dragend", () => {
        if (game_state === GameState.ReadyNotTracking) {
          moveGameState(GameState.Tracking);
        }
        if (game_state === GameState.Tracking) {
          const center = this._userLocationDotMarker!.getLngLat();
          checkLocations(center);
          updateCircleCenters(center.lng, center.lat);
        }
      });
    }

    client.socket.on("connected", this._onSocketConnected.bind(this));
    client.socket.on("disconnected", this._onSocketDisconnected.bind(this));
    if (client.socket.connected) {
      this._onSocketConnected();
    }

    this._geolocateButton?.addEventListener("click", () => this.trigger());

    this._setup = true;

    // when the camera is changed (and it's not as a result of the Geolocation Control) change
    // the watch mode to background watch, so that the marker is updated but not the camera.
    this._map.on("movestart", this._onMoveStart);
  };

  _onSocketConnected() {
    if (this._lastKnownPosition) {
      this._updateMarker(this._lastKnownPosition);
      this._moveToState("BACKGROUND");
    } else {
      this._moveToState("WAITING_BACKGROUND");
    }
    if (cheat) {
      this.onSuccess({
        coords: {
          accuracy: COLLECTION_DISTANCE_BASE,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude: prefs.home![1] + 0.001,
          longitude: prefs.home![0] + 0.001,
          speed: null,
          toJSON: function () {
            return {
              accuracy: this.accuracy,
              altitude: this.altitude,
              altitudeAccuracy: this.altitudeAccuracy,
              heading: this.heading,
              latitude: this.latitude,
              longitude: this.longitude,
              speed: this.speed,
            };
          },
        },
        timestamp: 0,
        toJSON: function () {
          return { coords: this.coords, timestamp: this.timestamp };
        },
      });
    }
  }

  _onSocketDisconnected() {
    this._moveToState("OFF");
  }

  _moveToState(newState: typeof this._watchState) {
    switch (this._watchState) {
      case "ACTIVE_LOCK":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-active",
        );
        break;
      case "WAITING_ACTIVE":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-waiting",
          "maplibregl-ctrl-geolocate-active",
        );
        break;
      case "WAITING_BACKGROUND":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-waiting",
          "maplibregl-ctrl-geolocate-background",
        );
        break;
      case "ACTIVE_ERROR":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-active-error",
          "maplibregl-ctrl-geolocate-waiting",
        );
        break;
      case "BACKGROUND":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-background",
        );
        break;
      case "BACKGROUND_ERROR":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-background-error",
          "maplibregl-ctrl-geolocate-waiting",
        );
        break;
    }
    switch (newState) {
      case "OFF":
        this._geolocateButton?.setAttribute("aria-pressed", "false");
        this._userLocationDotMarker?.remove();
        break;
      case "ACTIVE_LOCK":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-active",
        );
        break;
      case "WAITING_ACTIVE":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-waiting",
          "maplibregl-ctrl-geolocate-active",
        );
        break;
      case "WAITING_BACKGROUND":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-waiting",
          "maplibregl-ctrl-geolocate-background",
        );
        break;
      case "ACTIVE_ERROR":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-active-error",
          "maplibregl-ctrl-geolocate-waiting",
        );
        this._userLocationDotMarker?.remove();
        break;
      case "BACKGROUND":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-background",
        );
        break;
      case "BACKGROUND_ERROR":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-background-error",
          "maplibregl-ctrl-geolocate-waiting",
        );
        this._userLocationDotMarker?.remove();
        break;
    }
    if (newState !== "OFF") {
      this._geolocateButton?.setAttribute("aria-pressed", "true");
    }
    this._watchState = newState;
  }

  trigger(): boolean {
    if (!this._setup) {
      console.warn("Geolocate control triggered before added to a map");
      return false;
    }
    if (game_state !== GameState.Tracking) {
      return false;
    }
    // update watchState and do any outgoing state cleanup
    switch (this._watchState) {
      case "ACTIVE_LOCK":
        this._moveToState("BACKGROUND");
        break;
      case "WAITING_ACTIVE":
        this._moveToState("WAITING_BACKGROUND");
        break;
      case "WAITING_BACKGROUND":
        this._moveToState("WAITING_ACTIVE");
        break;
      case "ACTIVE_ERROR":
        this._moveToState("BACKGROUND_ERROR");
        break;
      case "BACKGROUND":
        this._moveToState("ACTIVE_LOCK");
        // set camera to last known location
        if (this._lastKnownPosition)
          this._updateCamera(this._lastKnownPosition);
        break;
      case "BACKGROUND_ERROR":
        this._moveToState("ACTIVE_ERROR");
        break;
      default:
        throw new Error(`Unexpected watchState ${this._watchState}`);
    }
    return true;
  }
}

class FitMapToPointsControl implements maplibregl.IControl {
  private _container?: HTMLDivElement;
  private _button?: HTMLButtonElement;

  onAdd(_map: maplibregl.Map) {
    this._container = document.createElement("div");
    this._container.classList.add("maplibregl-ctrl");
    this._container.classList.add("maplibregl-ctrl-group");
    this._button = document.createElement("button");
    this._container.appendChild(this._button);
    const icon = document.createElement("img");
    icon.src = "ctrl-fit-points.svg";
    this._button.appendChild(icon);
    icon.setAttribute("aria-hidden", "true");
    this._button.type = "button";
    this._updateTitle();
    this._button.addEventListener("click", this._onClick);
    return this._container;
  }

  _updateTitle() {
    if (this._button) {
      const title = this._getTitle();
      this._button.setAttribute("aria-label", title);
      this._button.title = title;
    }
  }

  _getTitle() {
    return "Center map";
  }

  onRemove() {
    this._container?.parentNode?.removeChild(this._container);
  }

  _onClick() {
    fitMapToPoints(true);
  }
}

export function fitMapToPoints(animated: boolean) {
  if (!game_map || !game_map.loaded || !game_data.points) {
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  game_data.points.forEach((point) => {
    bounds.extend(point);
  });
  if (!bounds.isEmpty()) {
    game_map.fitBounds(bounds, {
      animate: animated,
      // ensure tops and sides of markers are visible
      padding: { bottom: 0, left: 14, right: 14, top: 36 },
    });
  }
}
