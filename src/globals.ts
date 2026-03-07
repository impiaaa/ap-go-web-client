import { Client } from 'archipelago.js';

export const DATAPACKAGE_KEY = 'datapackage_cache';
export const DEFAULT_PAGE = 'connect';

export let home: [number, number] | null = null;
export function setHome(new_home: [number, number]) {
  home = new_home;
}
export const client = new Client();

declare global {
  interface Window {
    client: Client;
  }
}
window.client = client; // debug access
