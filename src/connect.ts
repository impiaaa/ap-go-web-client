import init from "@pkgs/gen";
import i18next from "i18next";
import maplibregl, { LngLat } from "maplibre-gl";
import {
  checkLocations,
  ensureLocationsScouted,
  loadGame,
  moveGameState,
  saveGame,
} from "./gameplay";
import { generate } from "./generate";
import {
  cheat,
  client,
  DATAPACKAGE_KEY,
  DEFAULT_OVERPASS_QUERY,
  game_data,
  game_state,
  PREFS_KEY,
  prefs,
  setSlotData,
} from "./globals";
import {
  createMap,
  fitMapToPoints,
  setUpHomeMarker,
  updateMapLocation,
  updateMapLocationError,
  updateMarker,
} from "./map";
import { type APGoSlotData, GameState } from "./types";
import { roundCoordinates } from "./utils";

const setup_form = document.forms.namedItem("connect-form")!;
const set_home_button = document.getElementById(
  "set-home",
) as HTMLButtonElement;
const open_advanced_settings_button = document.getElementById(
  "open-advanced-settings",
) as HTMLButtonElement;
const connect_button = document.getElementById("connect") as HTMLButtonElement;
const msgbox = document.getElementById("connection-message")!;
let watch_id = -1;
let last_disconnect_was_intentional = false;

function onSubmit(ev: SubmitEvent) {
  ev.preventDefault();
  if (client.socket.connected) {
    last_disconnect_was_intentional = true;
    client.socket.disconnect();
  } else {
    doLogin(true);
  }
}

export function setFormDisabled(disabled: boolean) {
  (setup_form.elements.namedItem("ip") as HTMLInputElement).disabled = disabled;
  (setup_form.elements.namedItem("port") as HTMLInputElement).disabled =
    disabled;
  (setup_form.elements.namedItem("player") as HTMLInputElement).disabled =
    disabled;
  (setup_form.elements.namedItem("password") as HTMLInputElement).disabled =
    disabled;
  set_home_button.disabled = disabled;
  open_advanced_settings_button.disabled = disabled;
}

export function setConnectDisabled(disabled: boolean) {
  connect_button.disabled = disabled;
}

export function setConnectText(textIsConnect: boolean) {
  connect_button.innerText = textIsConnect
    ? i18next.t("connect.connect", "Connect")
    : i18next.t("connect.disconnect", "Disconnect");
}

export function setConnectionMessage(message: string) {
  msgbox.classList.remove("error");
  msgbox.innerText = message;
}

export function setConnectionError(message: string) {
  msgbox.innerText = message;
  msgbox.classList.add("error");
}

export function stopTracking() {
  if (watch_id >= 0) {
    navigator.geolocation.clearWatch(watch_id);
    watch_id = -1;
  }
}

function doLogin(thenShowMap: boolean) {
  const ip = setup_form.elements.namedItem("ip") as HTMLInputElement;
  const port = setup_form.elements.namedItem("port") as HTMLInputElement;
  const player = setup_form.elements.namedItem("player") as HTMLInputElement;
  const password = setup_form.elements.namedItem(
    "password",
  ) as HTMLInputElement;

  if (!prefs.home) {
    setConnectionError(
      i18next.t("connect.error.no-home", "Set a home location"),
    );
    return;
  }

  moveGameState(GameState.Connecting);

  client
    .login<APGoSlotData>(
      `${ip.value}:${port.value}`,
      player.value,
      "Archipela-Go!",
      { password: password.value },
    )
    .then((new_slot_info) => {
      console.log("Connected!");

      // Cache the AP data package in localStorage.
      // The AP data package includes a mapping between item ID and item name, and between location
      // ID and location name, for every game in the current AP world. It's a lot of data, which
      // means it's good to cache it and not redownload it on every connection, but it also means we
      // have to be careful with storing it. Browser localStorage is limited to 5MiB. It's possible
      // that a very large AP world, with many different games each with many different locations
      // and items, would have a data package that exceeds this limit when encoded in UTF-16 JSON.
      // Since it is only a cache, then in that case, it is better to not store it and to redownload
      // each time, so that the user's connection preferences and current game don't get lost
      // instead.
      {
        const datapackage_str = JSON.stringify(client.package.exportPackage());
        if (datapackage_str.length < 2 * 1024 * 1024) {
          try {
            localStorage.setItem(DATAPACKAGE_KEY, datapackage_str);
          } catch (error) {
            console.error("Error saving data package:", error);
          }
        } else {
          console.warn(
            "Data package is very large, not caching!",
            datapackage_str.length,
          );
        }
      }

      setSlotData(new_slot_info);

      const doneGenerating = () => {
        moveGameState(GameState.ReadyNotTracking);
        setConnectionMessage("");

        if (thenShowMap) {
          window.location.hash = "#map";
          fitMapToPoints(false);
        }

        if (!cheat) {
          watch_id = navigator.geolocation.watchPosition(
            geoLocationUpdate,
            geoLocationError,
          );
        }
      };

      const did_load_points = loadGame();

      // Normally this is called from the locationsChecked event, but during initial connect, that
      // happens before loadGame, so we need to do it here as well.
      ensureLocationsScouted(client.room.checkedLocations);

      if (did_load_points) {
        console.log("Successfully loaded saved game, skipping generation");
        doneGenerating();
        return;
      }

      moveGameState(GameState.Generating);

      generate(client.room.seedName, client.players.self.slot)
        .then((generate_results) => {
          if (typeof generate_results === "string") {
            setConnectionError(
              i18next.t("connect.error.generation", {
                defaultValue: "Error during generation: {{generate_results}}",
                generate_results: generate_results,
              }),
            );
            last_disconnect_was_intentional = true;
            client.socket.disconnect();
            return;
          }
          game_data.points = generate_results as Map<number, [number, number]>;
          client.room.allLocations.forEach((location_id) => {
            updateMarker(location_id);
          });

          saveGame();

          doneGenerating();
        })
        .catch((reason) => {
          setConnectionError(
            i18next.t("connect.error.fetch", {
              defaultValue: "Error when fetching map data: {{reason}}",
              reason: reason,
            }),
          );
          last_disconnect_was_intentional = true;
          client.socket.disconnect();
        });
    })
    .catch((reason) => {
      console.error(reason);
      setConnectionError(reason);
      last_disconnect_was_intentional = true;
      moveGameState(GameState.Disconnected);
    });
}

