import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getConfig } from '../config';
import path from 'path';

const logDir = path.join(process.cwd(), 'logs');

// Format timestamp for UTC+8 timezone
function formatTimestampUTC8(): string {
  const now = new Date();
  // Get UTC time and add 8 hours for UTC+8
  const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const year = utc8Time.getUTCFullYear();
  const month = String(utc8Time.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc8Time.getUTCDate()).padStart(2, '0');
  const hours = String(utc8Time.getUTCHours()).padStart(2, '0');
  const minutes = String(utc8Time.getUTCMinutes()).padStart(2, '0');
  const seconds = String(utc8Time.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC+8`;
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: formatTimestampUTC8 }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

// Create logger instance
export const logger = winston.createLogger({
  level: getConfig().logging.level,
  format: logFormat,
  transports: []
});

// Add console transport if enabled
if (getConfig().logging.toConsole) {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat
    )
  }));
}

// Add file transport if enabled
if (getConfig().logging.toFile) {
  logger.add(new DailyRotateFile({
    dirname: logDir,
    filename: 'bot-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '100m',
    maxFiles: '30d'
  }));
}

// Export convenience methods
export const log = {
  debug: (message: string) => logger.debug(message),
  info: (message: string) => logger.info(message),
  warn: (message: string) => logger.warn(message),
  error: (message: string) => logger.error(message)
};

export default logger;
