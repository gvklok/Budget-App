# Deploying to the Raspberry Pi

Goal: the app runs on the Pi 24/7, you and your wife reach it from your phones
over Tailscale, and it looks like an iPhone app via Add to Home Screen.

Works on a Pi 4 or 5 (64-bit). All images are multi-arch — no special builds.

## 1. One-time Pi setup (~15 min)

Flash **Raspberry Pi OS Lite (64-bit)** with the Raspberry Pi Imager (set your
username, wifi, and enable SSH in the imager's settings). Boot it, then SSH in:

```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in after this

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up               # log in with YOUR tailscale account

# Backup dependency
sudo apt-get install -y sqlite3 git
```

Share the Pi with your wife's Tailscale account: on the Tailscale admin
console → Machines → the Pi → **Share** (or put both accounts in one tailnet).

## 2. Get the app onto the Pi

From your Mac (repo root), either push to a private Git remote and clone it on
the Pi, or copy directly:

```bash
rsync -av --exclude node_modules --exclude data --exclude backups \
  "~/Documents/Budget App/" pi-hostname:~/budget-app/
```

## 3. Move your real data

Your data is one file. From the Mac:

```bash
# stop the Mac stack first so the file is quiescent
docker compose -f docker-compose.dev.yml down
scp data/budget.db pi-hostname:~/budget-app/data/budget.db
```

(Keep a Settings → Download backup JSON around too, belt and suspenders.)

## 4. Run it

On the Pi, in `~/budget-app`:

```bash
docker compose up --build -d
```

That's the **production** compose: nginx serves the built frontend on **:3000**
and proxies `/api` to the backend internally (the backend is not exposed to
the network at all). `restart: unless-stopped` means it survives reboots once
Docker is enabled (`sudo systemctl enable docker`, on by default).

Check it: `http://<pi-tailnet-name>:3000` from a phone on Tailscale.

## 5. Phones

On each iPhone (with the Tailscale app installed and connected):
open `http://<pi-tailnet-name>:3000` in Safari → Share → **Add to Home Screen**.
It launches standalone (no browser chrome), and pulls fresh data every time
the app regains focus.

## 6. Nightly backups

On the Pi:

```bash
crontab -e
# add:
15 3 * * * /home/YOURUSER/budget-app/deploy/backup.sh >> /home/YOURUSER/budget-app/backups/backup.log 2>&1
```

`deploy/backup.sh` uses SQLite's online backup (safe while the app runs) and
keeps 30 daily copies in `backups/`. Restoring = stop the stack, copy a backup
over `data/budget.db`, start the stack.

## 7. Updating the app later

```bash
# on the Pi, after rsync/pull of new code:
cd ~/budget-app
docker compose up --build -d    # rebuilds what changed, keeps your data
```

Database migrations run automatically at backend startup and are idempotent.

## Notes

- The Dev overlay is still there by design (Phase 1 testing surface) — its
  Reset All Data button wipes real data, so don't press it on the Pi.
- Nothing listens outside the Tailscale interface except LAN port 3000; if you
  want it locked to the tailnet only, either bind Docker's port to the
  tailscale IP (`ports: "100.x.y.z:3000:80"`) or just rely on your home LAN
  being trusted.
- Two users editing at once is supported (WAL + busy timeout + refresh on
  focus). Last write wins on the same field — fine for a household.
