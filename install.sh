#!/bin/bash

# Script de instalare pentru RDS M3U8 Service
set -e

echo "=== Instalare RDS M3U8 Service ==="

# Verificăm că suntem root
if [ "$EUID" -ne 0 ]; then
    echo "Acest script trebuie rulat ca root!"
    exit 1
fi

echo "1. Instalare dependințe de sistem..."
# Pentru Ubuntu/Debian
if command -v apt-get &> /dev/null; then
    apt-get update
    apt-get install -y curl wget gnupg2 software-properties-common
    
    # Instalare Node.js
    if ! command -v node &> /dev/null; then
        echo "Instalare Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    fi
    
    # Instalare Chrome pentru Puppeteer
    if ! command -v google-chrome &> /dev/null; then
        echo "Instalare Google Chrome..."
        wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
        echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
        apt-get update
        apt-get install -y google-chrome-stable
    fi

# Pentru CentOS/RHEL/Rocky
elif command -v yum &> /dev/null; then
    yum update -y
    yum install -y curl wget
    
    # Instalare Node.js
    if ! command -v node &> /dev/null; then
        echo "Instalare Node.js..."
        curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
        yum install -y nodejs
    fi
    
    # Instalare Chrome
    if ! command -v google-chrome &> /dev/null; then
        echo "Instalare Google Chrome..."
        cat > /etc/yum.repos.d/google-chrome.repo << 'EOF'
[google-chrome]
name=google-chrome
baseurl=http://dl.google.com/linux/chrome/rpm/stable/x86_64
enabled=1
gpgcheck=1
gpgkey=https://dl.google.com/linux/linux_signing_key.pub
EOF
        yum install -y google-chrome-stable
    fi
fi

echo "2. Verificare versiuni..."
echo "Node.js: $(node --version)"
echo "NPM: $(npm --version)"
echo "Chrome: $(google-chrome --version)"

echo "3. Copiez fișierele serviciului..."
# Presupunem că suntem în directorul cu fișierele
SERVICE_DIR="/root/rds"
mkdir -p $SERVICE_DIR

# Copiem toate fișierele
cp -r ./* $SERVICE_DIR/
cd $SERVICE_DIR

echo "4. Instalare dependințe NPM..."
npm install --production

echo "5. Creare director pentru logs..."
mkdir -p /var/log
touch /var/log/rds-service.log
chown root:root /var/log/rds-service.log
chmod 644 /var/log/rds-service.log

echo "6. Instalare serviciu systemd..."
cp rds-m3u8.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable rds-m3u8.service

echo "7. Test Chrome pentru Puppeteer..."
google-chrome --version --no-sandbox --disable-dev-shm-usage || echo "Chrome test failed, dar serviciul ar trebui să funcționeze"

echo "8. Start serviciu..."
systemctl start rds-m3u8.service

echo "9. Verificare status..."
sleep 3
systemctl status rds-m3u8.service

echo ""
echo "=== Instalare completă! ==="
echo ""
echo "Serviciul este disponibil la: http://localhost:3000"
echo ""
echo "Comenzi utile:"
echo "  systemctl status rds-m3u8.service     # Status serviciu"
echo "  systemctl stop rds-m3u8.service       # Stop serviciu"
echo "  systemctl start rds-m3u8.service      # Start serviciu"
echo "  systemctl restart rds-m3u8.service    # Restart serviciu"
echo "  journalctl -u rds-m3u8.service -f     # Urmărire logs"
echo "  tail -f /var/log/rds-service.log      # Urmărire log file"
echo ""
echo "Testare API:"
echo "  curl http://localhost:3000/health"
echo "  curl http://localhost:3000/channels"
echo "  curl http://localhost:3000/romaniaantena1hd"
echo ""