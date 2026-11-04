# Deploying the Screen Time server on Unraid

The server (the API and the parent web app) and its PostgreSQL database run as one Docker Compose stack on the Unraid server **SlimMamma** (`192.168.0.148`). Everyone reaches it at **https://screentime.gallagherhome.au** through the existing Cloudflare Tunnel (docs/SPEC.md §4.2). This guide sets it up once, then covers updates, backups and restores.

How it fits together:

- **The image** `ghcr.io/jamesgallagher/screentime-server` is built by GitHub Actions (`.github/workflows/server-image.yml`) on every push to `main` that changes the server, the web app or what they use. It is tagged `latest` and with the commit. Unraid pulls it; nothing is built on Unraid.
- **The stack** lives in `/mnt/user/appdata/screentime/`: `docker-compose.yml`, `backup.sh` (both from `deploy/unraid/` in the repo) and `.env` (secrets, only on the server). Three containers: `db` (PostgreSQL 18, data in `/mnt/user/appdata/screentime/postgres`), `api`, and `backup`.
- **The API listens only on Docker's bridge**, `172.17.0.1:8086`. The `cloudflared` container (on that bridge) reaches it there; the LAN does not. Port 8080 on Unraid belongs to qBittorrent.
- **The tunnel route** `screentime.gallagherhome.au` → `http://172.17.0.1:8086` is set in the Cloudflare dashboard. Do **not** put Cloudflare Access in front of it: kid devices sign in with their own tokens on `/v1/*`.
- **Backups:** the `backup` container runs `pg_dump` every night at 02:30 (Sydney) into `/mnt/user/Backup/screentime/`, keeping 30 days.

All commands below run on the Unraid server over SSH (`ssh root@192.168.0.148`) unless they say otherwise.

## First-time setup

### 1. The folder and the files

```sh
mkdir -p /mnt/user/appdata/screentime/postgres /mnt/user/Backup/screentime
cd /mnt/user/appdata/screentime
base=https://raw.githubusercontent.com/jamesgallagher/ScreenTime/main/deploy/unraid
curl -fsSLO "$base/docker-compose.yml" && curl -fsSLO "$base/backup.sh" && curl -fsSL "$base/.env.example" -o .env.example
```

### 2. The secrets (`.env`)

Make `.env` with fresh random secrets (never printed), readable by root only:

```sh
cd /mnt/user/appdata/screentime
cp .env.example .env && chmod 600 .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 33 | tr -d '/+=')|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=')|" .env
```

Then fill in, with `nano .env`:

- `SUPER_ADMIN_EMAIL`: the email that creates the family (step 5).
- `SMTP_USER` and `SMTP_PASS`: Brevo's SMTP login and SMTP key (Brevo, SMTP & API, SMTP). Without them sign-in codes are only written to the `api` log.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: the Firebase service account key of project `screentime-d307c` as one line in single quotes. From a PC with the key file:
  ```powershell
  $json = Get-Content firebase-service-account.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 5
  "FIREBASE_SERVICE_ACCOUNT_JSON='$json'" | ssh root@192.168.0.148 "cd /mnt/user/appdata/screentime && sed -i '/^FIREBASE_SERVICE_ACCOUNT_JSON=/d' .env && cat >> .env"
  ```

`POSTGRES_PASSWORD` is only read when the database is first created: changing it later needs `ALTER USER` in the database as well.

### 3. Start it

```sh
cd /mnt/user/appdata/screentime
docker compose pull && docker compose up -d --wait
docker compose ps
curl -s http://172.17.0.1:8086/health
docker compose logs api | grep "database migrations applied"
```

`/health` answers `{"status":"ok","service":"screentime-server",...}`.

### 4. The tunnel route

In the Cloudflare dashboard: **Zero Trust**, **Networks**, **Tunnels**, the tunnel that the `cloudflared` container runs, **Public Hostname**, **Add a public hostname**:

| Field | Value |
|---|---|
| Subdomain | `screentime` |
| Domain | `gallagherhome.au` |
| Path | (empty) |
| Service | `HTTP` `172.17.0.1:8086` |

Saving it also makes the DNS record. Check from any PC: `curl https://screentime.gallagherhome.au/health`.

### 5. The family

Open https://screentime.gallagherhome.au, sign in with `SUPER_ADMIN_EMAIL` (the code arrives by email), and in **Admin** create the family with its time zone, emergency number and first parent. Then add the kids, and their devices (docs/guides/android-provisioning.md, and for a PC the MSI and **Screen Time Setup**).

## Updating

Merging to `main` publishes a new `latest` image (watch **Actions**, **Server image**). Then on Unraid:

```sh
cd /mnt/user/appdata/screentime
docker compose pull api && docker compose up -d --wait
docker compose logs --tail 20 api
```

Migrations run when the new `api` starts. If `docker-compose.yml` or `backup.sh` changed in the repo, fetch them again first (step 1's `curl` lines).

**Going back:** set `API_TAG=<commit sha>` in `.env` (any commit that published an image), then `docker compose up -d --wait`. Set it back to `latest` afterwards. A migration that already ran is not undone: restore a backup if a release broke the data.

## Backups

The `backup` container logs each one: `docker compose logs backup`. Files are `/mnt/user/Backup/screentime/screentime-YYYY-MM-DD-HHMM.dump` (pg_dump's custom format).

- **One now:** `docker compose exec backup sh /backup.sh now`
- **Restore** (replaces the whole database; stop the API first):
  ```sh
  cd /mnt/user/appdata/screentime
  docker compose stop api
  docker compose exec -T db dropdb -U screentime --force screentime
  docker compose exec -T db createdb -U screentime screentime
  docker compose exec -T db pg_restore -U screentime -d screentime < /mnt/user/Backup/screentime/<file>.dump
  docker compose start api
  ```

## Looking after it

- **Logs:** `docker compose logs -f api` (sign-ins, enrolments, errors).
- **Health:** `curl -s http://172.17.0.1:8086/health` on Unraid, or https://screentime.gallagherhome.au/health from anywhere. Uptime Kuma (already on Unraid) can watch the public one.
- **A shell in the database:** `docker compose exec db psql -U screentime`.
- **Stop or start everything:** `docker compose stop` / `docker compose up -d --wait`. `docker compose down` is fine too; the data is in `postgres/`, not in a Docker volume. Never delete that folder.
