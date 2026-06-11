import type { ConnectedPacket, Item } from "archipelago.js";
import i18next from "i18next";
import maplibregl from "maplibre-gl";
import { saveConnectInfo, startTracking, stopTracking } from "./connect";
import { checkLocations, getKeyProgress, moveGameState } from "./gameplay";
import {
  COLLECTION_DISTANCE_BASE_M,
  cheat,
  client,
  game_state,
  LONG_MACGUFFIN_ITEMS,
  prefs,
  SHORT_MACGUFFIN_ITEMS,
  slot_data,
} from "./globals";
import { fitMapToPoints, setCirclesVisible, updateCircleCenters } from "./map";
import { type APGoSlotData, GameState, Goal, ItemType } from "./types";

// Source - https://stackoverflow.com/a/2450976
// Posted by ChristopheD, modified by community. See post 'Timeline' for change history
// Retrieved 2026-03-12, License - CC BY-SA 4.0
function shuffle<T>(array: Array<T>) {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex !== 0) {
    // Pick a remaining element...
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
}

const APColors = [
  "#C97682",
  "#75C275",
  "#EEE391",
  "#CA94C2",
  "#767EBD",
  "#D9A07D",
];

export class MacguffinDisplayControl implements maplibregl.IControl {
  private _container?: HTMLDivElement;
  private _letters: HTMLSpanElement[] = [];
  private _item_ids: number[] = [];
  onAdd(_map: maplibregl.Map): HTMLElement {
    this._container = document.createElement("div");
    this._container.className = "macguffin-control";
    this._container.style.visibility = "hidden";

    if (slot_data) {
      this.setUpLetters(slot_data);
    }
    client.socket.on("connected", this.onConnected.bind(this));
    client.socket.on("disconnected", this.onDisconnected.bind(this));
    client.items.on("itemsReceived", this.onItemsReceived.bind(this));

    return this._container;
  }
  private onConnected(packet: ConnectedPacket) {
    this.setUpLetters(packet.slot_data as APGoSlotData);
  }
  private onDisconnected() {
    this._letters.forEach((el) => {
      this._container?.removeChild(el);
    });
    if (this._container) {
      this._container.style.visibility = "hidden";
    }
    this._letters = [];
    this._item_ids = [];
  }
  private setItemReceived(index: number, el?: HTMLSpanElement) {
    if (!el) el = this._letters[index];
    el.className = "received";
    el.style.setProperty("color", APColors[index % APColors.length]);
  }
  private onItemsReceived(items: Item[]) {
    items.forEach((item) => {
      if (this._item_ids.includes(item.id)) {
        this.setItemReceived(this._item_ids.indexOf(item.id));
      }
    });
  }
  private setUpLetters(slot_data: APGoSlotData) {
    if (!slot_data) {
      console.error(
        "Trying to set up MacguffinDisplayControl with no slot data",
      );
      return;
    }
    shuffle(APColors);
    let letters: string;
    switch (slot_data.goal) {
      case Goal.ShortMacGuffin:
        letters = "AP-GO!";
        this._item_ids = SHORT_MACGUFFIN_ITEMS;
        break;
      case Goal.LongMacGuffin:
        letters = "Archipela-GO!";
        this._item_ids = LONG_MACGUFFIN_ITEMS;
        break;
      default:
        if (this._container) {
          this._container.style.visibility = "hidden";
        }
        return;
    }
    if (this._container) {
      this._container.style.visibility = "visible";
    }
    this._letters = Array.from(letters).map((letter, index) => {
      const el = document.createElement("span");
      el.textContent = letter;
      if (
        client.items.received.some((item) => item.id === this._item_ids[index])
      ) {
        this.setItemReceived(index, el);
      }
      this._container?.appendChild(el);
      return el;
    });
  }
  onRemove(_map: maplibregl.Map): void {
    this._container?.parentNode?.removeChild(this._container);
    this._letters = [];
    this._item_ids = [];
    client.socket.off("connected", this.onConnected.bind(this));
    client.socket.off("disconnected", this.onDisconnected.bind(this));
    client.items.off("itemsReceived", this.onItemsReceived.bind(this));
  }
  getDefaultPosition(): maplibregl.ControlPosition {
    return "top-left";
  }
}

