import maplibregl from 'maplibre-gl';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';
import {
  client,
  DATAPACKAGE_KEY,
  home,
  setHome,
  setSlotData,
  slot_data,
} from './globals';
import { addMessages } from './log';
import {
  createMap,
  game_map,
  setUpHomeMarker,
  updateLocation,
  updateMarker,
} from './map';
import type { APGoSlotData } from './types';

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
    .then((new_slot_info) => {
      console.log('Connected!');
      localStorage.setItem(
        DATAPACKAGE_KEY,
        JSON.stringify(client.package.exportPackage()),
      );
      setSlotData(new_slot_info);

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
      generate(seed);

      window.location.hash = '#map';

      navigator.geolocation.watchPosition(geoLocationUpdate, geoLocationError);
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

function geoLocationUpdate(location: GeolocationPosition) {
  updateLocation(location.coords);
}

function geoLocationError(error: GeolocationPositionError) {
  let message = error.message;
  if (error.code === GeolocationPositionError.PERMISSION_DENIED) {
    message += '\nPlease reload and reconnect.';
    alert(message);
  } else {
    message += '\nEnable cheat mode?';
    if (confirm(message)) {
      // TODO
    }
  }
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

function generate(seed: number) {
  if (!home) {
    throw 'generate called with no home set';
  }
  if (!slot_data) {
    throw 'generate called while not connected';
  }
  const rng = xoroshiro128plus(seed);
  const bounds = new maplibregl.LngLatBounds();
  const points: { [key: string]: maplibregl.LngLatLike } = {};
  for (const trip_name in slot_data.trips) {
    const trip = slot_data.trips[trip_name];
    let max_dist = (slot_data.maximum_distance / 10) * trip.distance_tier;
    let min_dist = slot_data.minimum_distance;
    if (max_dist < slot_data.minimum_distance) {
      max_dist = slot_data.minimum_distance * (1 + DISTANCE_LENIENCY);
    }
    if (min_dist > slot_data.maximum_distance) {
      min_dist = slot_data.maximum_distance * (1 - DISTANCE_LENIENCY);
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
    (item) => item.id === 8902301100000 + 2,
  ).length;
  const reachable_locations = client.room.missingLocations.filter(
    (location_id) => {
      const location_name = client.package.lookupLocationName(
        client.game,
        location_id,
      );
      const trip = slot_data?.trips[location_name];
      return trip && key_progression >= trip.key_needed;
    },
  );

  client.scout(reachable_locations).then((items) => {
    items.forEach((item) => {
      updateMarker(item, points[item.locationName]);
    });
  });
  client.room.allLocations.forEach((location_id) => {
    if (!reachable_locations.includes(location_id)) {
      const location_name = client.package.lookupLocationName(
        client.game,
        location_id,
      );
      updateMarker(location_id, points[location_name]);
    }
  });
}
