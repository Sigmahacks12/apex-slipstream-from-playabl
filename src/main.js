import sdk from "@playabl/sdk";
import { createGame } from "./game/game.js";
import tweaksManifest from "./tweaks.json";
import "./styles.css";

const app = document.querySelector("#app");
const activeSdk = await createHostSdk(sdk);
const tweaks = await activeSdk.tweaks.init(tweaksManifest);

// Keep bootstrap boring; build the actual game in src/game/game.js.
const game = createGame({ mount: app, sdk: activeSdk, tweaks });
game.start();

async function createHostSdk(playablSdk) {
  try {
    await withTimeout(playablSdk.ready(), 1600);
    return playablSdk;
  } catch {
    return createLocalSdk();
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Host SDK timeout")), ms);
    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function createLocalSdk() {
  return {
    tweaks: {
      async init(manifest) {
        return {
          get(key) {
            return manifest[key]?.value;
          },
          subscribe() {
            return () => {};
          },
        };
      },
    },
    gameState: {
      async load() {
        try {
          return JSON.parse(window.localStorage.getItem("apexSlipstream.save.v1") || "null");
        } catch {
          return null;
        }
      },
      async save(value) {
        try {
          window.localStorage.setItem("apexSlipstream.save.v1", JSON.stringify(value));
        } catch {
          // Static hosting can still play even if local storage is blocked.
        }
      },
    },
    leaderboard: {
      async submit() {},
    },
    audio: {
      async getContext() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const context = AudioContext ? new AudioContext() : null;
        return {
          context,
          async unlock() {
            await context?.resume?.();
          },
          dispose() {
            context?.close?.();
          },
        };
      },
    },
    device: {
      haptics: {
        isSupported() {
          return false;
        },
      },
    },
  };
}
