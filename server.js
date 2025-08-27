const express = require('express');
const cors = require('cors');
const puppeteerPool = require('./puppeteer-pool');
const M3U8Extractor = require('./m3u8-extractor');
const { logger } = require('./logger');
const config = require('./config');

const app = express();
const extractor = new M3U8Extractor(puppeteerPool);

// Middleware
app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { 
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    query: req.query
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const poolStats = await puppeteerPool.getPoolStats();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      pool: poolStats,
      config: {
        poolSize: config.puppeteer.poolSize,
        supportedChannels: Object.keys(config.channels)
      }
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Lista canalelor disponibile
app.get('/channels', (req, res) => {
  res.json({
    success: true,
    channels: Object.keys(config.channels),
    total: Object.keys(config.channels).length
  });
});

// Endpoint principal pentru extragerea m3u8
app.get('/:channel', async (req, res) => {
  const channel = req.params.channel.toLowerCase();
  const startTime = Date.now();
  
  logger.info(`Request pentru canalul: ${channel}`);
  
  try {
    if (!config.channels[channel]) {
      return res.status(404).json({
        success: false,
        error: `Canal necunoscut: ${channel}`,
        availableChannels: Object.keys(config.channels)
      });
    }

    const result = await extractor.extractM3U8(channel);
    const totalTime = Date.now() - startTime;
    
    logger.info(`Request complet pentru ${channel} în ${totalTime}ms`, { 
      success: result.success,
      processingTime: result.processingTime
    });
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(`Eroare la procesarea canalului ${channel}:`, error);
    
    res.status(500).json({
      success: false,
      channel: channel,
      error: error.message,
      timestamp: new Date().toISOString(),
      processingTime: totalTime
    });
  }
});

// Endpoint pentru statistici
app.get('/api/stats', async (req, res) => {
  try {
    const poolStats = await puppeteerPool.getPoolStats();
    res.json({
      pool: poolStats,
      config: {
        poolSize: config.puppeteer.poolSize,
        timeout: config.puppeteer.timeout,
        supportedChannels: Object.keys(config.channels).length
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid
      }
    });
  } catch (error) {
    logger.error('Stats endpoint error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

// Handler pentru 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'GET /channels', 
      'GET /api/stats',
      'GET /:channel'
    ]
  });
});

// Error handler global
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Receiving shutdown signal...');
  
  try {
    logger.info('Closing Puppeteer pool...');
    await puppeteerPool.close();
    
    logger.info('Puppeteer pool closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Initialize și start server
const startServer = async () => {
  try {
    logger.info('Initializing Puppeteer pool...');
    await puppeteerPool.init();
    
    const server = app.listen(config.server.port, config.server.host, () => {
      logger.info(`RDS M3U8 Service pornit pe ${config.server.host}:${config.server.port}`);
      logger.info(`Canale disponibile: ${Object.keys(config.channels).join(', ')}`);
      logger.info(`Pool Puppeteer: ${config.puppeteer.poolSize} pagini`);
    });

    server.on('error', (error) => {
      logger.error('Server error:', error);
      process.exit(1);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();