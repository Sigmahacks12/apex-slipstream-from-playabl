import sdk from "@playabl/sdk";
import { createGame } from "./game/game.js";
import tweaksManifest from "./tweaks.json";
import assetsManifest from "./assets.json";
import "./styles.css";

const app = document.querySelector("#app");
await sdk.ready();
const tweaks = await sdk.tweaks.init(tweaksManifest);
const assets = Object.keys(assetsManifest).length > 0
  ? await sdk.assets.register(assetsManifest)
  : undefined;

// Keep bootstrap boring; build the actual game in src/game/game.js.
const game = createGame({ mount: app, sdk, tweaks, assets });
game.start();
