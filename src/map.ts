import { type Hint, Item, itemClassifications } from "archipelago.js";
import i18next from "i18next";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import {
  getCollectionDistance,
  getKeyProgress,
  getScoutingDistance,
} from "./gameplay";
import { client, game_data, game_state, prefs, slot_data } from "./globals";
import icons_caution_svg from "./icons/caution.svg?raw";
import icons_checkmark_svg from "./icons/checkmark.svg?raw";
import icons_exclamation_mark_svg from "./icons/exclamation_mark.svg?raw";
import icons_home_svg from "./icons/home.svg?raw";
import icons_locked_lock_svg from "./icons/locked_lock.svg?raw";
import icons_question_mark_svg from "./icons/question_mark.svg?raw";
import icons_star_svg from "./icons/star.svg?raw";
import { stylePlayerElement } from "./log";
import {
  FitMapToPointsControl,
  KeyDisplayControl,
  MacguffinDisplayControl,
  MyGeolocateControl,
} from "./map-controls";
import marker_svg from "./marker.svg?raw";
import { GameState } from "./types";
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
function real_world_radius(
  radius: maplibregl.ExpressionSpecification | number,
): maplibregl.ExpressionSpecification {
  return [
    "let",
    "mpp0",
    ["*", 78271.517, ["cos", ["*", ["get", "lat"], Math.PI / 180]]],
    [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      0,
      ["/", radius, ["var", "mpp0"]],
      24,
      ["/", ["*", radius, 2 ** 24], ["var", "mpp0"]],
    ],
  ];
}
const circles_layer: maplibregl.CircleLayerSpecification = {
  id: "circles",
  layout: { visibility: "none" },
  paint: {
    "circle-color": "transparent",
    "circle-radius": real_world_radius(["get", "radius"]),
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
const fog_of_war_geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  features: [
    {
      geometry: {
        coordinates: [0, 0],
        type: "Point",
      },
      properties: { lat: 0 },
      type: "Feature",
    },
  ],
  type: "FeatureCollection",
};
const fow_fade_duration_ms = 1000;
const fog_of_war_layer: maplibregl.HeatmapLayerSpecification = {
  id: "fog_of_war",
  layout: { visibility: "none" },
  paint: {
    "heatmap-color": [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0,
      "dimgray",
      1,
      "transparent",
    ],
    "heatmap-opacity": 0.0,
    "heatmap-opacity-transition": { duration: fow_fade_duration_ms },
    "heatmap-radius": real_world_radius(300),
  },
  source: "fog_of_war",
  type: "heatmap",
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

let fow_timeout: number = -1;
export function setFogOfWarVisible(visible: boolean) {
  if (fow_timeout >= 0) {
    window.clearTimeout(fow_timeout);
    fow_timeout = -1;
  }

  if (visible) {
    fog_of_war_layer.layout!.visibility = "visible";
    game_map?.setLayoutProperty("fog_of_war", "visibility", "visible");
  }

  const opacity = visible ? 1.0 : 0.0;
  fog_of_war_layer.paint!["heatmap-opacity"] = opacity;
  game_map?.setPaintProperty("fog_of_war", "heatmap-opacity", opacity);

  if (!visible) {
    fow_timeout = window.setTimeout(() => {
      fog_of_war_layer.layout!.visibility = "none";
      game_map?.setLayoutProperty("fog_of_war", "visibility", "none");
      fow_timeout = -1;
    }, fow_fade_duration_ms);
  }
}

function lateSetUpMap() {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (event) => {
      circles_layer.paint!["circle-stroke-color"] = event.matches
        ? "white"
        : "black";
    });
  game_map = createMap(
    "map",
    [circles_layer, locations_layer, fog_of_war_layer],
    {
      circles: {
        data: circles_geojson,
        type: "geojson",
      },
      fog_of_war: {
        data: fog_of_war_geojson,
        type: "geojson",
      },
      locations: {
        data: locations_geojson,
        type: "geojson",
      },
    },
  );

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
    circles_layer.layout!.visibility = "visible";
    game_map!.setLayoutProperty("circles", "visibility", "visible");
  });
  client.socket.on("disconnected", () => {
    circles_layer.layout!.visibility = "none";
    game_map!.setLayoutProperty("circles", "visibility", "none");
    setFogOfWarVisible(false);
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
    game_map!.addSource("fog_of_war", {
      data: fog_of_war_geojson,
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
    game_map!.addLayer(fog_of_war_layer);

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

export function updateCircleCenters(lng: number, lat: number) {
  circles_geojson.features.forEach((feat) => {
    feat.geometry.coordinates[0] = lng;
    feat.geometry.coordinates[1] = lat;
    feat.properties!.lat = lat;
  });
  game_map
    ?.getSource<GeoJSONSource>("circles")
    ?.setData(circles_geojson, false);
  fog_of_war_geojson.features.forEach((feat) => {
    feat.geometry.coordinates[0] = lng;
    feat.geometry.coordinates[1] = lat;
    feat.properties!.lat = lat;
  });
  game_map
    ?.getSource<GeoJSONSource>("fog_of_war")
    ?.setData(fog_of_war_geojson, false);
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
      .filter((i) => i.sender.slot === client.players.self.slot)
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