function geoLocationUpdate(location: GeolocationPosition) {
  if (game_state === GameState.ReadyNotTracking) {
    moveGameState(GameState.Tracking);
  }
  checkLocations(
    new LngLat(location.coords.longitude, location.coords.latitude),
  );
  updateMapLocation(location);
}

function geoLocationError(error: GeolocationPositionError) {
  let message = error.message;
  if (error.code === GeolocationPositionError.PERMISSION_DENIED) {
    message += "\n";
    message += i18next.t(
      "connect.geolocation-error.reload",
      "Please reload and reconnect.",
    );
    alert(message);
  } else {
    message += "\n";
    message += i18next.t(
      "connect.geolocation-error.cheat",
      "Enable cheat mode?",
    );
    if (confirm(message)) {
      // TODO: add a way to unset cheat mode
      localStorage.setItem("cheat", "true");
      location.reload();
    }
  }
  // TODO: attempt to restart tracking
  // - what error code is when the app is backgrounded & comes back?
  //   do we just stop getting updates, so need our own timeout?
  // - check what MapLibre does
  // - after N retries, disconnect
  moveGameState(GameState.ReadyNotTracking);
  setConnectionMessage(i18next.t("connect.error.tracking", "Lost tracking"));
  updateMapLocationError(error);
}

function setUpSetHomeMap() {
  set_home_button.removeEventListener("click", setUpSetHomeMap);
  const map = createMap("set-home-map");
  if (prefs.home) {
    map.setZoom(9);
    map.setCenter(prefs.home);
  }
  map.addControl(new maplibregl.GeolocateControl({}));

  const overlay = document.createElement("div");

  const xhair = document.createElement("div");
  xhair.classList.add("crosshair");
  xhair.style.setProperty("top", "50%");
  xhair.style.setProperty("height", "1px");
  xhair.style.setProperty("width", "100%");
  overlay.appendChild(xhair);

  const yhair = document.createElement("div");
  yhair.classList.add("crosshair");
  yhair.style.setProperty("left", "50%");
  yhair.style.setProperty("width", "1px");
  yhair.style.setProperty("height", "100%");
  overlay.appendChild(yhair);

  map.getCanvasContainer().appendChild(overlay);

  map.on("move", () => {
    const center = map.project(roundCoordinates(map.getCenter()));
    yhair.style.setProperty("left", `${center.x}px`);
    xhair.style.setProperty("top", `${center.y}px`);
  });

  const set_home_dialog = document.getElementById(
    "set-home-dialog",
  ) as HTMLDialogElement;

  document.getElementById("save-home")?.addEventListener("click", () => {
    prefs.home = roundCoordinates(map.getCenter());
    set_home_button.classList.remove("invalid");
    setUpHomeMarker();
    set_home_dialog.close();
    saveConnectInfo();
  });

  set_home_dialog.addEventListener("toggle", (e) => {
    map.resize(e);
  });
}

function openAdvancedSettings() {
  (document.getElementById("overpass-server") as HTMLInputElement).value =
    prefs.overpass_server;
  (document.getElementById("overpass-query") as HTMLInputElement).value =
    prefs.overpass_query;
  (
    document.getElementById("advanced-settings-dialog") as HTMLDialogElement
  ).showModal();
}

