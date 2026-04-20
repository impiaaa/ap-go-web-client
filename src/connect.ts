import maplibregl, { LngLat } from "maplibre-gl";
import { checkLocations, moveGameState, saveGame } from "./gameplay";
import { generate } from "./generate";
import {
  COLLECTION_DISTANCE_BASE,
  cheat,
  client,
  DATAPACKAGE_KEY,
  game_state,
  home,
  PREFS_KEY,
  points,
  SAVED_GAME_KEY,
  setHome,
  setPoints,
  setScoutedLocations,
  setSlotData,
} from "./globals";
import { addMessages } from "./log";
import {
  createMap,
  fitMapToPoints,
  setUpHomeMarker,
  updateMarker,
} from "./map";
import { type APGoSlotData, GameState } from "./types";

const setup_form = document.forms.namedItem("connect-form")!;
const set_home_button = document.getElementById(
  "set-home",
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
}

export function setConnectDisabled(disabled: boolean) {
  connect_button.disabled = disabled;
}

export function setConnectText(textIsConnect: boolean) {
  connect_button.innerText = textIsConnect ? "Connect" : "Disconnect";
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

  if (!home) {
    setConnectionError("Set a home location");
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
      localStorage.setItem(
        DATAPACKAGE_KEY,
        JSON.stringify(client.package.exportPackage()),
      );
      setSlotData(new_slot_info);

      const text_log = document.getElementById("text-log")!;
      text_log.childNodes.forEach((c) => {
        text_log.removeChild(c);
      });
      client.messages.log.forEach((line) => {
        addMessages(line.nodes);
        text_log.appendChild(document.createElement("br"));
      });
      text_log.scrollTop = text_log.scrollHeight - text_log.clientHeight;

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

      const saved_game_json = localStorage.getItem(SAVED_GAME_KEY);
      setScoutedLocations({});
      if (saved_game_json) {
        const saved_game = JSON.parse(saved_game_json);
        if (saved_game && saved_game.seed === client.room.seedName) {
          if (saved_game.scouted_locations) {
            setScoutedLocations(saved_game.scouted_locations);
          }
          if (
            saved_game.points &&
            saved_game.home &&
            Array.isArray(saved_game.home) &&
            saved_game.home.length === 2 &&
            home &&
            LngLat.convert(saved_game.home).distanceTo(LngLat.convert(home)) <
              COLLECTION_DISTANCE_BASE
          ) {
            setPoints(saved_game.points);
            for (const location_id in points) {
              updateMarker(parseInt(location_id, 10));
            }
            doneGenerating();
            return;
          }
        }
      }

      moveGameState(GameState.Generating);

      generate(client.room.seedName, client.players.self.slot)
        .then((trip_points) => {
          if (trip_points === null) {
            setConnectionError("Error during generation");
            last_disconnect_was_intentional = true;
            client.socket.disconnect();
            return;
          }
          client.room.allLocations.forEach((location_id) => {
            const location_name = client.package.lookupLocationName(
              client.game,
              location_id,
            );
            const trip_point = trip_points.get(location_name);
            if (trip_point) {
              points[`${location_id}`] = trip_point as [number, number];
              updateMarker(location_id);
            }
          });

          saveGame();

          doneGenerating();
        })
        .catch((reason) => {
          setConnectionError(`Error when fetching map data: ${reason}`);
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
  const coords = new LngLat(
    location.coords.longitude,
    location.coords.latitude,
  );
  checkLocations(coords);
}

function geoLocationError(error: GeolocationPositionError) {
  let message = error.message;
  if (error.code === GeolocationPositionError.PERMISSION_DENIED) {
    message += "\nPlease reload and reconnect.";
    alert(message);
  } else {
    message += "\nEnable cheat mode?";
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
  setConnectionMessage("Lost tracking");
}

function setUpSetHomeMap() {
  set_home_button.removeEventListener("click", setUpSetHomeMap);
  const map = createMap("set-home-map");
  if (home) {
    map.setZoom(9);
    map.setCenter(home);
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

  const set_home_dialog = document.getElementById(
    "set-home-dialog",
  ) as HTMLDialogElement;

  document.getElementById("save-home")?.addEventListener("click", () => {
    const new_home = map.getCenter().toArray();
    setHome(new_home);
    const set_home = setup_form.querySelector("#set-home") as HTMLButtonElement;
    set_home.classList.remove("invalid");
    setUpHomeMarker();
    set_home_dialog.close();
    saveConnectInfo();
  });

  set_home_dialog.addEventListener("toggle", (e) => {
    map.resize(e);
  });
}
set_home_button.addEventListener("click", setUpSetHomeMap);

export function setUpConnectPage() {
  setConnectText(true);
  setup_form.addEventListener("submit", onSubmit);
  set_home_button.addEventListener("click", () => {
    (
      document.getElementById("set-home-dialog") as HTMLDialogElement
    ).showModal();
  });

  const datapackage_str = localStorage.getItem(DATAPACKAGE_KEY);
  if (datapackage_str) {
    client.package.importPackage(JSON.parse(datapackage_str));
  }

  client.socket.on("disconnected", () => {
    if (!last_disconnect_was_intentional) {
      // TODO: attempt to reconnect
      setConnectionError("Disconnected");
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
        setHome(home_json as [number, number]);
      }

      if (setup_form.checkValidity() && home) {
        doLogin(false);
      } else {
        window.location.hash = "#connect";
      }
    } else {
      localStorage.removeItem(PREFS_KEY);
      if (window.location.hash !== "#connect") {
        window.location.hash = "#connect";
      }
    }
  } else {
    if (window.location.hash !== "#connect") {
      window.location.hash = "#connect";
    }
  }

  const set_home = setup_form.querySelector("#set-home") as HTMLButtonElement;
  if (!home) {
    set_home.classList.add("invalid");
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
      home: home,
      ip: ip.value,
      password: password.value,
      player: player.value,
      port: port.value,
    }),
  );
}
