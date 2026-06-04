import MaplibreGeocoder, {
  type CarmenGeojsonFeature,
  type MaplibreGeocoderApiConfig,
  type MaplibreGeocoderFeatureResults,
} from "@maplibre/maplibre-gl-geocoder";
import init, { SubgraphSelection } from "@pkgs/gen";
import i18next from "i18next";
import maplibregl, { LngLat } from "maplibre-gl";
import {
  checkLocations,
  ensureLocationsScouted,
  loadGame,
  moveGameState,
  receiveItems,
  saveGame,
} from "./gameplay";
import { generate } from "./generate";
import {
  AP_GAME_NAME,
  cheat,
  client,
  DATAPACKAGE_KEY,
  DEFAULT_OVERPASS_QUERY,
  game_data,
  game_state,
  OLD_QUERY_DIGESTS,
  PREFS_KEY,
  prefs,
  setSlotData,
  TRAP_ITEMS,
} from "./globals";
import {
  createMap,
  fitMapToPoints,
  setUpHomeMarker,
  setUpMapLocations,
  updateMapLocation,
  updateMapLocationError,
} from "./map";
import { preloadAudio } from "./notifs";
import { type APGoSlotData, GameState, type ItemType } from "./types";
import { roundCoordinates } from "./utils";

const setup_form = document.forms.namedItem("connect-form")!;
const set_home_button = document.getElementById(
  "set-home",
) as HTMLButtonElement;
const open_generation_settings_button = document.getElementById(
  "open-generation-settings",
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
  open_generation_settings_button.disabled = disabled;
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
  setSlotData(null);

  client
    .login<APGoSlotData>(
      `${ip.value}:${port.value}`,
      player.value,
      AP_GAME_NAME,
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

      const did_load_points = loadGame();

      setSlotData(new_slot_info);

      // Normally these functions are called from the locationsChecked and itemsReceived events, but
      // they depend on information loaded in loadGame, and during initial connection, those events
      // are fired before we call loadGame here. So we need to call the functions here ourselves
      // after loadGame.
      ensureLocationsScouted(client.room.checkedLocations);
      receiveItems(
        client.items.received.filter((i) =>
          TRAP_ITEMS.includes(i.id as ItemType),
        ),
      );

      const doneGenerating = () => {
        setUpMapLocations();
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

const geocoderApi = {
  forwardGeocode: async (config: MaplibreGeocoderApiConfig) => {
    const features = [];
    try {
      const url = new URL(
        "https://nominatim.openstreetmap.org/search?format=jsonv2",
      );
      if (typeof config.query === "string")
        url.searchParams.append("q", config.query);
      if (config.limit !== undefined)
        url.searchParams.append("limit", config.limit.toString());
      if (config.language !== undefined)
        url.searchParams.append("accept-language", config.language);
      if (config.countries !== undefined)
        url.searchParams.append("countrycodes", config.countries);
      if (config.bbox !== undefined) {
        url.searchParams.append("viewbox", config.bbox.join(","));
        url.searchParams.append("bounded", "1");
      }
      const response = await fetch(url);
      for (const feature of await response.json()) {
        const bbox = feature.boundingbox.map(parseFloat); // min latitude, max latitude, min longitude, max longitude
        const center: [number, number] = [parseFloat(feature.lon), parseFloat(feature.lat)];
        const point: CarmenGeojsonFeature = {
          bbox: [bbox[2], bbox[0], bbox[3], bbox[1]],
          center: center,
          geometry: feature.geojson ?? {"coordinates": center, "type": "Point"},
          id: feature.place_id,
          place_name: feature.display_name,
          place_type: [feature.category],
          properties: feature.extratags,
          text: feature.name ?? feature.display_name,
          type: "Feature",
        };
        features.push(point);
      }
    } catch (e) {
      console.error(`Failed to forwardGeocode with error: ${e}`);
    }

    const results: MaplibreGeocoderFeatureResults = {
      features,
      type: "FeatureCollection",
    };
    return results;
  },
};

function setUpSetHomeMap() {
  set_home_button.removeEventListener("click", setUpSetHomeMap);
  const map = createMap("set-home-map");
  if (prefs.home) {
    map.setZoom(9);
    map.setCenter(prefs.home);
  }
  map.addControl(
    new MaplibreGeocoder(geocoderApi, {
      collapsed: true,
      maplibregl,
    }),
    "top-left",
  );
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

function openGenerationSettings() {
  (document.getElementById("overpass-server") as HTMLInputElement).value =
    prefs.overpass_server;
  (document.getElementById("overpass-query") as HTMLTextAreaElement).value =
    prefs.overpass_query;
  (document.getElementById("subgraph-selection") as HTMLSelectElement).value =
    prefs.subgraph_selection.toString();
  (
    document.getElementById("generation-settings-dialog") as HTMLDialogElement
  ).showModal();
}

function openAppSettings() {
  (document.getElementById("countdown-vox") as HTMLSelectElement).value =
    prefs.countdown_vox;
  (
    document.getElementById("countdown-vox-volume") as HTMLInputElement
  ).valueAsNumber = prefs.countdown_vox_volume;
  (document.getElementById("receive-sfx") as HTMLSelectElement).value =
    prefs.receive_sfx;
  (
    document.getElementById("receive-sfx-volume") as HTMLInputElement
  ).valueAsNumber = prefs.receive_sfx_volume;
  (document.getElementById("send-sfx") as HTMLSelectElement).value =
    prefs.send_sfx;
  (
    document.getElementById("send-sfx-volume") as HTMLInputElement
  ).valueAsNumber = prefs.send_sfx_volume;
  (document.getElementById("trap-duration") as HTMLInputElement).valueAsNumber =
    prefs.trap_duration;
  updateTrapDuration();
  (
    document.getElementById("app-settings-dialog") as HTMLDialogElement
  ).showModal();
}

function saveGenerationSettings(ev: PointerEvent) {
  const generation_settings_form = document.getElementById(
    "generation-settings-form",
  ) as HTMLFormElement;
  if (generation_settings_form.checkValidity()) {
    ev.preventDefault();

    const overpass_query =
      (
        generation_settings_form.elements.namedItem(
          "overpass-query",
        ) as HTMLTextAreaElement
      ).value || DEFAULT_OVERPASS_QUERY;
    const overpass_server = (
      generation_settings_form.elements.namedItem(
        "overpass-server",
      ) as HTMLInputElement
    ).value;
    const subgraph_selection = parseInt(
      (
        generation_settings_form.elements.namedItem(
          "subgraph-selection",
        ) as HTMLInputElement
      ).value,
      10,
    );

    if (
      overpass_query !== prefs.overpass_query ||
      overpass_server !== prefs.overpass_server ||
      subgraph_selection !== prefs.subgraph_selection
    ) {
      prefs.overpass_query = overpass_query;
      prefs.overpass_server = overpass_server;
      prefs.subgraph_selection = subgraph_selection;
      saveConnectInfo();
      game_data.points.clear();
      saveGame();
    }

    (
      document.getElementById("generation-settings-dialog") as HTMLDialogElement
    ).close();
  }
}

function saveAppSettings(ev: PointerEvent) {
  ev.preventDefault();
  const app_settings_form = document.getElementById(
    "app-settings-form",
  ) as HTMLFormElement;
  prefs.countdown_vox = (
    app_settings_form.elements.namedItem("countdown-vox") as HTMLSelectElement
  ).value;
  prefs.countdown_vox_volume = (
    app_settings_form.elements.namedItem(
      "countdown-vox-volume",
    ) as HTMLInputElement
  ).valueAsNumber;
  prefs.receive_sfx = (
    app_settings_form.elements.namedItem("receive-sfx") as HTMLSelectElement
  ).value;
  prefs.receive_sfx_volume = (
    app_settings_form.elements.namedItem(
      "receive-sfx-volume",
    ) as HTMLInputElement
  ).valueAsNumber;
  prefs.send_sfx = (
    app_settings_form.elements.namedItem("send-sfx") as HTMLSelectElement
  ).value;
  prefs.send_sfx_volume = (
    app_settings_form.elements.namedItem("send-sfx-volume") as HTMLInputElement
  ).valueAsNumber;
  prefs.trap_duration = (
    app_settings_form.elements.namedItem("trap-duration") as HTMLInputElement
  ).valueAsNumber;
  saveConnectInfo();
  preloadAudio();
  (document.getElementById("app-settings-dialog") as HTMLDialogElement).close();
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
  open_generation_settings_button.addEventListener(
    "click",
    openGenerationSettings,
  );
  document
    .getElementById("open-app-settings")
    ?.addEventListener("click", openAppSettings);

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
      if (overpass_server_json && typeof overpass_server_json === "string") {
        prefs.overpass_server = overpass_server_json;
      }

      const overpass_query_json = prefs_json.overpass_query;
      if (typeof overpass_query_json === "string") {
        if (window.isSecureContext) {
          window.crypto.subtle
            .digest("SHA-1", new TextEncoder().encode(overpass_query_json))
            .then((digest) => {
              const digest_array = Array.from(new Uint8Array(digest));
              const digest_hex = digest_array
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
              if (OLD_QUERY_DIGESTS.includes(digest_hex)) {
                console.log(
                  "Old default query detected, ignoring and using new default",
                );
              } else {
                prefs.overpass_query = overpass_query_json;
              }
            });
        } else {
          prefs.overpass_query = overpass_query_json;
        }
      }

      const subgraph_selection_json = prefs_json.subgraph_selection;
      if (
        typeof subgraph_selection_json === "number" &&
        SubgraphSelection[subgraph_selection_json]
      ) {
        prefs.subgraph_selection = subgraph_selection_json;
      }

      const show_checked_locations_json = prefs_json.show_checked_locations;
      if (typeof show_checked_locations_json === "boolean") {
        prefs.show_checked_locations = show_checked_locations_json;
      }

      const countdown_vox_json = prefs_json.countdown_vox;
      if (typeof countdown_vox_json === "string") {
        prefs.countdown_vox = countdown_vox_json;
      }

      const countdown_vox_volume_json = prefs_json.countdown_vox_volume;
      if (
        typeof countdown_vox_volume_json === "number" &&
        countdown_vox_volume_json >= 0
      ) {
        prefs.countdown_vox_volume = countdown_vox_volume_json;
      }

      const receive_sfx_json = prefs_json.receive_sfx;
      if (typeof receive_sfx_json === "string") {
        prefs.receive_sfx = receive_sfx_json;
      }

      const receive_sfx_volume_json = prefs_json.receive_sfx_volume;
      if (
        typeof receive_sfx_volume_json === "number" &&
        receive_sfx_volume_json >= 0
      ) {
        prefs.receive_sfx_volume = receive_sfx_volume_json;
      }

      const send_sfx_json = prefs_json.send_sfx;
      if (typeof send_sfx_json === "string") {
        prefs.send_sfx = send_sfx_json;
      }

      const send_sfx_volume_json = prefs_json.send_sfx_volume;
      if (
        typeof send_sfx_volume_json === "number" &&
        send_sfx_volume_json >= 0
      ) {
        prefs.send_sfx_volume = send_sfx_volume_json;
      }

      const trap_duration_json = prefs_json.trap_duration;
      if (typeof trap_duration_json === "number" && trap_duration_json > 0) {
        prefs.trap_duration = trap_duration_json;
      }

      preloadAudio();
    } else {
      localStorage.removeItem(PREFS_KEY);
    }
  }

  document
    .getElementById("save-generation-settings")
    ?.addEventListener("click", saveGenerationSettings);
  document
    .getElementById("save-app-settings")
    ?.addEventListener("click", saveAppSettings);
  document.getElementById("clear-all")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (
      confirm(
        i18next.t(
          "connect.app-settings-dialog.clear-all-confirm",
          "Erase all settings and data?",
        ),
      )
    ) {
      localStorage.clear();
      window.location.reload();
    }
  });

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

  trap_duration.addEventListener("input", updateTrapDuration);

  document
    .getElementById("countdown-vox")
    ?.addEventListener("input", testSound);
  document
    .getElementById("countdown-vox-volume")
    ?.addEventListener("change", testSound);
  document.getElementById("receive-sfx")?.addEventListener("input", testSound);
  document
    .getElementById("receive-sfx-volume")
    ?.addEventListener("change", testSound);
  document.getElementById("send-sfx")?.addEventListener("input", testSound);
  document
    .getElementById("send-sfx-volume")
    ?.addEventListener("change", testSound);

  const connecturl = URL.parse(document.URL)?.searchParams.get("connecturl");
  if (connecturl) {
    const connect_url = URL.parse(connecturl);
    if (connect_url && connect_url.searchParams.get("game") === AP_GAME_NAME) {
      window.location.hash = "#connect";
      player.value = connect_url.username;
      password.value =
        connect_url.password === "None" ? "" : connect_url.password;
      ip.value = connect_url.hostname;
      port.value = connect_url.port;
      if (setup_form.checkValidity()) {
        saveConnectInfo();
        doLogin(true);
      }
    }
  }
}

