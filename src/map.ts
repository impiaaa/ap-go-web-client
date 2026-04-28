import { make_circle } from "@pkgs/gen/gen";
import { type ConnectedPacket, Item } from "archipelago.js";
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
  game_state,
  generator_internal,
  LONG_MACGUFFIN_ITEMS,
  points,
  prefs,
  SHORT_MACGUFFIN_ITEMS,
  scouted_locations,
  slot_data,
} from "./globals";
import icons_caution_svg from "./icons/caution.svg?raw";
import icons_checkmark_svg from "./icons/checkmark.svg?raw";
import icons_exclamation_mark_svg from "./icons/exclamation_mark.svg?raw";
import icons_home_svg from "./icons/home.svg?raw";
import icons_locked_lock_svg from "./icons/locked_lock.svg?raw";
import icons_question_mark_svg from "./icons/question_mark.svg?raw";
import icons_star_svg from "./icons/star.svg?raw";
import { styleItemElement, stylePlayerElement } from "./log";
import marker_svg from "./marker.svg?raw";
import {
  type APGoSlotData,
  GameState,
  Goal,
  ItemType,
  type Trip,
} from "./types";

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
export const location_markers = new Map<number, maplibregl.Marker>();
let wake_lock: WakeLockSentinel | null = null;
let geolocate_control: MyGeolocateControl | null = null;

export function clearMarkers() {
  location_markers.forEach((marker) => {
    marker.remove();
  });
  location_markers.clear();
}

export function createMap(container: string) {
  const darkModeMql = window.matchMedia?.("(prefers-color-scheme: dark)");
  const map = new maplibregl.Map({
    container: container,
    // https://stackoverflow.com/a/57795495
    style: `https://tiles.versatiles.org/assets/styles/${darkModeMql?.matches ? "eclipse" : "colorful"}/style.json`,
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (event) => {
      map.setStyle(
        `https://tiles.versatiles.org/assets/styles/${event.matches ? "eclipse" : "colorful"}/style.json`,
      );
    });
  return map;
}

function makePolygonGeojson(points: GeoJSON.Position[]): GeoJSON.GeoJSON {
  return {
    geometry: { coordinates: [points], type: "Polygon" },
    properties: {},
    type: "Feature",
  };
}

function lateSetUpMap() {
  game_map = createMap("map");
  setUpHomeMarker();
  game_map.addControl(new MacguffinDisplayControl());
  game_map.addControl(new KeyDisplayControl());
  geolocate_control = new MyGeolocateControl();
  game_map.addControl(geolocate_control);
  game_map.addControl(new FitMapToPointsControl());

  game_map.on("load", () => {
    location_markers.forEach((marker) => {
      if (marker.getLngLat()) {
        marker.addTo(game_map!);
      }
    });
    fitMapToPoints(false);

    const darkModeMql = window.matchMedia?.("(prefers-color-scheme: dark)");
    game_map!.addSource("collection_circle", {
      data: makePolygonGeojson([]),
      type: "geojson",
    });
    game_map!.addLayer({
      id: "collection_circle",
      paint: {
        "line-color": darkModeMql?.matches ? "white" : "black",
        "line-opacity": 0.8,
        "line-width": 1,
      },
      source: "collection_circle",
      type: "line",
    });
    game_map!.addSource("scouting_circle", {
      data: makePolygonGeojson([]),
      type: "geojson",
    });
    game_map!.addLayer({
      id: "scouting_circle",
      paint: {
        "line-color": darkModeMql?.matches ? "white" : "black",
        "line-opacity": 0.4,
        "line-width": 1,
      },
      source: "scouting_circle",
      type: "line",
    });

    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (event) => {
        game_map
          ?.getLayer("collection_circle")
          ?.setPaintProperty("line-color", event.matches ? "white" : "black");
        game_map
          ?.getLayer("scouting_circle")
          ?.setPaintProperty("line-color", event.matches ? "white" : "black");
      });
    client.socket.on("connected", () => {
      game_map?.setLayoutProperty("collection_circle", "visibility", "visible");
      game_map?.setLayoutProperty("scouting_circle", "visibility", "visible");
    });
    client.socket.on("disconnected", () => {
      game_map?.setLayoutProperty("collection_circle", "visibility", "none");
      game_map?.setLayoutProperty("scouting_circle", "visibility", "none");
    });
  });
}

