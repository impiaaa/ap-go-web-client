# Archipela-GO! Web Client

## Host an Archipelago Game

1. On a PC, install the [Archipelago software](https://archipelago.gg/tutorial/Archipelago/setup_en#installing-the-archipelago-software).
2. Download `apgo.apworld` and `Archipela-Go.yaml` from https://github.com/aki665/react-native-archipelago/releases
3. Install `apgo.apworld` using the "Install APWorld" option in the Archipelago Launcher.
4. Customize `Archipela-Go.yaml` as you see fit, or use the "Options Creator" in the Archipelago Launcher.
5. [Generate](https://archipelago.gg/tutorial/Archipelago/setup_en#generating-a-game) and [host](https://archipelago.gg/tutorial/Archipelago/setup_en#hosting-an-archipelago-server) a game.

## Join a Game

1. On a mobile device, visit the hosted app. The "official" location is currently https://www.boatcake.net/media/apgo/
2. Optionally add the web app to the home screen.
3. Enter the connection information for the hosted game. In the server log, it will show a message such as `You can connect to this room by using '/connect archipelago.gg:99999' in the client.` In this example, `archipelago.gg` is the address and `9999` is the port.
4. Enter the player name from your `Archipela-Go.yaml`.
5. If the hosted Archipelago game has a password, enter it, otherwise leave the password blank.
6. Press "Set Home Location…" and center the map on the location where you want to play the game, then press "Save."
7. Press "Connect." You may need to wait a few minutes for the game to generate locations. If you get an error, the server may be busy, or you may need to decrease the maximum radius in the YAML.

## Playing a Game

Once connected, your goal is to either collect "macguffin" letters, or to check all locations, depending on what you set in the YAML. The letters are scattered throughout your game and any other games connected to the same Archipelago game. To collect them or to help other players collect them, you must go to the locations on your map. Map pins with a lock icon won't become available until you collect enough keys.

## Developing and Hosting the App

Download the source code. On GitHub, the green "Code" button has options for checking out with Git over HTTPS or SSH, and for downloading a Zip.

In a terminal, `cd` to the source code directory.

Install the dependencies:

```bash
npm install
```

For development, you can start the dev server, and the app will be available at [http://localhost:3000](http://localhost:3000).

```bash
npm run dev
```

To host the app, first build the app for production:

```bash
npm run build
```

Optionally preview the production build locally:

```bash
npm run preview
```

The `dist` folder now contains the files needed to host the web app. Put these on a web server with HTTPS. If the app URL isn't at the root of the domain, or if you're using a CDN, add `assetPrefix` to the `output` section in `rsbuild.config.ts` (more info [here](https://rsbuild.rs/config/output/asset-prefix)).

If you've made any changes to files under `gen/`, `src/`, or `public/`, and you host the app publicly, you must also publish your changes. An easy way to do this is to fork the GitHub project, commit your changes on the fork, then update the "Source code" link in `src/index.html` to point to your fork.
