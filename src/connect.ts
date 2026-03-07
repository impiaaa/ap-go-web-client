import maplibregl from 'maplibre-gl';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';
import { client, DATAPACKAGE_KEY, home, setHome } from './globals';
import { addMessages } from './log';
import {
  clearMarkers,
  createMap,
  game_map,
  location_markers,
  setUpHomeMarker,
} from './map';
import type { APGoSlotData, Trip } from './types';
import type { Item } from 'archipelago.js';
import { uniformInt } from 'pure-rand/distribution/uniformInt';

// earth radius in km
const EARTH_RADIUS = 6371;
// 1° latitude in meters
const DEGREE = ((EARTH_RADIUS * 2 * Math.PI) / 360) * 1000;
const DISTANCE_LENIENCY = 0.1;

const setup_form = document.forms.namedItem('connect-form')!;
const set_home_button = document.getElementById('set-home')!;

function onSubmit(ev: SubmitEvent) {
  ev.preventDefault();
  const ip = setup_form.elements.namedItem('ip') as HTMLInputElement;
  const port = setup_form.elements.namedItem('port') as HTMLInputElement;
  const player = setup_form.elements.namedItem('player') as HTMLInputElement;
  const password = setup_form.elements.namedItem(
    'password',
  ) as HTMLInputElement;
  const set_home = setup_form.querySelector('#set-home') as HTMLButtonElement;
  const submit = setup_form.querySelector('#submit') as HTMLButtonElement;

  if (!home) {
    document.getElementById('connection-error')!.innerText =
      'Set a home location';
    return;
  }

  ip.disabled = true;
  port.disabled = true;
  player.disabled = true;
  password.disabled = true;
  set_home.disabled = true;
  submit.disabled = true;
  client
    .login<APGoSlotData>(
      `${ip.value}:${port.value}`,
      player.value,
      'Archipela-Go!',
      { password: password.value },
    )
    .then((slot_info) => {
      console.log('Connected!');
      localStorage.setItem(
        DATAPACKAGE_KEY,
        JSON.stringify(client.package.exportPackage()),
      );

      ip.disabled = false;
      port.disabled = false;
      player.disabled = false;
      password.disabled = false;
      set_home.disabled = false;
      submit.disabled = false;

      const text_log = document.getElementById('text-log')!;
      text_log.childNodes.forEach((c) => {
        text_log.removeChild(c);
      });
      client.messages.log.forEach((line) => {
        addMessages(line.nodes);
        text_log.appendChild(document.createElement('br'));
      });
      text_log.scrollTop = text_log.scrollHeight - text_log.clientHeight;

      // 1e20 is the maximum as defined by seeddigits in BaseClasses.py
      const seed =
        Number.parseFloat(client.room.seedName) * (0x100000000 / 1e20);
      generate(seed, slot_info);

      window.location.hash = '#map';
    })
    .catch((reason) => {
      console.error(reason);
      document.getElementById('connection-error')!.innerText = reason;
      ip.disabled = false;
      port.disabled = false;
      player.disabled = false;
      password.disabled = false;
      submit.disabled = false;
    });
}

function setUpSetHomeMap() {
  set_home_button.removeEventListener('click', setUpSetHomeMap);
  const map = createMap('set-home-map');
  if (home) {
    map.setZoom(9);
    map.setCenter(home);
  }
  map.addControl(new maplibregl.GeolocateControl({}));

  const overlay = document.createElement('div');

  const xhair = document.createElement('div');
  xhair.classList.add('crosshair');
  xhair.style.setProperty('top', '50%');
  xhair.style.setProperty('height', '1px');
  xhair.style.setProperty('width', '100%');
  overlay.appendChild(xhair);

  const yhair = document.createElement('div');
  yhair.classList.add('crosshair');
  yhair.style.setProperty('left', '50%');
  yhair.style.setProperty('width', '1px');
  yhair.style.setProperty('height', '100%');
  overlay.appendChild(yhair);

  map.getCanvasContainer().appendChild(overlay);

  document.getElementById('save-home')?.addEventListener('click', () => {
    const new_home = map.getCenter().toArray();
    setHome(new_home);
    localStorage.setItem('home', JSON.stringify(new_home));
    const set_home = setup_form.querySelector('#set-home') as HTMLButtonElement;
    set_home.classList.remove('invalid');
    setUpHomeMarker();
    (document.getElementById('set-home-dialog') as HTMLDialogElement).close();
  });
}
set_home_button.addEventListener('click', setUpSetHomeMap);

