import { Client } from 'archipelago.js';
import type { APGoSlotData } from './types';

export const DATAPACKAGE_KEY = 'datapackage_cache';
export const DEFAULT_PAGE = 'connect';

export let home: [number, number] | null = null;
export function setHome(new_home: [number, number]) {
  home = new_home;
}
export let slot_data: APGoSlotData | null = null;
export function setSlotData(new_slot_data: APGoSlotData) {
  slot_data = new_slot_data;
}
export const client = new Client();

declare global {
  interface Window {
    client: Client;
  }
}
window.client = client; // debug access
