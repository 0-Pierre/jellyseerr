import logger from '@server/logger';
import fs from 'fs';
import path from 'path';

interface Messages {
  [key: string]: string;
}

interface MessageDefinition {
  namespace: string;
  messages: Messages;
}

function loadLocaleJson(locale: string): Record<string, string> {
  const filePath = path.join(
    process.cwd(),
    'dist/i18n/locale',
    `${locale}.json`
  );
  const fallbackPath = path.join(
    process.cwd(),
    'src/i18n/locale',
    `${locale}.json`
  );

  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    if (fs.existsSync(fallbackPath)) {
      return JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
    }
  } catch (error) {
    logger.error('Error reading translation file', { locale, error });
  }

  return {};
}

export const defineBackendMessages = (
  namespace: string,
  messages: Messages
): MessageDefinition => ({
  namespace,
  messages,
});

export const getTranslation = (
  messageObj: MessageDefinition,
  messageKey: string,
  locale: string
): string => {
  const translations = loadLocaleJson(locale);
  const fullKey = `${messageObj.namespace}.${messageKey}`;
  return translations[fullKey] || messageObj.messages[messageKey];
};
