import type { Hint } from 'archipelago.js';
import { client } from './globals';
import { styleItemElement, stylePlayerElement } from './log';

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

export function setUpHintsPage() {
  client.items.on('hintsInitialized', (hints) => hints.forEach(addHint));
  client.items.on('hintReceived', addHint);
  // TODO: hintFound. how to find the right row?
}