function updateCircles(lng: number, lat: number) {
  if (game_map && generator_internal) {
    const center = new Float64Array([lng, lat]);
    const resolution = BigInt(64);
    // TODO: generate points array in-place to avaoid reallocating
    game_map
      .getSource<GeoJSONSource>("collection_circle")
      ?.setData(
        makePolygonGeojson(
          make_circle(
            generator_internal,
            center,
            getCollectionDistance(),
            resolution,
          ),
        ),
      );
    game_map
      .getSource<GeoJSONSource>("scouting_circle")
      ?.setData(
        makePolygonGeojson(
          make_circle(
            generator_internal,
            center,
            getScoutingDistance(),
            resolution,
          ),
        ),
      );
  }
}

export function updateMapLocation(position: GeolocationPosition) {
  geolocate_control?.onSuccess(position);
  updateCircles(position.coords.longitude, position.coords.latitude);
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

function getMarkerElement(
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
  const el = document.createElement("div");
  el.appendChild(svg_doc.firstElementChild!);
  return el;
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
    home_marker = new maplibregl.Marker({
      element: getMarkerElement("goldenrod", "home"),
      offset: [0, -14],
    });
    home_marker.setLngLat(prefs.home);
    home_marker.addTo(game_map);
  }
}

function getItemMarker(
  location_id: number,
  trip: Trip,
  key_progression: number,
  item: Item | null,
  hinted: boolean,
): HTMLDivElement {
  if (key_progression < trip.key_needed)
    return getMarkerElement("gray", "locked_lock");
  else if (client.room.checkedLocations.includes(location_id))
    return getMarkerElement("black", "checkmark");
  else if (item === null)
    // available but not scouted or hinted
    return getMarkerElement("green", "question_mark");
  else if (item.progression) return getMarkerElement("purple", "star");
  else if (item.useful) return getMarkerElement("blue", "exclamation_mark");
  else if (item.trap && hinted) return getMarkerElement("crimson", "caution");
  else if (item.trap) {
    // Don't totally give away that a location is a trap.
    // Instead, choose a random other classification, and alter the color slightly.
    const rng = xoroshiro128plus(item.locationId);
    const n = uniformInt(rng, 0, 13);
    if (n < 1) return getMarkerElement("#802080", "star", true);
    else if (n < 4)
      return getMarkerElement("#4040ff", "exclamation_mark", true);
    else return getMarkerElement("#34ced1", null, true);
  } else return getMarkerElement("darkturquoise", null);
}

