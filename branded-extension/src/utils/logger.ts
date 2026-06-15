const isDevelopment = import.meta.env.DEV;

function shouldLog(): boolean {
  return isDevelopment;
}

export const logger = {
  log: (...args: unknown[]) => {
    if (shouldLog()) {
      console.log(...args);
    }
  },

  error: (...args: unknown[]) => {
    if (shouldLog()) {
      console.error(...args);
    }
  },

  warn: (...args: unknown[]) => {
    if (shouldLog()) {
      console.warn(...args);
    }
  },

  info: (...args: unknown[]) => {
    if (shouldLog()) {
      console.info(...args);
    }
  },

  debug: (...args: unknown[]) => {
    if (shouldLog()) {
      console.debug(...args);
    }
  },
};
