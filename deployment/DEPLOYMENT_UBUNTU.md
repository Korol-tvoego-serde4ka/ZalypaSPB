# Deployment on Ubuntu 22.04 (Nginx + Node + PostgreSQL)

## 1) System packages
```
sudo apt update
sudo apt install -y curl gnupg2 ca-certificates lsb-release apt-transport-https
```

## 2) Node.js 18+
```
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

## 3) PostgreSQL
```
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE USER zalypa WITH PASSWORD 'strong_password';"
sudo -u postgres psql -c "CREATE DATABASE zalypa OWNER zalypa;"
```

## 4) Project layout
```
sudo mkdir -p /opt/zalypa
sudo chown -R $USER:$USER /opt/zalypa
# copy project files to /opt/zalypa (git clone or scp)
```

## 5) Environment
Create `/opt/zalypa/.env` based on `.env.example`:
```
PORT=3000
NODE_ENV=production
JWT_SECRET=<random_long_secret>
COOKIE_NAME=access_token
COOKIE_SECURE=true
DATABASE_URL=postgresql://zalypa:strong_password@localhost:5432/zalypa?schema=public
```

## 6) Install deps and generate Prisma client
```
cd /opt/zalypa
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed
```

## 7) systemd service
Create `/etc/systemd/system/zalypa.service` from `deployment/systemd/zalypa.service` and adjust `WorkingDirectory` if needed.
```
sudo systemctl daemon-reload
sudo systemctl enable zalypa
sudo systemctl start zalypa
sudo systemctl status zalypa
```

## 8) Nginx
```
sudo apt install -y nginx
sudo cp /opt/zalypa/deployment/nginx/dinozavrikgugl.ru.conf /etc/nginx/sites-available/dinozavrikgugl.ru
sudo ln -s /etc/nginx/sites-available/dinozavrikgugl.ru /etc/nginx/sites-enabled/dinozavrikgugl.ru
sudo nginx -t
sudo systemctl reload nginx
```

## 9) HTTPS (Let’s Encrypt)
```
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dinozavrikgugl.ru -d www.dinozavrikgugl.ru
```

## 10) File structure notes
- Static files: `/opt/zalypa/public` (served by Node, behind Nginx)
- Loader files: `/opt/zalypa/downloads` (served at https://dinozavrikgugl.ru/downloads/*)
- Health check: `https://dinozavrikgugl.ru/healthz`

## 11) Update & deploy
```
cd /opt/zalypa
git pull
npm ci
npm run prisma:migrate:deploy
sudo systemctl restart zalypa
sudo systemctl reload nginx
```