export function updateMarker(arg: Item | number, hinted: boolean = false) {
  if (!slot_data) {
    throw "updateMarker called without being connected";
  }
  let item: Item | null;
  let location_name: string;
  let location_id: number;
  if (arg instanceof Item) {
    item = arg;
    location_name = item.locationName;
    location_id = item.locationId;
  } else if (typeof arg === "number") {
    location_id = arg;
    const scouted_location = scouted_locations.get(location_id);
    if (scouted_location) {
      item = new Item(
        client,
        scouted_location,
        client.players.self,
        client.players.findPlayer(scouted_location.player)!,
      );
    } else {
      item = null;
    }
    location_name = client.package.lookupLocationName(client.game, location_id);
  } else {
    throw `Unkown argument type ${typeof arg}`;
  }
  if (!hinted) {
    hinted = client.items.hints.some(
      (hint) => hint.item.locationId === location_id,
    );
  }
  const trip = slot_data.trips[location_name];
  if (!trip) {
    throw `Unknown trip ${location_name}`;
  }
  const key_progression = getKeyProgress();
  let point = points.get(location_id);
  const icon = getItemMarker(location_id, trip, key_progression, item, hinted);
  const existing_marker = location_markers.get(location_id);
  if (existing_marker) {
    if (point === undefined) {
      point = existing_marker.getLngLat().toArray();
    }
    existing_marker.remove();
  }
  const marker = new maplibregl.Marker({ element: icon, offset: [0, -14] });
  const checked = client.room.checkedLocations.includes(location_id);
  if (point !== undefined) {
    marker.setLngLat(point);
  }
  {
    const popup = document.createElement("div");
    popup.appendChild(document.createTextNode(location_name));
    if (key_progression < trip.key_needed) {
      popup.appendChild(document.createElement("br"));
      popup.appendChild(
        document.createTextNode(`Requires key ${trip.key_needed}`),
      );
    }
    if ((hinted || checked) && item) {
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
    marker.setPopup(
      new maplibregl.Popup({
        offset: offset,
      }).setDOMContent(popup),
    );
  }
  if (game_map && point) {
    marker.addTo(game_map);
  }
  location_markers.set(location_id, marker);
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
  onAdd(map: maplibregl.Map): HTMLElement {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "macguffin-control";

    if (slot_data) {
      this.setUpLetters(slot_data);
    }
    client.socket.on("connected", this.onConnected.bind(this));

    return this._container;
  }
  private onConnected(packet: ConnectedPacket) {
    this.setUpLetters(packet.slot_data as APGoSlotData);
  }
  private setUpLetters(slot_data: APGoSlotData) {
    this._letters.forEach((el) => {
      this._container?.removeChild(el);
    });
    if (!slot_data) {
      console.error(
        "Trying to set up MacguffinDisplayControl with no slot data",
      );
      return;
    }
    shuffle(APColors);
    let letters: string;
    let item_ids: number[];
    switch (slot_data.goal) {
      case Goal.ShortMacGuffin:
        letters = "AP-GO!";
        item_ids = SHORT_MACGUFFIN_ITEMS;
        break;
      case Goal.LongMacGuffin:
        letters = "Archipela-GO!";
        item_ids = LONG_MACGUFFIN_ITEMS;
        break;
      default:
        this._map?.removeControl(this);
        return;
    }
    this._letters = Array.from(letters).map((letter, index) => {
      const el = document.createElement("span");
      el.textContent = letter;
      if (client.items.received.some((item) => item.id === item_ids[index])) {
        el.className = "received";
        el.style.setProperty("color", APColors[index % APColors.length]);
      }
      this._container?.appendChild(el);
      return el;
    });
    client.items.on("itemsReceived", (items) => {
      items.forEach((item) => {
        if (item_ids.includes(item.id)) {
          const index = item_ids.indexOf(item.id);
          const el = this._letters[index];
          el.className = "received";
          el.style.setProperty("color", APColors[index % APColors.length]);
        }
      });
    });
  }
  onRemove(_map: maplibregl.Map): void {
    this._container?.parentNode?.removeChild(this._container);
    this._letters = [];
    this._map = undefined;
    client.socket.off("connected", this.onConnected.bind(this));
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

    return this._container;
  }
  private onConnected(packet: ConnectedPacket) {
    this.setUpKeys(packet.slot_data as APGoSlotData);
  }
  private setUpKeys(slot_data: APGoSlotData) {
    this._keys.forEach((el) => {
      this._container?.removeChild(el);
    });
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
    for (let i = 0; i < max_keys; i++) {
      const el = document.createElement("img");
      this._container?.appendChild(el);
      this._keys[i] = el;
    }
    client.items.on("itemsReceived", (items) => {
      if (items.some((item) => item.id === ItemType.Key)) {
        this.updateKeys();
      }
    });
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
          updateCircles(center.lng, center.lat);
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
  if (!game_map || !game_map.loaded || !points) {
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  points.forEach((point) => {
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