function saveAdvancedSettings(ev: PointerEvent) {
  if (
    (
      document.getElementById("advanced-settings-form") as HTMLFormElement
    ).checkValidity()
  ) {
    ev.preventDefault();

    prefs.overpass_server = (
      document.getElementById("overpass-server") as HTMLInputElement
    ).value;

    const overpassQueryBox = document.getElementById(
      "overpass-query",
    ) as HTMLTextAreaElement;
    if (overpassQueryBox.value) {
      prefs.overpass_query = overpassQueryBox.value;
    } else {
      prefs.overpass_query = DEFAULT_OVERPASS_QUERY;
    }

    saveConnectInfo();
    (
      document.getElementById("advanced-settings-dialog") as HTMLDialogElement
    ).close();
  }
}

export function setUpConnectPage() {
  init();
  setConnectText(true);
  setup_form.addEventListener("submit", onSubmit);
  set_home_button.addEventListener("click", setUpSetHomeMap);
  set_home_button.addEventListener("click", () => {
    (
      document.getElementById("set-home-dialog") as HTMLDialogElement
    ).showModal();
  });
  open_advanced_settings_button.addEventListener("click", openAdvancedSettings);

  const datapackage_str = localStorage.getItem(DATAPACKAGE_KEY);
  if (datapackage_str) {
    client.package.importPackage(JSON.parse(datapackage_str));
  }

  client.socket.on("disconnected", () => {
    if (!last_disconnect_was_intentional) {
      // TODO: attempt to reconnect
      setConnectionError(
        i18next.t("connect.error.disconnected", "Disconnected"),
      );
    }
    last_disconnect_was_intentional = false;
    moveGameState(GameState.Disconnected);
  });

  const ip = setup_form.elements.namedItem("ip") as HTMLInputElement;
  const port = setup_form.elements.namedItem("port") as HTMLInputElement;
  const player = setup_form.elements.namedItem("player") as HTMLInputElement;
  const password = setup_form.elements.namedItem(
    "password",
  ) as HTMLInputElement;

  const prefs_str = localStorage.getItem(PREFS_KEY);
  if (prefs_str) {
    const prefs_json = JSON.parse(prefs_str);
    if (typeof prefs_json === "object") {
      const ip_json = prefs_json.ip;
      if (ip_json && typeof ip_json === "string") {
        ip.value = ip_json;
      }

      const port_json = prefs_json.port;
      if (port_json) {
        if (typeof port_json === "string") {
          port.value = port_json;
        } else if (typeof port_json === "number") {
          port.value = port_json.toString();
        }
      }

      const player_json = prefs_json.player;
      if (player_json && typeof player_json === "string") {
        player.value = player_json;
      }

      const password_json = prefs_json.password;
      if (password_json && typeof password_json === "string") {
        password.value = password_json;
      }

      const home_json = prefs_json.home;
      if (
        home_json &&
        Array.isArray(home_json) &&
        home_json.length === 2 &&
        typeof home_json[0] === "number" &&
        typeof home_json[1] === "number"
      ) {
        prefs.home = roundCoordinates(home_json as [number, number]);
      }

      const overpass_server_json = prefs_json.overpass_server;
      if (typeof overpass_server_json === "string") {
        prefs.overpass_server = overpass_server_json;
      }

      const overpass_query_json = prefs_json.overpass_query;
      if (typeof overpass_query_json === "string") {
        prefs.overpass_query = overpass_query_json;
      }
    } else {
      localStorage.removeItem(PREFS_KEY);
    }
  }

  (
    document.getElementById("save-advanced-settings") as HTMLButtonElement
  ).addEventListener("click", saveAdvancedSettings);

  if (!prefs.home) {
    set_home_button.classList.add("invalid");
  }

  ip.addEventListener("change", () => {
    if (setup_form.checkValidity()) saveConnectInfo();
  });
  port.addEventListener("change", () => {
    if (setup_form.checkValidity()) saveConnectInfo();
  });
  player.addEventListener("change", () => {
    if (setup_form.checkValidity()) saveConnectInfo();
  });
  password.addEventListener("change", () => {
    if (setup_form.checkValidity()) saveConnectInfo();
  });
}

function saveConnectInfo() {
  const ip = setup_form.elements.namedItem("ip") as HTMLInputElement;
  const port = setup_form.elements.namedItem("port") as HTMLInputElement;
  const player = setup_form.elements.namedItem("player") as HTMLInputElement;
  const password = setup_form.elements.namedItem(
    "password",
  ) as HTMLInputElement;
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      home: prefs.home,
      ip: ip.value,
      overpass_query: prefs.overpass_query,
      overpass_server: prefs.overpass_server,
      password: password.value,
      player: player.value,
      port: port.value,
    }),
  );
}
