# Putting Trackfire online

The game is one small Node.js server. It serves the web page **and** runs the
multiplayer rooms over WebSockets, so you deploy one thing and send your friends one URL.
It has no npm dependencies and no build step.

## Option A: Render (free, easiest)

1. Create a free GitHub account if you don't have one, make a new repository, and
   upload this folder to it (drag and drop in the GitHub web page works).
2. Sign up at https://render.com with your GitHub account.
3. Click **New → Blueprint**, pick your repository, and confirm. Render reads
   `render.yaml` and creates a free web service. (Or choose **New → Web Service**
   with *Build command* `echo ok` and *Start command* `node server/index.js`.)
   If you're asked for a region, pick the one closest to you and your friends
   (Frankfurt is usually best from the Middle East).
4. After a minute or two you get a URL like `https://trackfire-xyz.onrender.com`.
   That's your game. Send it to your friends.

Notes about the free tier:
- A free service goes to sleep after about 15 minutes with no traffic. The first
  person to open it wakes it up, which can take up to a minute. After that it's normal.
- Render keeps free services awake while WebSocket messages are flowing, so a match
  won't be cut off mid-game.
- Pick the region closest to you and your friends for the lowest ping.

## Option B: Fly.io (small monthly cost, always on, you choose the region)

Fly.io no longer has a free tier for new accounts, but a tiny machine for this
game costs a few dollars a month. Install `flyctl`, then:

```bash
fly launch --copy-config --no-deploy   # edit the app name / region in fly.toml
fly deploy
```

## Option C: Host it from your own PC (free, best ping for you)

1. Run `node server/index.js` on your computer.
2. Install Cloudflare's free `cloudflared` and run:
   `cloudflared tunnel --url http://localhost:8080`
3. It prints a public `https://….trycloudflare.com` address. Send that to your friends.
   It only works while your PC and that command are running.

## Option D: Website and server hosted separately

If you want the page on a static host (Netlify, Cloudflare Pages, GitHub Pages)
and the server elsewhere:
1. Upload only the `client/` folder to the static host.
2. Put your server's address in `client/server-config.js`:
   `window.TRACKFIRE_SERVER = 'wss://your-server.example.com/ws';`
3. Run the server anywhere that supports WebSockets (options A to C).

You can also point any copy of the page at a server with `?server=wss://…/ws` in the URL.

## Custom domain

Render and Fly.io both let you add your own domain (for example `mytankgame.example`)
in the service settings and handle HTTPS for you.

## Checking it works

- `https://your-url/health` should show `{"ok":true}`.
- `https://your-url/stats` lists the rooms currently open.
- In the game, press **F3** to see ping, snapshots per second and interpolation delay.

## Loading Three.js from your own server (optional)

The 3D engine (Three.js r149) loads from the jsDelivr CDN. To host it yourself,
download `three.module.js` (version 0.149.0) into `client/vendor/` and change the one
line in `client/js/three.js`.
