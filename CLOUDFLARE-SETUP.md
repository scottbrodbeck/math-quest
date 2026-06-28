# Hosting Math Quest on Cloudflare Pages

This connects your GitHub repo (`scottbrodbeck/math-quest`) to **Cloudflare Pages** so the game is
live on the web at a free `https://…pages.dev` address — and **auto-updates every time you
`git push`**. No local tools needed: Cloudflare builds everything in the cloud.

**Before you start:** make sure your latest code is pushed to GitHub (`git push`). Cloudflare deploys
whatever is on GitHub, not what's only on your computer.

---

## Step 1 — Create a free Cloudflare account
1. Go to **https://dash.cloudflare.com/sign-up** and sign up (free). Verify your email.

## Step 2 — Start a Pages project
1. In the Cloudflare dashboard left menu, click **Workers & Pages**.
2. Click **Create** → choose the **Pages** tab → **Connect to Git**
   (it may read "Import an existing Git repository").

## Step 3 — Connect GitHub and pick the repo
1. Click **Connect GitHub** and authorize Cloudflare when prompted.
2. You can grant access to **all repos** or **just `math-quest`** (just `math-quest` is fine, and
   keeps it tidy).
3. Back in Cloudflare, select **`scottbrodbeck/math-quest`** → **Begin setup**.

## Step 4 — Build settings (important — keep these minimal)
Math Quest is plain HTML/CSS/JS with **no build step**, so:
- **Project name:** `math-quest` (this becomes your URL: `math-quest.pages.dev`). Pick another name
  if that one's taken.
- **Production branch:** `main`
- **Framework preset:** **None**
- **Build command:** **leave empty**
- **Build output directory:** `/`  (just a slash — your files live at the repo root)

Then click **Save and Deploy**.

## Step 5 — Wait for the first deploy
Cloudflare pulls your repo and publishes it (usually under a minute). When it finishes, you'll get a
live link like:

```
https://math-quest.pages.dev
```

Click it — your game is on the web! 🎉

## Step 6 — Confirm it works
- The game loads with full styling.
- The **sync pill** (top-left) shows **☁️ Synced** — meaning it's talking to Firebase from the live
  site. (Reads/writes use HTTPS, which works the same as before.)
- Open it on a second device (phone/tablet) and a kid's scores should appear there too.

---

## How to update the live site from now on
Just push your changes — Cloudflare redeploys automatically:
```bash
cd "/Users/scottbrodbeck/Documents/Test Project"
git add -A
git commit -m "describe the change"
git push
```
Within ~30 seconds, `math-quest.pages.dev` reflects the update. (You can watch each deploy in the
Cloudflare dashboard under your project's **Deployments** tab.)

> **Bonus — preview links:** if you ever push to a *different* branch, Cloudflare builds a separate
> preview URL for it, so you can test changes before they hit the main site.

## Good to know
- **Private repo is fine.** Cloudflare Pages deploys from private repos for free, so your source
  (including the Firebase URL) can stay private even though the game itself is public.
- **The game is three files** (`index.html`, `styles.css`, `app.js`) — all are in the repo, so the
  whole thing deploys together automatically. Nothing extra to do.
- **Security reminder (same as always):** once the game is at a public URL, anyone who visits can
  view the page source and see the Firebase database URL. Your database **rules** still block junk
  data and wipes (worst case is a fake score), so this is fine for a kids' game — just don't share
  the link more widely than you want, and don't store anything private in that database.

## Optional — a custom domain
If you own a domain (e.g. via Cloudflare, GoDaddy, etc.), your Pages project has a **Custom domains**
tab where you can point something like `mathquest.yourdomain.com` at the site in a couple of clicks.

## Want it back to private/offline?
You can pause or delete the Pages project anytime in the dashboard (**Settings → Delete project**).
Your code stays safe in GitHub and on your computer regardless.