export function setUpConnectPage() {
  const set_home = setup_form.querySelector('#set-home') as HTMLButtonElement;
  if (!home) {
    set_home.classList.add('invalid');
  }
  setup_form.addEventListener('submit', onSubmit);
  set_home_button.addEventListener('click', () => {
    (
      document.getElementById('set-home-dialog') as HTMLDialogElement
    ).showModal();
  });
}

const divisor = 1 << 24;
const scale = 1 / divisor;
const mask = divisor - 1;

function uniformFloat32(rng: RandomGenerator): number {
  const value = rng.next() & mask;
  return value * scale;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

function getItemColor(item: Item, trip: Trip, key_progression: number): string {
  if (key_progression < trip.key_needed)
    return "gray";
  else if (item.progression)
    return 'plum';
  else if (item.useful)
    return 'slateblue';
  else if (item.trap) {
    // Don't totally give away that a location is a trap.
    // Instead, choose a random other classification, and alter the color slightly.
    const rng = xoroshiro128plus(item.locationId);
    const n = uniformInt(rng, 0, 13);
    if (n < 1)
      return "#ddabdd";
    else if (n < 4)
      return "#7364cd";
    else
      return "#0dffff";
  }
  else
    return 'cyan';
}

function generate(seed: number, options: APGoSlotData) {
  if (!home) {
    return;
  }
  const rng = xoroshiro128plus(seed);
  const bounds = new maplibregl.LngLatBounds();
  let points: { [key: string]: maplibregl.LngLatLike } = {};
  for (const trip_name in options.trips) {
    const trip = options.trips[trip_name];
    let max_dist = (options.maximum_distance / 10) * trip.distance_tier;
    let min_dist = options.minimum_distance;
    if (max_dist < options.minimum_distance) {
      max_dist = options.minimum_distance * (1 + DISTANCE_LENIENCY);
    }
    if (min_dist > options.maximum_distance) {
      min_dist = options.maximum_distance * (1 - DISTANCE_LENIENCY);
    }

    const r = (max_dist - min_dist) * uniformFloat32(rng) ** 0.5 + min_dist;
    const theta = uniformFloat32(rng) * Math.PI * 2;
    const dy = r * Math.sin(theta);
    const dx = r * Math.cos(theta);

    const new_latitude = home[1] + dy / DEGREE;
    const new_longitude =
      home[0] + dx / (DEGREE * Math.cos(deg2rad(new_latitude)));

    const lnglat: [number, number] = [new_longitude, new_latitude];
    bounds.extend(lnglat);
    points[trip_name] = lnglat;
  }
  if (game_map) game_map.fitBounds(bounds);

  const key_progression = client.items.received.filter(
    (item) => item.id == 8902301100000 + 2,
  ).length;

  client.scout(client.room.allLocations).then((items) => {
    for (let marker_name in location_markers) {
      const marker = location_markers[marker_name];
      marker.remove();
    }
    clearMarkers();
    items.forEach((item) => {
      const trip = options.trips[item.locationName];
      const marker = new maplibregl.Marker({
        color: getItemColor(item, trip, key_progression),
      });
      marker.setLngLat(points[item.locationName]);
      marker.setPopup(new maplibregl.Popup().setText(item.locationName));
      if (game_map) marker.addTo(game_map);
      location_markers[item.locationName] = marker;
    });
  });
}
