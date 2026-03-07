import './index.css';
import {
  Client,
  type Hint,
  type Item,
  type MessageNode,
  type Player,
} from 'archipelago.js';
import maplibregl from 'maplibre-gl';

/* Types & globals */

type Trip = {
  distance_tier: number;
  key_needed: number;
  speed_tier: number;
};

type TripDict = {
  [index: string]: Trip;
};

enum Goal {
  OneHardTravel = 0,
  Allsanity = 1,
  ShortMacGuffin = 2,
  LongMacGuffin = 3,
}

type APGoSlotData = {
  goal: Goal;
  minimum_distance: number;
  maximum_distance: number;
  speed_requirement: number;
  trips: TripDict;
};

const DATAPACKAGE_KEY = 'datapackage_cache';
const DEFAULT_PAGE = 'connect';
let home: [number, number] | null = null;

/* Client setup */

const client = new Client();

declare global {
  interface Window {
    client: Client;
  }
}
window.client = client; // debug access

const datapackage_str = localStorage.getItem(DATAPACKAGE_KEY);
if (datapackage_str) {
  client.package.importPackage(JSON.parse(datapackage_str));
}

const home_str = localStorage.getItem('home');
if (home_str) {
  const home_json = JSON.parse(home_str);
  if (
    home_json &&
    Array.isArray(home_json) &&
    home_json.length == 2 &&
    typeof home_json[0] === 'number' &&
    typeof home_json[1] === 'number'
  ) {
    home = home_json as [number, number];
  }
}

/* Page layout */

function showPage(new_hash: string) {
  let page = document.getElementById(`page-${new_hash}`);
  if (!page) {
    new_hash = DEFAULT_PAGE;
    window.history.replaceState({}, '', `#${new_hash}`);
    page = document.getElementById(`page-${new_hash}`);
    if (!page) {
      throw 'no default page';
    }
  }
  page.style.removeProperty('display');
  document
    .querySelectorAll(`nav a[href="#${new_hash}"]`)
    .forEach((el) => el.classList.add('active'));
  if (new_hash === 'map') {
    setUpMap();
  }
}

window.addEventListener('hashchange', (ev) => {
  const old_hash = new URL(ev.oldURL).hash.substring(1);
  const new_hash = new URL(ev.newURL).hash.substring(1);
  document
    .getElementById(`page-${old_hash}`)
    ?.style.setProperty('display', 'none');
  document
    .querySelectorAll(`nav a[href="#${old_hash}"]`)
    .forEach((el) => el.classList.remove('active'));
  showPage(new_hash);
});
window.addEventListener('load', () => {
  showPage(window.location.hash.substring(1));
});

/* Connection page */

