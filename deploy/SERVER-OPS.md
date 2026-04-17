# Hetzner server — operations guide

Živi inventory svega što radi na `46.224.158.221`. Kad se nešto zaglavi ili
treba restart/update, pogledaj ovdje prvo — piše ti gdje je kod, koji port,
kako se pali, gdje su logovi.

---

## 0. Brza orijentacija

| Podatak              | Vrijednost                                      |
|----------------------|-------------------------------------------------|
| **IP**               | `46.224.158.221`                                |
| **SSH**              | `ssh valentina@46.224.158.221`                  |
| **OS**               | Ubuntu 22.04.5 LTS                              |
| **RAM / Disk**       | 22 GB total (10 GB free) · 75 GB disk (22 GB free) |
| **Node / npm**       | v20.19.6 · 10.8.2                               |
| **nginx**            | 1.18.0 (Ubuntu)                                 |
| **certbot**          | installed (Let's Encrypt)                       |
| **MySQL**            | running                                         |
| **Redis**            | running (porta 6379)                            |
| **Process manager**  | PM2 (za 4 stara sajta) + systemd (za lessenza)  |

---

## 1. Sajtovi i portovi

Na nginx-u reverse-proxuju se 5 sajtova. Svaki ima svoj upstream Node proces
na localhost portu.

| Domen                         | Port  | Kod / proces manager                                          | Tech                |
|-------------------------------|-------|---------------------------------------------------------------|---------------------|
| **lessenza.me** + www         | 3000  | `/home/valentina/lessenza-web` · systemd `lessenza.service`   | Node/Express + SQLite |
| **putujzadz.me** + www        | 3001  | PM2 (pm2-valentina) · `/home/valentina/apps/putujzadz` *(provjeri)* | Next.js             |
| **dev.putujzadz.me**          | 3002  | PM2 + GitHub webhook na 9000 · `/home/valentina/apps/dev`     | Node dev            |
| **pozvaniste.me** + www       | 3003  | PM2                                                           | Next.js             |
| **racunajmo.com** + www       | 3004  | Node proces *(pokrenut ručno ili PM2 — provjeri `pm2 list`)*  | Node                |

### Kako je koji startovan

- **lessenza.me** → systemd: `sudo systemctl {start,stop,restart,status} lessenza`
- Ostali (putujzadz / pozvaniste / racunajmo / dev.putujzadz) → **PM2**:
  ```
  pm2 list                       # šta radi
  pm2 restart putujzadz          # restart po imenu
  pm2 logs putujzadz --lines 100 # logovi
  pm2 save                       # zapamti za reboot
  ```

---

## 2. SSL certifikati

Svi sajtovi idu preko Let's Encrypt. Auto-obnavljanje je default-no uključeno
u `certbot.timer` (systemd). Certovi se čuvaju u `/etc/letsencrypt/live/<domen>/`.

```bash
sudo certbot certificates           # svi certovi + datum isteka
sudo systemctl status certbot.timer # da li auto-renew radi
sudo certbot renew --dry-run        # simuliraj obnavljanje
```

Ako treba dodati **novi poddomen** na postojeći cert:
```
sudo certbot --nginx -d lessenza.me -d www.lessenza.me --expand
```

Ako treba **brisati cert** (rijetko):
```
sudo certbot delete --cert-name lessenza.me
```

---

## 3. nginx

```
/etc/nginx/sites-available/   ← glavni config fajlovi, edituj ovdje
/etc/nginx/sites-enabled/     ← symlink sites-available/* u ovo za "enable"
```

### Dodavanje novog sajta

1. `sudo nano /etc/nginx/sites-available/novi.com`
2. `sudo ln -s /etc/nginx/sites-available/novi.com /etc/nginx/sites-enabled/`
3. `sudo nginx -t` (mora reći `syntax is ok, test is successful`)
4. `sudo systemctl reload nginx`
5. `sudo certbot --nginx -d novi.com -d www.novi.com`

### Odlaganje sajta (privremeno)

```
sudo rm /etc/nginx/sites-enabled/ime-sajta   # fajl ostaje u sites-available
sudo systemctl reload nginx
```

### Logovi

```
/var/log/nginx/access.log      ← default (sve što nije u drugim)
/var/log/nginx/error.log
/var/log/nginx/lessenza.{access,error}.log
```

---

## 4. lessenza.me (salon)

### Gdje je šta

| Što                  | Gdje                                              |
|----------------------|---------------------------------------------------|
| Kod                  | `/home/valentina/lessenza-web/`                   |
| `.env`               | `/home/valentina/lessenza-web/.env` (perms 600)   |
| SQLite DB            | `/home/valentina/lessenza/data/lessenza.db`       |
| systemd unit         | `/etc/systemd/system/lessenza.service`            |
| nginx vhost          | `/etc/nginx/sites-available/lessenza`             |
| nginx logovi         | `/var/log/nginx/lessenza.{access,error}.log`      |
| app logovi           | `journalctl -u lessenza`                          |

### Osnovne operacije

```bash
# Status
sudo systemctl status lessenza
curl -s http://127.0.0.1:3000/api/health   # treba 200

# Restart (nakon code update)
sudo systemctl restart lessenza

# Logovi (uživo)
journalctl -u lessenza -f

# Update koda (kad pushnem novu verziju)
cd ~/lessenza-web
git pull --ff-only
npm install --omit=dev --no-audit --no-fund
sudo systemctl restart lessenza
```

### Backup SQLite DB

Dodati u **root crontab** (`sudo crontab -e`):
```
0 3 * * *  sqlite3 /home/valentina/lessenza/data/lessenza.db ".backup /home/valentina/lessenza/data/backup-$(date +\%F).db" && find /home/valentina/lessenza/data -name 'backup-*.db' -mtime +14 -delete
```

Ručni backup prije rizičnih izmjena:
```bash
cp ~/lessenza/data/lessenza.db ~/lessenza/data/backup-before-xxx.db
```

### Rollback ako lessenza nešto pokvari

```bash
sudo bash ~/lessenza-web/deploy/rollback.sh
```
Ugasi lessenza servis + ukloni nginx vhost simlink → ostala 4 sajta rade normalno.
Nema uticaja na SQLite bazu ni kod.

---

## 5. Ostali sajtovi (PM2 sažetak)

Detalje o putujzadz / pozvaniste / racunajmo kod je već imala, ali za slučaj
da nešto otkaže:

```bash
pm2 list                      # sve procese
pm2 logs <name>               # live logs
pm2 restart <name>            # restart
pm2 startup                   # pokaže komandu za auto-start na reboot
pm2 save                      # zapamti trenutno stanje
```

PM2 logovi: `~/.pm2/logs/<name>-out.log` i `~/.pm2/logs/<name>-error.log`.

Ako PM2 iz nekog razloga padne cijeli:
```bash
sudo systemctl restart pm2-valentina
pm2 resurrect                 # vrati sve spremljene procese
```

---

## 6. Baza (MySQL + Redis)

Koriste ih putujzadz / pozvaniste / racunajmo — **NE** lessenza (lessenza je SQLite-only).

```bash
# MySQL
sudo systemctl {status,restart} mysql
mysql -u <user> -p            # interaktivno
# DB dumpovi su u: ? (provjeri /home/valentina/backups/ i ~/apps/*/backups)

# Redis
sudo systemctl {status,restart} redis-server
redis-cli ping                # treba "PONG"
```

---

## 7. Resursi i monitoring

```bash
# Brza slika
free -h && df -h / && uptime && pm2 list

# Ko troši memoriju
ps aux --sort=-%mem | head -10

# Ko troši CPU
top -b -n 1 | head -20

# Konekcije ka portovima
sudo ss -tlnp | grep LISTEN
```

Trenutno stanje (17-apr-2026):
- 5 Node procesa + MySQL + Redis + nginx → ~**2.3 GB RAM u upotrebi / 22 GB total** (10%).
- Disk: **51 GB zauzeto / 75 GB** (71%). Prati — ako pređe 85%, pogledaj `du -sh /home/valentina/*/node_modules` i pm2 logove (`~/.pm2/logs/*.log` zna biti veliko).

---

## 8. DNS

Domeni su svi na raznim DNS providerima — provjeri u svakom dashboardu
(Netlify / Namecheap / GoDaddy / ...) ako treba mijenjati A record.

Svi A recordi treba da pokazuju na **`46.224.158.221`** (osim ako se koristi
Cloudflare proxy — onda CNAME na Cloudflare).

Provjera propagacije:
```bash
dig +short domen.com
dig @8.8.8.8 +short domen.com      # Google
dig @1.1.1.1 +short domen.com      # Cloudflare
```

---

## 9. Firewall + SSH

- **Firewall (ufw)**: nije aktivan na ovoj mašini. Hetzner Cloud Firewall
  (na nivou Hetzner dashboarda) možda filtrira — provjeri tamo ako neki port
  iznenada prestane raditi.
- **SSH**: samo preko ključa (password auth je vjerovatno onemogućen — ako
  nisi sigurna, `grep PasswordAuthentication /etc/ssh/sshd_config`).
- **Korisnici**: `valentina` (sudo uz password) + `root` (key-only).

### Dodavanje SSH ključa drugom korisniku / meni / kolegi

```bash
cat novi-kluc.pub | ssh valentina@46.224.158.221 'cat >> ~/.ssh/authorized_keys'
```

---

## 10. Backup plan (preporučeno)

| Šta                  | Gdje                                    | Frekvencija |
|----------------------|-----------------------------------------|-------------|
| **lessenza SQLite**  | `~/lessenza/data/backup-YYYY-MM-DD.db`  | dnevno, cron |
| **MySQL (putujzadz / pozvaniste / racunajmo)** | `~/backups/mysql/*.sql.gz` | dnevno, cron |
| **nginx config**     | `sudo tar -czf ~/backups/nginx-$(date +%F).tgz /etc/nginx/` | nedjeljno |
| **Let's Encrypt**    | `/etc/letsencrypt` (preživi dok god je root FS ok) | posle svake promjene |

Ako želiš off-site backup (preporuka): Hetzner Storage Box (besplatan 100 GB
uz VPS) ili rsync na drugu VPS-u. Reci mi kad budeš spremna, pa postavimo.

---

## 11. Emergency

### Sajt x ne radi

1. `curl -sI https://domen.com` — kakav kod?
2. `curl -sI http://127.0.0.1:<port>` — radi li upstream?
3. Ako upstream ne radi:
   - lessenza: `sudo systemctl status lessenza && journalctl -u lessenza -n 50`
   - ostali: `pm2 list && pm2 logs <name> --lines 50`
4. Ako upstream radi ali nginx ne vraća → `sudo nginx -t` i `sudo systemctl status nginx`.

### Server je prespor

1. `free -h` — ako free RAM < 500 MB, OOM killer vjerovatno ubija procese.
2. `top` sortiran po RAM (P i onda mem) → vidi šta jede.
3. Restart heaviest proces: `pm2 restart <name>` ili `sudo systemctl restart lessenza`.
4. Ako se ponavlja — razmisli o upgrade-u Hetzner plan-a (CX21 → CX31).

### SSH ne radi više

- Hetzner dashboard → Console (VNC) → uloguj se preko tastature.
- Provjeri `sudo systemctl status ssh`.
- Ako je problem blokiranje IP-a (fail2ban), `sudo fail2ban-client status sshd` i `sudo fail2ban-client unban <ip>`.

---

## 12. Kontakt / brzi linkovi

- Repo: `git@github.com:xmzvk4fcbs-cyber/lessenza-web.git` (private)
- Hetzner Cloud: https://console.hetzner.cloud (za firewall/snapshot/reboot)
- Let's Encrypt status: https://letsencrypt.status.io
- DNS check: https://dnschecker.org

Kad god nešto nije jasno ili se situacija promjeni, edituj ovaj fajl —
pusti da svi koji rade na serveru gledaju isti izvor istine.
