import { Item } from "archipelago.js";
import maplibregl, { type LngLatLike } from "maplibre-gl";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { checkLocations, getKeyProgress } from "./gameplay";
import {
  cheat,
  client,
  home,
  points,
  scouted_locations,
  slot_data,
} from "./globals";
import { styleItemElement, stylePlayerElement } from "./log";
import { type APGoSlotData, Goal, ItemType, type Trip } from "./types";

export let game_map: maplibregl.Map | null = null;
let home_marker: maplibregl.Marker | null = null;
let current_location_marker: maplibregl.Marker | null = null;
export let location_markers: Record<number, maplibregl.Marker> = {};

export function clearMarkers() {
  for (const marker_name in location_markers) {
    const marker = location_markers[marker_name];
    marker.remove();
  }
  location_markers = {};
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

export function lateSetUpMap() {
  if (game_map) {
    return;
  }
  game_map = createMap("map");
  setUpHomeMarker();
  game_map.addControl(new MacguffinDisplayControl());

  if (Object.keys(location_markers).length > 0) {
    game_map.once("loaded", () => {
      const bounds = new maplibregl.LngLatBounds();
      for (const marker_name in location_markers) {
        const marker = location_markers[marker_name];
        marker.addTo(game_map!);
        bounds.extend(marker.getLngLat());
      }
      game_map!.fitBounds(bounds, {
        animate: false,
        // ensure tops and sides of markers are visible
        padding: { bottom: 0, left: 14, right: 14, top: 36 },
      });
    });
  }
  // TODO: add a control that fits to marker bounds
}

export function setUpHomeMarker() {
  if (!home) {
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
    home_marker.setLngLat(home);
  } else {
    home_marker = new maplibregl.Marker({ color: "green" });
    home_marker.setLngLat(home);
    home_marker.addTo(game_map);
  }
}

export function updateCurrentLocationPin(coords: LngLatLike) {
  if (!game_map) {
    return;
  }
  if (current_location_marker) {
    current_location_marker.setLngLat(coords);
  } else {
    current_location_marker = new maplibregl.Marker({ color: "blue" });
    current_location_marker.setLngLat(coords);
    current_location_marker.addTo(game_map);
    if (cheat) {
      current_location_marker.on("dragend", () => {
        checkLocations(current_location_marker!.getLngLat());
      });
    }
  }
  current_location_marker.setDraggable(cheat);
}

function getItemColor(
  location_id: number,
  trip: Trip,
  key_progression: number,
  item: Item | null,
  hinted: boolean,
): string {
  if (key_progression < trip.key_needed) return "gray";
  else if (client.room.checkedLocations.includes(location_id))
    return "darkgray";
  else if (item === null)
    return "lightseagreen"; // available but not scouted or hinted
  else if (item.progression) return "plum";
  else if (item.useful) return "slateblue";
  else if (item.trap && hinted) return "salmon";
  else if (item.trap) {
    // Don't totally give away that a location is a trap.
    // Instead, choose a random other classification, and alter the color slightly.
    const rng = xoroshiro128plus(item.locationId);
    const n = uniformInt(rng, 0, 13);
    if (n < 1) return "#ddabdd";
    else if (n < 4) return "#7364cd";
    else return "#0dffff";
  } else return "cyan";
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
    if (scouted_locations[location_id]) {
      item = new Item(
        client,
        scouted_locations[location_id],
        client.players.self,
        client.players.findPlayer(scouted_locations[location_id].player)!,
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
  let point = points[location_id];
  if (location_markers[location_id]) {
    if (point === undefined) {
      point = location_markers[location_id].getLngLat();
    }
    location_markers[location_id].remove();
  }
  const trip = slot_data.trips[location_name];
  if (!trip) {
    throw `Unknown trip ${location_name}`;
  }
  const key_progression = getKeyProgress();
  const checked = client.room.checkedLocations.includes(location_id);
  const marker = new maplibregl.Marker({
    color: getItemColor(location_id, trip, key_progression, item, hinted),
  });
  if (point !== undefined) {
    marker.setLngLat(point);
  }
  if (item || hinted || checked) {
    const popup = document.createElement("div");
    popup.appendChild(document.createTextNode(location_name));
    if (key_progression < trip.key_needed) {
      popup.appendChild(document.createElement("br"));
      popup.appendChild(
        document.createTextNode(
          `Requires key ${trip.key_needed} (have ${key_progression})`,
        ),
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
    marker.setPopup(new maplibregl.Popup().setDOMContent(popup));
  }
  if (game_map && point) {
    marker.addTo(game_map);
  }
  location_markers[location_id] = marker;
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
    client.socket.on("connected", (packet) => {
      this.setUpLetters(packet.slot_data as APGoSlotData);
    });

    return this._container;
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
        item_ids = [
          ItemType.MacguffinA,
          ItemType.MacguffinP,
          ItemType.MacguffinHyphen,
          ItemType.MacguffinG,
          ItemType.MacguffinO,
          ItemType.MacguffinExclamation,
        ];
        break;
      case Goal.LongMacGuffin:
        letters = "Archipela-GO!";
        item_ids = [
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
  }
  getDefaultPosition(): maplibregl.ControlPosition {
    return "top-left";
  }
}