export class KeyDisplayControl implements maplibregl.IControl {
  private _container?: HTMLDivElement;
  private _keys: HTMLImageElement[] = [];
  onAdd(_map: maplibregl.Map): HTMLElement {
    this._container = document.createElement("div");
    this._container.className = "keys-control";
    this._container.style.visibility = "hidden";

    if (slot_data) {
      this.setUpKeys(slot_data);
    }
    client.socket.on("connected", this.onConnected.bind(this));
    client.socket.on("disconnected", this.onDisconnected.bind(this));
    client.items.on("itemsReceived", this.onItemsReceived.bind(this));

    return this._container;
  }
  private onConnected(packet: ConnectedPacket) {
    this.setUpKeys(packet.slot_data as APGoSlotData);
  }
  private onDisconnected() {
    this._keys.forEach((el) => {
      this._container?.removeChild(el);
    });
    this._keys = [];
    if (this._container) {
      this._container.style.visibility = "hidden";
    }
  }
  private onItemsReceived(items: Item[]) {
    if (items.some((item) => item.id === ItemType.Key)) {
      this.updateKeys();
    }
  }
  private setUpKeys(slot_data: APGoSlotData) {
    if (!slot_data) {
      console.error("Trying to set up KeyDisplayControl with no slot data");
      return;
    }
    const max_keys = Math.max(
      ...Object.values(slot_data.trips).map((trip) => trip.key_needed),
    );
    if (max_keys === 0) {
      if (this._container) {
        this._container.style.visibility = "hidden";
      }
      return;
    }
    if (this._container) {
      this._container.style.visibility = "visible";
    }
    this._keys = new Array(max_keys);
    for (let i = 0; i < max_keys; i++) {
      const el = document.createElement("img");
      this._container?.appendChild(el);
      this._keys[i] = el;
    }
    this.updateKeys();
  }
  private updateKeys() {
    const key_count = getKeyProgress();
    this._keys.forEach((el, key) => {
      const has_key = key < key_count;
      el.src = has_key ? "key.svg" : "dot.svg";
      el.alt = `Key ${key + 1}`;
      if (!has_key) {
        el.alt += " (missing)";
      }
    });
  }
  onRemove(_map: maplibregl.Map): void {
    this._container?.parentNode?.removeChild(this._container);
    this._keys = [];
    client.socket.off("connected", this.onConnected.bind(this));
    client.socket.off("disconnected", this.onDisconnected.bind(this));
    client.items.off("itemsReceived", this.onItemsReceived.bind(this));
  }
  getDefaultPosition(): maplibregl.ControlPosition {
    return "bottom-left";
  }
}

