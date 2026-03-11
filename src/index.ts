import './index.css';
import { setUpConnectPage } from './connect';
import { DEFAULT_PAGE } from './globals';
import { setUpHintsPage } from './hints';
import { setUpLogPage } from './log';
import { lateSetUpMap } from './map';
import { setUpGameplay } from './gameplay';

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
    el.setAttribute('aria-selected', 'true');
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
    el.setAttribute('aria-selected', 'false');
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

/* Other non-page setup */

setUpGameplay();
