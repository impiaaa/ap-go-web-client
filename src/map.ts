import { Item } from 'archipelago.js';
import maplibregl from 'maplibre-gl';
import { uniformInt } from 'pure-rand/distribution/uniformInt';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { client, home, slot_data } from './globals';
import { styleItemElement, stylePlayerElement } from './log';
import type { Trip } from './types';

export let game_map: maplibregl.Map | null = null;
let home_marker: maplibregl.Marker | null = null;
let current_location_marker: maplibregl.Marker | null = null;
export let location_markers: { [key: string]: maplibregl.Marker } = {};

export function clearMarkers() {
  for (const marker_name in location_markers) {
    const marker = location_markers[marker_name];
    marker.remove();
  }
  location_markers = {};
}

export function createMap(container: string) {
  const darkModeMql = window.matchMedia?.('(prefers-color-scheme: dark)');
  const map = new maplibregl.Map({
    container: container,
    // https://stackoverflow.com/a/57795495
    style: `https://tiles.versatiles.org/assets/styles/${darkModeMql?.matches ? 'eclipse' : 'colorful'}/style.json`,
  });
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (event) => {
      map.setStyle(
        `https://tiles.versatiles.org/assets/styles/${event.matches ? 'eclipse' : 'colorful'}/style.json`,
      );
    });
  return map;
}

export function lateSetUpMap() {
  if (game_map) {
    return;
  }
  game_map = createMap('map');
  setUpHomeMarker();

  if (Object.keys(location_markers).length > 0) {
    const bounds = new maplibregl.LngLatBounds();
    for (const marker_name in location_markers) {
      const marker = location_markers[marker_name];
      marker.addTo(game_map!);
      bounds.extend(marker.getLngLat());
    }
    game_map?.fitBounds(bounds);
  }
}

export function setUpHomeMarker() {
  if (!home) {
    return;
  }
  if (!game_map) {
    return;
  }
  if (home_marker) {
    home_marker.setLngLat(home);
  } else {
    home_marker = new maplibregl.Marker({ color: 'green' });
    home_marker.setLngLat(home);
    home_marker.addTo(game_map);
  }
}

export function updateLocation(coords: GeolocationCoordinates) {
  if (!game_map) {
    return;
  }
  if (current_location_marker) {
    current_location_marker.setLngLat([coords.longitude, coords.latitude]);
  } else {
    current_location_marker = new maplibregl.Marker({ color: 'blue' });
    current_location_marker.setLngLat([coords.longitude, coords.latitude]);
    current_location_marker.addTo(game_map);
  }
}

function getItemColor(
  location_id: number,
  trip: Trip,
  key_progression: number,
  item: Item | null,
  hinted: boolean,
): string {
  if (key_progression < trip.key_needed) return 'gray';
  else if (client.room.checkedLocations.includes(location_id))
    return 'darkgray';
  else if (item === null)
    return '#ff00ff'; // shouldn't happen
  else if (item.progression) return 'plum';
  else if (item.useful) return 'slateblue';
  else if (item.trap && hinted) return 'salmon';
  else if (item.trap) {
    // Don't totally give away that a location is a trap.
    // Instead, choose a random other classification, and alter the color slightly.
    const rng = xoroshiro128plus(item.locationId);
    const n = uniformInt(rng, 0, 13);
    if (n < 1) return '#ddabdd';
    else if (n < 4) return '#7364cd';
    else return '#0dffff';
  } else return 'cyan';
}

export function updateMarker(
  arg: Item | number,
  point?: maplibregl.LngLatLike,
  hinted: boolean = false,
) {
  if (!slot_data) {
    throw 'updateMarker called without being connected';
  }
  let item: Item | null;
  let location_name: string;
  let location_id: number;
  if (arg instanceof Item) {
    item = arg;
    location_name = item.locationName;
    location_id = item.locationId;
  } else if (typeof arg === 'number') {
    item = null;
    location_id = arg;
    location_name = client.package.lookupLocationName(client.game, location_id);
  } else {
    throw `Unkown argument type ${typeof arg}`;
  }
  if (!hinted) {
    hinted = client.items.hints.some(
      (hint) => hint.item.locationId === location_id,
    );
  }
  if (location_markers[location_name]) {
    if (point === undefined) {
      point = location_markers[location_name].getLngLat();
    }
    location_markers[location_name].remove();
  }
  const trip = slot_data.trips[location_name];
  if (!trip) {
    throw `Unknown trip ${location_name}`;
  }
  const key_progression = client.items.received.filter(
    (item) => item.id === 8902301100000 + 2,
  ).length;
  const marker = new maplibregl.Marker({
    color: getItemColor(location_id, trip, key_progression, item, hinted),
  });
  if (point !== undefined) {
    marker.setLngLat(point);
  }
  if (key_progression >= trip.key_needed || hinted) {
    const popup = document.createElement('div');
    popup.appendChild(document.createTextNode(location_name));
    if (key_progression < trip.key_needed) {
      popup.appendChild(document.createElement('br'));
      popup.appendChild(
        document.createTextNode(
          `Requires key ${trip.key_needed} (have ${key_progression})`,
        ),
      );
    }
    if (hinted && item) {
      popup.appendChild(document.createElement('br'));

      const player_el = document.createElement('span');
      player_el.appendChild(document.createTextNode(item.receiver.name));
      player_el.classList.add('player');
      stylePlayerElement(player_el, item.receiver);
      popup.appendChild(player_el);

      popup.appendChild(document.createTextNode(' '));

      const item_el = document.createElement('span');
      item_el.appendChild(document.createTextNode(item.name));
      item_el.classList.add('item');
      styleItemElement(item_el, item);
      popup.appendChild(item_el);
    }
    marker.setPopup(new maplibregl.Popup().setDOMContent(popup));
  }
  if (game_map && point) {
    marker.addTo(game_map);
  }
  location_markers[location_name] = marker;
}