const setup_form = document.forms.namedItem('connect-form')!;
{
  const set_home = setup_form.querySelector('#set-home') as HTMLButtonElement;
  if (!home) {
    set_home.classList.add('invalid');
  }
}
setup_form.addEventListener('submit', (ev: SubmitEvent) => {
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
    .then((_slot_info) => {
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

      text_log.childNodes.forEach((c) => {
        text_log.removeChild(c);
      });
      client.messages.log.forEach((line) => {
        addMessages(line.nodes);
        text_log.appendChild(document.createElement('br'));
      });
      text_log.scrollTop = text_log.scrollHeight - text_log.clientHeight;

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
});
const set_home_button = document.getElementById('set-home')!;
function setUpSetHomeMap() {
  set_home_button.removeEventListener('click', setUpSetHomeMap);
  const map = createMap('set-home-map');
  if (home) {
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
    home = map.getCenter().toArray();
    localStorage.setItem('home', JSON.stringify(home));
    const set_home = setup_form.querySelector('#set-home') as HTMLButtonElement;
    set_home.classList.remove('invalid');
    setUpHomeMarker();
  });
}
set_home_button.addEventListener('click', setUpSetHomeMap);

/* Text client */

const text_log = document.getElementById('text-log')!;

function styleItemElement(element: HTMLElement, item: Item) {
  if (item.progression) element.classList.add('progression');
  if (item.useful) element.classList.add('useful');
  if (item.trap) element.classList.add('trap');
}

function stylePlayerElement(element: HTMLElement, player: Player) {
  if (
    player.slot === client.players.self.slot ||
    client.players.slots[player.slot].group_members.includes(
      client.players.self.slot,
    )
  ) {
    element.classList.add('self');
  }
}

function addMessageNode(node: MessageNode) {
  const msg_el = document.createElement('span');
  msg_el.appendChild(document.createTextNode(node.text));
  msg_el.classList.add(node.type);
  switch (node.type) {
    case 'color':
      if (node.color === 'bold') {
        msg_el.style.setProperty('font-weight', 'bold');
      } else if (node.color === 'underline') {
        msg_el.style.setProperty('text-decoration', 'underline');
      } else if (node.color.endsWith('_bg')) {
        msg_el.style.setProperty(
          'background-color',
          node.color.substring(0, node.color.length - 3),
        );
      } else {
        msg_el.style.setProperty('color', node.color);
      }
      break;

    case 'player':
      stylePlayerElement(msg_el, node.player);
      break;

    case 'item':
      styleItemElement(msg_el, node.item);
      break;

    default:
      break;
  }
  text_log.appendChild(msg_el);
}
function addMessages(nodes: MessageNode[]) {
  nodes.forEach(addMessageNode);
  text_log.appendChild(document.createElement('br'));
}
client.messages.on('message', (message, nodes) => {
  console.log(message);
  const is_at_bottom =
    text_log.scrollTop >= text_log.scrollHeight - text_log.clientHeight - 4;
  if (text_log.childElementCount >= client.options.maximumMessages * 2) {
    text_log.removeChild(text_log.firstElementChild!);
    text_log.removeChild(text_log.firstElementChild!);
  }
  addMessages(nodes);
  if (is_at_bottom) {
    text_log.scrollTop = text_log.scrollHeight - text_log.clientHeight;
  }
});
const text_input_form = document.forms.namedItem('text-input')!;
const text_input = text_input_form.elements[0] as HTMLInputElement;
text_input_form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  client.messages.say(text_input.value);
  text_input.value = '';
});

/* Map */

function createMap(container: string) {
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

let game_map: maplibregl.Map | null = null;
let home_marker: maplibregl.Marker | null = null;
function setUpMap() {
  if (game_map) {
    return;
  }
  game_map = createMap('map');
  setUpHomeMarker();
}
function setUpHomeMarker() {
  if (!home) {
    return;
  }
  if (!game_map) {
    return;
  }
  if (home_marker) {
    home_marker.setLngLat(home);
  } else {
    home_marker = new maplibregl.Marker();
    home_marker.setLngLat(home);
    home_marker.addTo(game_map);
  }
}

/* Hints */

const hint_table = document.getElementById('hint-table')!;
function addHint(hint: Hint) {
  const row = document.createElement('tr');

  const receiver = document.createElement('td');
  receiver.classList.add('player');
  stylePlayerElement(receiver, hint.item.receiver);
  receiver.appendChild(document.createTextNode(hint.item.receiver.name));
  row.appendChild(receiver);

  const item = document.createElement('td');
  item.classList.add('item');
  styleItemElement(item, hint.item);
  item.appendChild(document.createTextNode(hint.item.name));
  row.appendChild(item);

  const sender = document.createElement('td');
  sender.classList.add('player');
  stylePlayerElement(sender, hint.item.sender);
  sender.appendChild(document.createTextNode(hint.item.sender.name));
  row.appendChild(sender);

  const location = document.createElement('td');
  location.classList.add('location');
  location.appendChild(document.createTextNode(hint.item.locationName));
  row.appendChild(location);

  const entrance = document.createElement('td');
  entrance.classList.add('entrance');
  entrance.appendChild(document.createTextNode(hint.entrance));
  row.appendChild(entrance);

  const status = document.createElement('td');
  status.appendChild(document.createTextNode(hint.found ? '✓' : '✗'));
  row.appendChild(status);

  hint_table.appendChild(row);
}
client.items.on('hintsInitialized', (hints) => hints.forEach(addHint));
client.items.on('hintReceived', addHint);
// TODO: hintFound. how to find the right row?