function testSound(this: HTMLElement) {
  let selection: HTMLSelectElement;
  let volume: HTMLInputElement;
  if (this.id.endsWith("-volume")) {
    const s = document.getElementById(
      this.id.substring(0, this.id.length - "-volume".length),
    );
    if (!(s instanceof HTMLSelectElement)) {
      throw "Invalid select element";
    }
    selection = s;

    if (!(this instanceof HTMLInputElement)) {
      throw "Invalid volume element";
    }
    volume = this;
  } else {
    if (!(this instanceof HTMLSelectElement)) {
      throw "Invalid select element";
    }
    selection = this;

    const v = document.getElementById(`${this.id}-volume`);
    if (!(v instanceof HTMLInputElement)) {
      throw "Invalid volume element";
    }
    volume = v;
  }
  if (selection.value.length > 0) {
    const a = new Audio(
      selection.id === "countdown-vox"
        ? `vox/${selection.value}/10.ogg`
        : `sfx/${selection.value}/Useful.${selection.value === "8bit" ? "mp3" : "ogg"}`,
    );
    a.volume = volume.valueAsNumber;
    a.play();
  }
}

const trap_duration = document.getElementById(
  "trap-duration",
) as HTMLInputElement;
const trap_duration_value = document.getElementById("trap-duration-value")!;
function updateTrapDuration() {
  trap_duration_value.innerText = i18next.t(
    "connect.app-settings-dialog.trap-duration-value",
    {
      defaultValue: "{{trap_duration.value}} sec",
      trap_duration: trap_duration,
    },
  );
}

export function saveConnectInfo() {
  const ip = setup_form.elements.namedItem("ip") as HTMLInputElement;
  const port = setup_form.elements.namedItem("port") as HTMLInputElement;
  const player = setup_form.elements.namedItem("player") as HTMLInputElement;
  const password = setup_form.elements.namedItem(
    "password",
  ) as HTMLInputElement;
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      ip: ip.value,
      password: password.value,
      player: player.value,
      port: port.value,
      ...prefs,
    }),
  );
}
