import './index.css';
import { Client, type MessageNode } from 'archipelago.js';
import maplibregl from 'maplibre-gl';

/* Types */

type Trip = {
  distance_tier: number;
  key_needed: number;
  speed_tier: number;
};

type TripDict = {
  [index: string]: Trip;
};

type APGoSlotData = {
  goal: number;
  minimum_distance: number;
  maximum_distance: number;
  speed_requirement: number;
  trips: TripDict;
};

/* Client setup */

const client = new Client();

declare global {
  interface Window {
    client: Client;
    navTo: (dest_nav: HTMLElement, dest_name: string) => void;
  }
}
window.client = client; // debug access

const data = localStorage.getItem('datapackage_cache');
if (data) {
  client.package.importPackage(JSON.parse(data));
}

/* Page layout */

window.navTo = (dest_nav: HTMLElement, dest_name: string) => {
  const dest_section = document.getElementById(`page-${dest_name}`);
  const sections = document.getElementsByTagName('section');
  for (let i = 0; i < sections.length; i++) {
    const element = sections[i];
    if (element !== dest_section) {
      element.style.setProperty('display', 'none');
    }
  }
  dest_section?.style.removeProperty('display');

  dest_nav.classList.add('active');
  const nav_query = document.evaluate('//nav//a', document);
  // gather into a list to avoid "InvalidStateError: The document has been mutated since the result was returned"
  const navs: HTMLElement[] = [];
  let nav = nav_query.iterateNext();
  while (nav) {
    if (nav !== dest_nav) {
      navs.push(nav as HTMLElement);
    }
    nav = nav_query.iterateNext();
  }
  navs.forEach((nav) => {
    nav.classList.remove('active');
  });
};

/* Setup page */

const setup_form = document.forms.namedItem('setup-form')!;
setup_form.addEventListener('submit', (ev: SubmitEvent) => {
  ev.preventDefault();
  const ip = setup_form.elements.namedItem('ip') as HTMLInputElement;
  const port = setup_form.elements.namedItem('port') as HTMLInputElement;
  const player = setup_form.elements.namedItem('player') as HTMLInputElement;
  const password = setup_form.elements.namedItem(
    'password',
  ) as HTMLInputElement;
  const submit = setup_form.elements.namedItem('submit') as HTMLButtonElement;
  ip.disabled = true;
  port.disabled = true;
  player.disabled = true;
  password.disabled = true;
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
        'datapackage_cache',
        JSON.stringify(client.package.exportPackage()),
      );
      ip.disabled = false;
      port.disabled = false;
      player.disabled = false;
      password.disabled = false;
      submit.disabled = false;
      text_log.childNodes.forEach((c) => {
        text_log.removeChild(c);
      });
      client.messages.log.forEach((line) => {
        addMessages(line.nodes);
        text_log.appendChild(document.createElement('br'));
      });
      text_log.scrollTop = text_log.scrollHeight - text_log.clientHeight;
      window.navTo(document.getElementById('nav-text-client')!, 'text-client');
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

/* Text client */

const text_log = document.getElementById('text-log')!;
function addMessageNode(node: MessageNode) {
  const msg_el = document.createElement('span');
  const text_node = document.createTextNode(node.text);
  msg_el.appendChild(text_node);
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
      if (
        node.player.slot === client.players.self.slot ||
        client.players.slots[node.player.slot].group_members.includes(
          client.players.self.slot,
        )
      ) {
        msg_el.classList.add('self');
      }
      break;

    case 'item':
      if (node.item.progression) msg_el.classList.add('progression');
      if (node.item.useful) msg_el.classList.add('useful');
      if (node.item.trap) msg_el.classList.add('trap');
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

const darkModeMql = window.matchMedia?.('(prefers-color-scheme: dark)');
const map = new maplibregl.Map({
  container: 'map',
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
