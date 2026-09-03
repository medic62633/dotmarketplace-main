#!/usr/bin/env bash
# Deploy dot-marketplace on Ubuntu VPS (obalapi.com)
# Run ON the VPS as root after uploading the project + .env
#
# Usage:
#   chmod +x scripts/deploy-vps.sh
#   sudo ./scripts/deploy-vps.sh
#
# Prerequisites:
#   - Domain obalapi.com A records point to this server's public IP
#   - MongoDB Atlas Network Access allows this VPS IP
#   - .env file present in project root (copy from your laptop — never commit)

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="dot-marketplace"
DOMAIN="${DOMAIN:-obalapi.com}"
NODE_MAJOR="${NODE_MAJOR:-20}"
PORT="${PORT:-3000}"

echo "==> Deploying $APP_NAME from $APP_DIR"
echo "    Domain: $DOMAIN"
echo "    App port: $PORT"

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "ERROR: $APP_DIR/.env not found."
  echo "Copy your local .env to the VPS before running this script."
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root (sudo ./scripts/deploy-vps.sh)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ufw

# Node.js LTS
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p "process.versions.node.split('.')[0]")" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi

npm install -g pm2

# App user (optional hardening)
if ! id -u www-data >/dev/null 2>&1; then
  useradd -r -s /usr/sbin/nologin www-data || true
fi

cd "$APP_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

mkdir -p public/uploads/chat
chown -R www-data:www-data public/uploads 2>/dev/null || true

# PM2 ecosystem — NODE_ENV must be set here (not only in .env)
cat > "$APP_DIR/ecosystem.config.cjs" <<EOF
module.exports = {
  apps: [{
    name: '${APP_NAME}',
    script: 'server.js',
    cwd: '${APP_DIR}',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
EOF

pm2 delete "$APP_NAME" 2>/dev/null || true
pm2 start "$APP_DIR/ecosystem.config.cjs"
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || pm2 startup

# nginx reverse proxy
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}"
cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF

ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/${APP_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# Firewall
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp
ufw allow 'Nginx Full' >/dev/null 2>&1 || { ufw allow 80/tcp; ufw allow 443/tcp; }
ufw --force enable >/dev/null 2>&1 || true

# SSL (requires DNS propagated to this server)
echo ""
echo "==> Requesting Let's Encrypt certificate for ${DOMAIN}..."
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}" --redirect; then
  echo "SSL certificate installed."
else
  echo "WARN: certbot failed — DNS may not be propagated yet."
  echo "      Retry when Cloudflare shows Active:"
  echo "      certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
fi

echo ""
echo "==> Smoke test"
sleep 2
curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null && echo "App healthz: OK" || echo "WARN: healthz failed"
curl -sfI "http://127.0.0.1/" >/dev/null && echo "nginx proxy: OK" || echo "WARN: nginx proxy failed"

echo ""
echo "=============================================="
echo " Deployment complete"
echo "=============================================="
echo " Marketplace:  https://${DOMAIN}/"
echo " Health:       https://${DOMAIN}/healthz"
echo ""
echo " Admin portal (secret path — check your .env):"
echo "   https://${DOMAIN}/\$(grep PORTAL_SECRET_PATH ${APP_DIR}/.env | cut -d= -f2)/admin/"
echo ""
echo " PM2:"
echo "   pm2 status"
echo "   pm2 logs ${APP_NAME}"
echo ""
echo " Crypto payments (PAYMENT_PROVIDER in .env):"
echo "   Direct on-chain to your own wallets — no processor, no webhook."
echo "   Pool deposit addresses via the admin portal's Crypto tab before"
echo "   enabling checkout. See README \"Native crypto payments\"."
echo "=============================================="
