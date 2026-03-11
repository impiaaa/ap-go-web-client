import maplibregl, { LngLat } from 'maplibre-gl';
import { checkLocations } from './gameplay';
import { generate } from './generate';
import {
  cheat,
  client,
  DATAPACKAGE_KEY,
  home,
  PREFS_KEY,
  SAVED_GAME_KEY,
  setHome,
  setScoutedLocations,
  setSlotData,
} from './globals';
import { addMessages } from './log';
import { createMap, setUpHomeMarker, updateCurrentLocationPin } from './map';
import type { APGoSlotData } from './types';

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

      const saved_game_json = localStorage.getItem(SAVED_GAME_KEY);
      if (saved_game_json) {
        const saved_game = JSON.parse(saved_game_json);
        if (
          saved_game &&
          saved_game.seed === client.room.seedName &&
          saved_game.scouted_locations
        ) {
          setScoutedLocations(saved_game.scouted_locations);
        } else {
          setScoutedLocations({});
        }
      } else {
        setScoutedLocations({});
      }

      // 1e20 is the maximum as defined by seeddigits in BaseClasses.py
      const seed =
        (Number.parseFloat(client.room.seedName) * (0x100000000 / 1e20)) ^
        client.players.self.slot;
      generate(seed);

      if (window.location.hash === '#connect') {
        window.location.hash = '#map';
      }

      if (cheat) {
        updateCurrentLocationPin(home!);
      } else {
        navigator.geolocation.watchPosition(
          geoLocationUpdate,
          geoLocationError,
        );
      }
    })
    .catch((reason) => {
      console.error(reason);
      document.getElementById('connection-error')!.innerText = reason;
      ip.disabled = false;
      port.disabled = false;
      player.disabled = false;
      password.disabled = false;
      submit.disabled = false;
      if (window.location.hash !== '#connect') {
        window.location.hash = '#connect';
      }
    });
}

function geoLocationUpdate(location: GeolocationPosition) {
  const coords = new LngLat(
    location.coords.longitude,
    location.coords.latitude,
  );
  updateCurrentLocationPin(coords);
  checkLocations(coords);
}

function geoLocationError(error: GeolocationPositionError) {
  let message = error.message;
  if (error.code === GeolocationPositionError.PERMISSION_DENIED) {
    message += '\nPlease reload and reconnect.';
    alert(message);
  } else {
    message += '\nEnable cheat mode?';
    if (confirm(message)) {
      // TODO: add a way to unset cheat mode
      localStorage.setItem('cheat', 'true');
      location.reload();
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
    const set_home = setup_form.querySelector('#set-home') as HTMLButtonElement;
    set_home.classList.remove('invalid');
    setUpHomeMarker();
    (document.getElementById('set-home-dialog') as HTMLDialogElement).close();
    saveConnectInfo();
  });
}
set_home_button.addEventListener('click', setUpSetHomeMap);

export function setUpConnectPage() {
  setup_form.addEventListener('submit', onSubmit);
  set_home_button.addEventListener('click', () => {
    (
      document.getElementById('set-home-dialog') as HTMLDialogElement
    ).showModal();
  });

  const datapackage_str = localStorage.getItem(DATAPACKAGE_KEY);
  if (datapackage_str) {
    client.package.importPackage(JSON.parse(datapackage_str));
  }

  const ip = setup_form.elements.namedItem('ip') as HTMLInputElement;
  const port = setup_form.elements.namedItem('port') as HTMLInputElement;
  const player = setup_form.elements.namedItem('player') as HTMLInputElement;
  const password = setup_form.elements.namedItem(
    'password',
  ) as HTMLInputElement;

  const prefs_str = localStorage.getItem(PREFS_KEY);
  if (prefs_str) {
    const prefs_json = JSON.parse(prefs_str);
    if (typeof prefs_json === 'object') {
      const submit = setup_form.querySelector('#submit') as HTMLButtonElement;

      const ip_json = prefs_json.ip;
      if (ip_json && typeof ip_json === 'string') {
        ip.value = ip_json;
      }

      const port_json = prefs_json.port;
      if (port_json) {
        if (typeof port_json === 'string') {
          port.value = port_json;
        } else if (typeof port_json === 'number') {
          port.value = port_json.toString();
        }
      }

      const player_json = prefs_json.player;
      if (player_json && typeof player_json === 'string') {
        player.value = player_json;
      }

      const password_json = prefs_json.password;
      if (password_json && typeof password_json === 'string') {
        password.value = password_json;
      }

      const home_json = prefs_json.home;
      if (
        home_json &&
        Array.isArray(home_json) &&
        home_json.length === 2 &&
        typeof home_json[0] === 'number' &&
        typeof home_json[1] === 'number'
      ) {
        setHome(home_json as [number, number]);
      }

      if (setup_form.checkValidity() && home) {
        submit.click();
      } else {
        window.location.hash = '#connect';
      }
    } else {
      localStorage.removeItem(PREFS_KEY);
      if (window.location.hash !== '#connect') {
        window.location.hash = '#connect';
      }
    }
  } else {
    if (window.location.hash !== '#connect') {
      window.location.hash = '#connect';
    }
  }

  const set_home = setup_form.querySelector('#set-home') as HTMLButtonElement;
  if (!home) {
    set_home.classList.add('invalid');
  }

  ip.addEventListener('change', () => {
    if (setup_form.checkValidity()) saveConnectInfo();
  });
  port.addEventListener('change', () => {
    if (setup_form.checkValidity()) saveConnectInfo();
  });
  player.addEventListener('change', () => {
    if (setup_form.checkValidity()) saveConnectInfo();
  });
  password.addEventListener('change', () => {
    if (setup_form.checkValidity()) saveConnectInfo();
  });
}

function saveConnectInfo() {
  const ip = setup_form.elements.namedItem('ip') as HTMLInputElement;
  const port = setup_form.elements.namedItem('port') as HTMLInputElement;
  const player = setup_form.elements.namedItem('player') as HTMLInputElement;
  const password = setup_form.elements.namedItem(
    'password',
  ) as HTMLInputElement;
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      ip: ip.value,
      port: port.value,
      player: player.value,
      password: password.value,
      home: home,
    }),
  );
}