export class MyGeolocateControl
  extends maplibregl.Evented
  implements maplibregl.IControl
{
  // Simplified version of the MapLibre geolocate control.
  // - Receives location updates from game
  // - Disabling tracking stops game tracking
  // - Draggable in cheat mode
  _map: maplibregl.Map | undefined;
  _container: HTMLElement | undefined;
  _dotElement: HTMLElement | undefined;
  _geolocateButton: HTMLButtonElement | undefined;
  _watchState:
    | "OFF"
    | "ACTIVE_LOCK"
    | "WAITING_ACTIVE"
    | "WAITING_BACKGROUND"
    | "ACTIVE_ERROR"
    | "BACKGROUND"
    | "BACKGROUND_ERROR" = "OFF";
  _lastKnownPosition: GeolocationPosition | undefined;
  _userLocationDotMarker: maplibregl.Marker | undefined;
  _setup: boolean = false; // set to true once the control has been setup

  onAdd(map: maplibregl.Map): HTMLElement {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this._setupUI();
    return this._container!;
  }

  onRemove() {
    // clear the markers from the map
    this._userLocationDotMarker?.remove();

    this._container?.remove();
    if (this._map) {
      this._map.off("movestart", this._onMoveStart);
      this._map = undefined;
    }

    client.socket.off("connected", this._onSocketConnected.bind(this));
    client.socket.off("disconnected", this._onSocketDisconnected.bind(this));
  }

  _isOutOfMapMaxBounds(position: GeolocationPosition) {
    if (!this._map) {
      return true;
    }
    const bounds = this._map.getMaxBounds();
    const coordinates = position.coords;

    return (
      bounds &&
      (coordinates.longitude < bounds.getWest() ||
        coordinates.longitude > bounds.getEast() ||
        coordinates.latitude < bounds.getSouth() ||
        coordinates.latitude > bounds.getNorth())
    );
  }

  _setErrorState() {
    switch (this._watchState) {
      case "WAITING_ACTIVE":
      case "ACTIVE_LOCK":
        this._moveToState("ACTIVE_ERROR");
        break;
      case "BACKGROUND":
      case "WAITING_BACKGROUND":
        this._moveToState("BACKGROUND_ERROR");
        break;
      case "ACTIVE_ERROR":
      case "BACKGROUND_ERROR":
        // already in error state
        break;
      case "OFF":
        // when not activated, watchState is 'OFF'
        // no error state transition is needed
        break;
      default:
        throw new Error(`Unexpected watchState ${this._watchState}`);
    }
  }

  onSuccess = (position: GeolocationPosition) => {
    if (!this._map) {
      // control has since been removed
      return;
    }

    if (this._isOutOfMapMaxBounds(position)) {
      this._setErrorState();

      return;
    }
    // keep a record of the position so that if the state is BACKGROUND and the user
    // clicks the button, we can move to ACTIVE_LOCK immediately without waiting for
    // watchPosition to trigger _onSuccess
    this._lastKnownPosition = position;

    switch (this._watchState) {
      case "WAITING_ACTIVE":
      case "ACTIVE_LOCK":
      case "ACTIVE_ERROR":
        this._moveToState("ACTIVE_LOCK");
        break;
      case "WAITING_BACKGROUND":
      case "BACKGROUND":
      case "BACKGROUND_ERROR":
      case "OFF":
        this._moveToState("BACKGROUND");
        break;
      default:
        throw new Error(`Unexpected watchState ${this._watchState}`);
    }

    // if showUserLocation and the watch state isn't off then update the marker location
    this._updateMarker(position);

    // if in normal mode (not watch mode), or if in watch mode and the state is active watch
    // then update the camera
    if (this._watchState === "ACTIVE_LOCK") {
      this._updateCamera(position);
    }

    this._dotElement?.classList.remove("maplibregl-user-location-dot-stale");
  };

  _updateCamera = (position: GeolocationPosition) => {
    if (!this._map) {
      return;
    }
    const center = new maplibregl.LngLat(
      position.coords.longitude,
      position.coords.latitude,
    );
    const radius = position.coords.accuracy;
    const bearing = this._map.getBearing();
    const options = { bearing, maxZoom: 15 };
    const newBounds = maplibregl.LngLatBounds.fromLngLat(center, radius);

    this._map.fitBounds(newBounds, options, {
      geolocateSource: true, // tag this camera change so it won't cause the control to change to background state
    });
  };

  _updateMarker = (position: GeolocationPosition) => {
    if (this._map)
      this._userLocationDotMarker
        ?.setLngLat(
          new maplibregl.LngLat(
            position.coords.longitude,
            position.coords.latitude,
          ),
        )
        .addTo(this._map);
  };

  onError = (error: GeolocationPositionError) => {
    if (!this._map) {
      // control has since been removed
      return;
    }

    if (error.code === 1) {
      // PERMISSION_DENIED
      this._moveToState("OFF");
      if (this._geolocateButton) {
        this._geolocateButton.disabled = true;
        const title = this._map._getUIString(
          "GeolocateControl.LocationNotAvailable",
        );
        this._geolocateButton.title = title;
        this._geolocateButton.setAttribute("aria-label", title);
      }
    } else {
      this._setErrorState();
    }

    if (this._watchState !== "OFF") {
      this._dotElement?.classList.add("maplibregl-user-location-dot-stale");
    }
  };

  _onMoveStart = (event: {
    geolocateSource: undefined | boolean;
    0: undefined | ResizeObserverEntry;
  }) => {
    if (!this._map) return;
    const fromResize = event?.[0] instanceof ResizeObserverEntry;
    if (!event.geolocateSource && !fromResize && !this._map.isZooming()) {
      if (this._watchState === "ACTIVE_LOCK") {
        this._moveToState("BACKGROUND");
      } else if (this._watchState === "WAITING_ACTIVE") {
        this._moveToState("WAITING_BACKGROUND");
      }
    }
  };

  _setupUI = () => {
    // the control could have been removed before reaching here
    if (!this._map) {
      return;
    }

    this._container?.addEventListener("contextmenu", (e: MouseEvent) => {
      e.preventDefault();
    });
    this._geolocateButton = document.createElement("button");
    this._geolocateButton.classList.add("maplibregl-ctrl-geolocate");
    this._container?.appendChild(this._geolocateButton);
    const icon = document.createElement("span");
    icon.classList.add("maplibregl-ctrl-icon");
    this._geolocateButton.appendChild(icon);
    icon.setAttribute("aria-hidden", "true");
    this._geolocateButton.type = "button";
    this._geolocateButton.disabled = true;

    // this method is called asynchronously during onAdd
    if (!this._map) {
      // control has since been removed
      return;
    }

    if (this._geolocateButton) {
      const title = this._map._getUIString("GeolocateControl.FindMyLocation");
      this._geolocateButton.disabled = false;
      this._geolocateButton.title = title;
      this._geolocateButton.setAttribute("aria-label", title);
      this._geolocateButton.setAttribute("aria-pressed", "false");
    }

    this._dotElement = document.createElement("div");
    this._dotElement.classList.add("maplibregl-user-location-dot");

    this._userLocationDotMarker = new maplibregl.Marker({
      element: this._dotElement,
    });
    if (cheat) {
      this._userLocationDotMarker.setDraggable(true);
      this._userLocationDotMarker.on("dragend", () => {
        if (game_state === GameState.ReadyNotTracking) {
          moveGameState(GameState.Tracking);
        }
        if (game_state === GameState.Tracking) {
          const center = this._userLocationDotMarker!.getLngLat();
          checkLocations(center);
          updateCircleCenters(center.lng, center.lat);
        }
      });
    }

    client.socket.on("connected", this._onSocketConnected.bind(this));
    client.socket.on("disconnected", this._onSocketDisconnected.bind(this));
    if (client.socket.connected) {
      this._onSocketConnected();
    }

    this._geolocateButton?.addEventListener("click", () => this.trigger());

    this._setup = true;

    // when the camera is changed (and it's not as a result of the Geolocation Control) change
    // the watch mode to background watch, so that the marker is updated but not the camera.
    this._map.on("movestart", this._onMoveStart);
  };

  _startCheat() {
    if (cheat) {
      const pos = this._lastKnownPosition
        ? [
            this._lastKnownPosition.coords.longitude,
            this._lastKnownPosition.coords.latitude,
          ]
        : prefs.home!;
      this.onSuccess({
        coords: {
          accuracy: COLLECTION_DISTANCE_BASE_M,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude: pos[1] + 0.001,
          longitude: pos[0] + 0.001,
          speed: null,
          toJSON: function () {
            return {
              accuracy: this.accuracy,
              altitude: this.altitude,
              altitudeAccuracy: this.altitudeAccuracy,
              heading: this.heading,
              latitude: this.latitude,
              longitude: this.longitude,
              speed: this.speed,
            };
          },
        },
        timestamp: 0,
        toJSON: function () {
          return { coords: this.coords, timestamp: this.timestamp };
        },
      });
    }
  }

  _onSocketConnected() {
    if (this._lastKnownPosition) {
      this._updateMarker(this._lastKnownPosition);
      this._moveToState("BACKGROUND");
    } else {
      this._moveToState("WAITING_BACKGROUND");
    }
    this._startCheat();
  }

  _onSocketDisconnected() {
    this._moveToState("OFF");
  }

  _moveToState(newState: typeof this._watchState) {
    switch (this._watchState) {
      case "ACTIVE_LOCK":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-active",
        );
        break;
      case "WAITING_ACTIVE":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-waiting",
          "maplibregl-ctrl-geolocate-active",
        );
        break;
      case "WAITING_BACKGROUND":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-waiting",
          "maplibregl-ctrl-geolocate-background",
        );
        break;
      case "ACTIVE_ERROR":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-active-error",
          "maplibregl-ctrl-geolocate-waiting",
        );
        break;
      case "BACKGROUND":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-background",
        );
        break;
      case "BACKGROUND_ERROR":
        this._geolocateButton?.classList.remove(
          "maplibregl-ctrl-geolocate-background-error",
          "maplibregl-ctrl-geolocate-waiting",
        );
        break;
    }
    switch (newState) {
      case "OFF":
        this._geolocateButton?.setAttribute("aria-pressed", "false");
        this._userLocationDotMarker?.remove();
        break;
      case "ACTIVE_LOCK":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-active",
        );
        break;
      case "WAITING_ACTIVE":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-waiting",
          "maplibregl-ctrl-geolocate-active",
        );
        break;
      case "WAITING_BACKGROUND":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-waiting",
          "maplibregl-ctrl-geolocate-background",
        );
        break;
      case "ACTIVE_ERROR":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-active-error",
          "maplibregl-ctrl-geolocate-waiting",
        );
        this._userLocationDotMarker?.remove();
        break;
      case "BACKGROUND":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-background",
        );
        break;
      case "BACKGROUND_ERROR":
        this._geolocateButton?.classList.add(
          "maplibregl-ctrl-geolocate-background-error",
          "maplibregl-ctrl-geolocate-waiting",
        );
        this._userLocationDotMarker?.remove();
        break;
    }
    if (newState !== "OFF") {
      this._geolocateButton?.setAttribute("aria-pressed", "true");
    }
    this._watchState = newState;
  }

  trigger(): boolean {
    if (!this._setup) {
      console.warn("Geolocate control triggered before added to a map");
      return false;
    }
    if (
      game_state !== GameState.Tracking &&
      game_state !== GameState.ReadyNotTracking
    ) {
      return false;
    }
    // update watchState and do any outgoing state cleanup
    switch (this._watchState) {
      case "OFF":
        this._moveToState("WAITING_BACKGROUND");
        startTracking();
        this._startCheat();
        break;
      case "ACTIVE_LOCK":
      case "WAITING_ACTIVE":
      case "ACTIVE_ERROR":
        //this._moveToState("BACKGROUND");
        stopTracking();
        moveGameState(GameState.ReadyNotTracking);
        setCirclesVisible("none");
        this._moveToState("OFF");
        break;
      case "WAITING_BACKGROUND":
        this._moveToState("WAITING_ACTIVE");
        break;
      case "BACKGROUND":
        this._moveToState("ACTIVE_LOCK");
        // set camera to last known location
        if (this._lastKnownPosition)
          this._updateCamera(this._lastKnownPosition);
        break;
      case "BACKGROUND_ERROR":
        this._moveToState("ACTIVE_ERROR");
        break;
      default:
        throw new Error(`Unexpected watchState ${this._watchState}`);
    }
    return true;
  }
}

