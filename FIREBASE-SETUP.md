# Syncing Learning Quest scores across devices

By default, Learning Quest saves scores **on the device** it's played on. If you want Evelyn's and JD's
scores to follow them to any computer or tablet, you can connect the game to a free
**Firebase Realtime Database**. This is optional — the game works fine without it.

It takes about 10 minutes, once. You'll create a free database, copy one web address into
`index.html`, and use the same address on every device.

---

## Step 1 — Create a free Firebase project
1. Go to **https://console.firebase.google.com** and sign in with a Google account.
2. Click **Add project** (or **Create a project**).
3. Name it something like `math-quest`. Click through — you can **turn off Google Analytics**
   (not needed). Click **Create project**, then **Continue**.

## Step 2 — Create the Realtime Database
1. In the left menu, choose **Build → Realtime Database**.
2. Click **Create Database**.
3. Pick a location (the default/closest is fine).
4. When asked about security rules, choose **Start in test mode** and click **Enable**.

## Step 3 — Set the access rules
Test mode stops working after a month, so set permanent rules. Open the **Rules** tab (top of the
Realtime Database page), replace what's there with the rules below, and click **Publish**.

**Recommended (tightened):** confines all access to the game's own branch and checks that scores,
settings, and tricky-fact progress are sane values, so nobody can dump junk into your database or wipe
a player — without requiring the kids to log in:
```json
{
  "rules": {
    "mathquest": {
      "$family": {
        ".read": true,
        "settings": {
          "$name": {
            ".write": "newData.exists()",
            ".validate": "newData.hasChildren(['startLevel','ops','ts']) && newData.child('startLevel').isNumber() && newData.child('ops').isString() && newData.child('ts').isNumber()"
          }
        },
        "players": {
          "$name": {
            "history": {
              "$gameId": {
                ".write": "newData.exists()",
                ".validate": "newData.hasChildren(['score','level','solved','ts']) && newData.child('score').isNumber() && newData.child('level').isNumber() && newData.child('solved').isNumber() && newData.child('ts').isNumber()"
              }
            },
            "badges": {
              "$badgeId": {
                ".write": "newData.exists()",
                ".validate": "newData.isBoolean()"
              }
            },
            "cleared": {
              "$fact": {
                ".write": "newData.exists()",
                ".validate": "newData.isNumber()"
              }
            }
          }
        }
      }
    }
  }
}
```

What each part holds: `history` = every finished round (including which facts were missed),
`badges` = earned badges, `cleared` = tricky facts a kid has cleared in a drill, and `settings` =
each kid's starting level and switched-on operations from the ⚙️ Grown-ups screen.

> **Updating from an older version of these rules?** Just paste this whole block over the old one and
> click **Publish**. Until you do, scores still sync — only Grown-ups settings and cleared tricky facts
> stay on the device they were made on (the Grown-ups screen will say so).

*(Simplest alternative, if you just want it working fast: `{ "rules": { ".read": true, ".write": true } }`.
You can switch to the tightened rules above any time.)*

> **What this means (please read):** Even with the tightened rules, *anyone who knows your database
> web address* can still read the scores or write a (validly-shaped) fake score. There's no password —
> a website you open as a plain file can't keep one. The tightened rules stop **abuse** (junk data,
> wiping the database), and the long random address keeps it from being found, but **don't store
> anything private here.** For two kids' game scores, this is the right amount of caution.
>
> You can test rules safely with the **Rules Playground** (the "Simulator"/play button on the Rules
> page) before publishing.

## Step 4 — Copy your database web address
At the top of the Realtime Database page you'll see a URL like:

```
https://math-quest-1a2b3c-default-rtdb.firebaseio.com
```
or
```
https://math-quest-1a2b3c-default-rtdb.us-central1.firebasedatabase.app
```

Copy that whole address.

## Step 5 — Put it in the game
Open `index.html` in a text editor and find this near the top of the `<script>` section:

```js
const CLOUD = {
  url:    "PASTE_YOUR_FIREBASE_DATABASE_URL_HERE",
  family: "our-family",
};
```

- Replace `PASTE_YOUR_FIREBASE_DATABASE_URL_HERE` with your address (keep the quotes).
- Optionally change `"our-family"` to any word you like (e.g. `"smith-house"`). It just groups your
  family's scores together.

**Use the exact same `url` and `family` on every device** you want to share scores. That's the whole
trick — same two values = same scores everywhere.

*(If you'd rather, just send me the URL and the family word and I'll paste them in for you.)*

---

## How to tell it's working
- Open the game. The little pill in the **top-left corner** shows the status:
  - **💾 Local only** — no URL set yet (still saved on this device).
  - **☁️ Syncing…** — talking to the cloud right now.
  - **☁️ Synced** — scores are saved to the cloud. ✅
  - **⚠️ Offline – saved here** — no internet at the moment; scores are safe locally and will upload
    next time you're online.
- Play a round on one device, then open the game on a second device (with the same url + family) —
  that kid's score and badges should appear there too.

## Good to know
- **It works offline.** If the internet is down, the game still plays and saves locally, then syncs
  automatically next time it loads online.
- **Nothing is lost when two devices play.** Scores are *merged* (combined), never overwritten, so a
  game played on the tablet and a game played on the laptop both show up.
- **To start over**, you can delete the data in the Realtime Database page (the **Data** tab → hover
  the top node → trash icon). Each device also keeps a local copy in its browser.

## Want it back to device-only?
Just change `CLOUD.url` back to `"PASTE_YOUR_FIREBASE_DATABASE_URL_HERE"` (or any value containing
`PASTE_`) and the game returns to saving only on that device.
