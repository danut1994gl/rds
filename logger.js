const winston = require('winston');
const path = require('path');
const config = require('./config');

const createLogger = (module = 'APP') => {
  return winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, module: mod, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${level.toUpperCase()}] [${mod || module}] ${message}${metaStr}`;
      })
    ),
    defaultMeta: { module },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, module: mod, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}] [${mod || module}] ${message}${metaStr}`;
          })
        )
      }),
      new winston.transports.File({
        filename: config.logging.file,
        maxsize: 10485760, // 10MB
        maxFiles: 5,
        tailable: true
      })
    ]
  });
};

// Logger principal pentru aplicație
const logger = createLogger('MAIN');

// Export logger factory și logger principal
module.exports = { createLogger, logger };