export class FitMapToPointsControl implements maplibregl.IControl {
  private _container?: HTMLDivElement;
  private _button?: HTMLButtonElement;

  onAdd(_map: maplibregl.Map) {
    this._container = document.createElement("div");
    this._container.classList.add("maplibregl-ctrl");
    this._container.classList.add("maplibregl-ctrl-group");
    this._button = document.createElement("button");
    this._container.appendChild(this._button);
    const icon = document.createElement("img");
    icon.src = "ctrl-fit-points.svg";
    this._button.appendChild(icon);
    icon.setAttribute("aria-hidden", "true");
    this._button.type = "button";
    this._updateTitle();
    this._button.addEventListener("click", this._onClick);
    return this._container;
  }

  _updateTitle() {
    if (this._button) {
      const title = this._getTitle();
      this._button.setAttribute("aria-label", title);
      this._button.title = title;
    }
  }

  _getTitle() {
    return i18next.t("map.fit-to-points", "Center Map");
  }

  onRemove() {
    this._container?.parentNode?.removeChild(this._container);
  }

  _onClick() {
    fitMapToPoints(true);
  }
}

export class FilterControl implements maplibregl.IControl {
  private _container?: HTMLDivElement;
  private _button?: HTMLButtonElement;
  private _icon?: HTMLImageElement;
  private _map?: maplibregl.Map;

