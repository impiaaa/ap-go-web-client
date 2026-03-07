import './index.css';
import { setUpConnectPage } from './connect';
import { client, DATAPACKAGE_KEY, DEFAULT_PAGE, setHome } from './globals';
import { setUpHintsPage } from './hints';
import { setUpLogPage } from './log';
import { lateSetUpMap } from './map';

/* Client setup */

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
    home_json.length === 2 &&
    typeof home_json[0] === 'number' &&
    typeof home_json[1] === 'number'
  ) {
    setHome(home_json as [number, number]);
  } else {
    localStorage.removeItem('home');
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
  document.querySelectorAll(`nav a[href="#${new_hash}"]`).forEach((el) => {
    el.classList.add('active');
  });
  if (new_hash === 'map') {
    lateSetUpMap();
  }
}

window.addEventListener('hashchange', (ev) => {
  const old_hash = new URL(ev.oldURL).hash.substring(1);
  const new_hash = new URL(ev.newURL).hash.substring(1);
  document
    .getElementById(`page-${old_hash}`)
    ?.style.setProperty('display', 'none');
  document.querySelectorAll(`nav a[href="#${old_hash}"]`).forEach((el) => {
    el.classList.remove('active');
  });
  showPage(new_hash);
});
window.addEventListener('load', () => {
  showPage(window.location.hash.substring(1));
});

/* Connection page */

setUpConnectPage();

/* Text client */

setUpLogPage();

/* Map */

// map setup is done late, in showPage

/* Hints */

setUpHintsPage();
