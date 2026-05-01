import en from "../locales/en.json";
import "./index.css";
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import locI18next from "loc-i18next";
import { setUpConnectPage } from "./connect";
import { setUpGameplay } from "./gameplay";
import { DEFAULT_PAGE } from "./globals";
import { setUpHintsPage } from "./hints";
import { setUpLogPage } from "./log";
import { hideMapPage, showMapPage } from "./map";

i18next.use(LanguageDetector).init({
  debug: import.meta.env.DEV,
  resources: {
    en: en,
  },
  supportedLngs: ["en"],
});
const localize = locI18next.init(i18next);

/* Page layout */

function showPage(old_hash: string, new_hash: string) {
  let page = document.getElementById(`page-${new_hash}`);
  if (!page) {
    new_hash = DEFAULT_PAGE;
    window.history.replaceState({}, "", `#${new_hash}`);
    page = document.getElementById(`page-${new_hash}`);
    if (!page) {
      throw "no default page";
    }
  }
  page.style.removeProperty("display");
  document.querySelectorAll(`nav a[href="#${new_hash}"]`).forEach((el) => {
    el.setAttribute("aria-selected", "true");
    el.classList.add("active");
  });
  if (old_hash === "map") {
    hideMapPage();
  }
  if (new_hash === "map") {
    showMapPage();
  }
}

window.addEventListener("hashchange", (ev) => {
  const old_hash = new URL(ev.oldURL).hash.substring(1);
  const new_hash = new URL(ev.newURL).hash.substring(1);
  document
    .getElementById(`page-${old_hash}`)
    ?.style.setProperty("display", "none");
  document.querySelectorAll(`nav a[href="#${old_hash}"]`).forEach((el) => {
    el.setAttribute("aria-selected", "false");
    el.classList.remove("active");
  });
  showPage(old_hash, new_hash);
});

window.addEventListener("load", () => {
  localize("html");
  if (i18next.resolvedLanguage) {
    document.documentElement.setAttribute("lang", i18next.resolvedLanguage);
    document.documentElement.setAttribute("dir", i18next.dir());
  }
  showPage("", window.location.hash.substring(1));
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
