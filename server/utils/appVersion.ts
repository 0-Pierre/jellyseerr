import logger from '@server/logger';
import { existsSync } from 'fs';
import path from 'path';

const COMMIT_TAG_PATH = path.join(__dirname, '../../committag.json');
let commitTag = 'local';

if (existsSync(COMMIT_TAG_PATH)) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  commitTag = require(COMMIT_TAG_PATH).commitTag;
  logger.info(`Commit Tag: ${commitTag}`);
}

export const getCommitTag = (): string => {
  return commitTag;
};

export const FORKED_FROM_VERSION = '2.1.0';

export const getAppVersion = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { version } = require('../../package.json');

  let finalVersion = version;

  if (version === '0.1.0') {
    finalVersion = FORKED_FROM_VERSION;
  }

  return finalVersion;
};