  onAdd(_map: maplibregl.Map) {
    this._container = document.createElement("div");
    this._container.classList.add("maplibregl-ctrl");
    this._container.classList.add("maplibregl-ctrl-group");
    this._button = document.createElement("button");
    this._container.appendChild(this._button);
    this._icon = document.createElement("img");
    this._icon.src = prefs.show_checked_locations
      ? "ctrl-filter.svg"
      : "ctrl-filter-enabled.svg";
    this._button.appendChild(this._icon);
    this._icon.setAttribute("aria-hidden", "true");
    this._button.type = "button";
    this._updateTitle();
    this._button.addEventListener("click", this._onClick.bind(this));
    _map.on("load", () => {
      _map.setGlobalStateProperty(
        "show_checked_locations",
        prefs.show_checked_locations,
      );
    });
    this._map = _map;
    return this._container;
  }

  _updateTitle() {
    if (this._button) {
      const title = this._getTitle();
      this._button.setAttribute("aria-label", title);
      this._button.title = title;
    }
  }

  _getTitle() {
    return i18next.t("map.show-checked-locations", "Show/Hide Checked");
  }

  onRemove() {
    this._container?.parentNode?.removeChild(this._container);
  }

  _onClick() {
    prefs.show_checked_locations = !prefs.show_checked_locations;
    saveConnectInfo();
    if (this._map?.loaded()) {
      this._map.setGlobalStateProperty(
        "show_checked_locations",
        prefs.show_checked_locations,
      );
    }
    if (this._icon) {
      this._icon.src = prefs.show_checked_locations
        ? "ctrl-filter.svg"
        : "ctrl-filter-enabled.svg";
    }
  }
}
