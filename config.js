const config = {
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0'
  },
  puppeteer: {
    poolSize: 10,
    headless: process.env.HEADLESS !== "0" ? "new" : false,
    chromePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    timeout: 30000,
    maxRetries: 3
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || '/var/log/rds-service.log'
  },
  channels: {
    'romaniaantena1hd': 'https://rds.live/romaniaantena1hd/',
    'romaniatvr1': 'https://rds.live/romaniatvr1/',
    'romaniaprotv': 'https://rds.live/romaniaprotv/',
    'romaniapro2': 'https://rds.live/romaniapro2/',
    'romaniaacasa': 'https://rds.live/romaniaacasa/',
    'romaniakanal': 'https://rds.live/romaniakanal/',
    'romaniaNational': 'https://rds.live/romaniaNational/',
    'romaniadigi24': 'https://rds.live/romaniadigi24/'
  }
};

module.exports = config;