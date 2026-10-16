# RC Helper

RC Helper is a Chrome extension for RollerCoin. It selects supported games, runs their included bots, and collects available rewards. Use the extension in accordance with RollerCoin's terms.

## Features

- Automatically selects an enabled, supported game.
- Includes bots for Hamster Climber, Coin Fisher, Coin Flip, Coin Match, Coin Click, 2048 Coins, Flappy Rocket, and Token Blaster. Each bot can be toggled in the popup.
- Automatically collects available game rewards.
- Fast Next Game can claim rewards and return to game selection without waiting for the final result screen.
- Toggle each game bot independently from the popup.

## Install

1. Download and extract the latest ZIP from [GitHub Releases](https://github.com/zunTd/Rollerbot/releases/latest), or use this repository folder.
2. Open `chrome://extensions` in Chrome or a Chromium-based browser.
3. Enable **Developer mode** and select **Load unpacked**.
4. Choose the extracted extension folder.
5. Open RollerCoin, open the RC Helper popup, and enable **Auto-Play**.

## Use

- **Auto-Play** selects and starts eligible games. Disable individual bots in the **Game Bots** section to exclude them.
- **Auto Collect** clicks supported reward and collect controls when they appear.
- **Fast Next Game** attempts to claim rewards and move directly to the next game.

## Data and Permissions

Settings and bot preferences are stored locally with `chrome.storage.local`. The extension checks GitHub Releases for version updates.

The manifest requests:

- `storage` for settings and bot preferences.
- `tabs` for popup-to-tab messaging.
- `windows` to open the popup in a separate window.
- RollerCoin host access to run content scripts on the game site.

## Source Layout

- `manifest.json` declares extension permissions and content scripts.
- `content.js` manages autoplay state and reward collection.
- `game-selection.js` detects and selects eligible games.
- `reward-flow.js` handles fast reward collection and game navigation.
- `popup.html` and `popup.js` implement the control panel.
- `games/` contains the game-specific bots. Most run in the page's main world to access game state.

There is no build step or package dependency. Load the repository folder as an unpacked extension to test it.
