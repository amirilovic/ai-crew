import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(meta).length > 0) {
    log += ` ${JSON.stringify(meta)}`;
  }
  if (stack) {
    log += `\n${stack}`;
  }
  return log;
});

export function createLogger(agentName: string): winston.Logger {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
      errors({ stack: true }),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      logFormat
    ),
    defaultMeta: { agent: agentName },
    transports: [
      new winston.transports.Console({
        format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
      }),
      new winston.transports.File({
        filename: `logs/${agentName}-error.log`,
        level: 'error',
      }),
      new winston.transports.File({
        filename: `logs/${agentName}.log`,
      }),
    ],
  });
}

export const logger = createLogger(process.env.AGENT_NAME || 'default');
