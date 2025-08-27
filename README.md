# RDS M3U8 Extraction Service

Serviciu Node.js pentru extragerea automată de linkuri m3u8 din RDS Live folosind Puppeteer cu pool de pagini optimizat.

## 🚀 Funcționalități

- **Pool de pagini Puppeteer**: 10 pagini pregătite pentru performanță optimă
- **Extragere automată m3u8**: Detectează și returnează linkurile video
- **API REST simplu**: Acces prin parametri de canal
- **Logging detaliat**: Logs în consolă și fișier pentru debugging
- **Serviciu Linux systemd**: Configurare automată ca serviciu de sistem
- **Health checks**: Monitorizare status și statistici
- **Error handling**: Gestionare robustă a erorilor

## 📋 Cerințe

- Linux (Ubuntu/Debian/CentOS/RHEL)
- Node.js 16+ 
- Google Chrome
- Acces root pentru instalare

## 🛠 Instalare Rapidă

```bash
# 1. Clonează/copiază fișierele în /root/rds_new.js
cd /root/rds_new.js

# 2. Rulează scriptul de instalare
chmod +x install.sh
./install.sh
```

Scriptul va instala automat:
- Node.js și NPM
- Google Chrome 
- Dependințele NPM
- Serviciul systemd
- Configurarea automată

## 🎯 Utilizare API

### Endpoint-uri disponibile:

**Health Check:**
```bash
curl http://localhost:3000/health
```

**Lista canalelor:**
```bash
curl http://localhost:3000/channels
```

**Extragere m3u8 pentru un canal:**
```bash
curl http://localhost:3000/romaniaantena1hd
```

**Statistici serviciu:**
```bash
curl http://localhost:3000/api/stats
```

### Răspuns JSON tipic:

```json
{
  "success": true,
  "channel": "romaniaantena1hd",
  "url": "https://rds.live/romaniaantena1hd/",
  "m3u8": "https://example.com/stream/video.m3u8",
  "timestamp": "2025-01-15T10:30:45.123Z",
  "processingTime": 5432
}
```

## 📺 Canale Suportate

- `romaniaantena1hd` - Antena 1 HD
- `romaniatvr1` - TVR 1  
- `romaniaprotv` - Pro TV
- `romaniapro2` - Pro 2
- `romaniaacasa` - Acasă TV
- `romaniakanal` - Kanal D
- `romaniaNational` - National TV
- `romaniadigi24` - Digi24

*Pentru a adăuga canale noi, editează `config.js`*

## 🔧 Gestionarea Serviciului

```bash
# Start serviciu
systemctl start rds-m3u8.service

# Stop serviciu  
systemctl stop rds-m3u8.service

# Restart serviciu
systemctl restart rds-m3u8.service

# Status serviciu
systemctl status rds-m3u8.service

# Urmărire logs
journalctl -u rds-m3u8.service -f

# Log file aplicație
tail -f /var/log/rds-service.log
```

## 🧪 Testare

```bash
# Testare completă
npm test

# Sau manual:
node test.js
```

## ⚙️ Configurare

Editează `config.js` pentru:
- Port server (default: 3000)
- Dimensiune pool Puppeteer (default: 10)
- Timeout-uri
- Canale noi
- Nivelul de logging

Variabile de mediu:
```bash
export PORT=3000
export HEADLESS=1
export LOG_LEVEL=info
export CHROME_PATH=/usr/bin/google-chrome
```

## 📊 Monitoring

### Logs detaliate:

- **Console logs**: Afișate în `journalctl`
- **File logs**: `/var/log/rds-service.log` (rotație automată)
- **Request tracking**: Fiecare cerere loggată cu timp și rezultat
- **Pool status**: Monitorizare pagini disponibile/ocupate

### Metrici importante:

- Timpul de procesare per cerere
- Rata de succes extragere m3u8  
- Utilizarea pool-ului de pagini
- Memoria și CPU

## 🛡️ Securitate

- Blocare automată Google Analytics/Ads
- Eliminare bannere consent/cookies
- Request filtering pentru securitate
- Resource limits în systemd
- Read-only filesystem protections

## 🔍 Troubleshooting

### Service nu pornește:
```bash
# Verifică logs
journalctl -u rds-m3u8.service -n 50

# Verifică Chrome
google-chrome --version --no-sandbox
```

### Pool-ul nu se inițializează:
```bash
# Verifică memoria disponibilă
free -h

# Restart cu mai puține pagini
# Editează config.js - puppeteer.poolSize: 5
```

### Nu găsește m3u8:
```bash
# Verifică headless mode
export HEADLESS=0
systemctl restart rds-m3u8.service
```

## 📈 Performanță

- **Pool size**: 10 pagini → ~10 cereri simultane
- **Timpul mediu**: 3-8 secunde per extragere
- **Memoria**: ~2GB RAM recomandată  
- **CPU**: 200% CPU quota în systemd

## 🔄 Update

```bash
# Stop serviciu
systemctl stop rds-m3u8.service

# Update fișiere
cp new-files/* /root/rds_new.js/

# Update dependințe
cd /root/rds_new.js
npm install

# Restart serviciu  
systemctl start rds-m3u8.service
```

## 📝 Logs și Debug

Logs sunt salvate în:
- **systemd journal**: `journalctl -u rds-m3u8.service`
- **Application log**: `/var/log/rds-service.log`

Level-uri logging:
- `error`: Doar erori critice
- `warn`: Avertismente + erori  
- `info`: Info general + warn + error
- `debug`: Toate detaliile (development)

---

*Serviciul este optimizat pentru extragere continuă și poate gestiona multiple cereri simultane folosind pool-ul de pagini Puppeteer.*