import JellyfinAPI from '@server/api/jellyfin';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

const jellyfinStreams = {
  async run() {
    try {
      const settings = getSettings();
      const jellyfinSettings = settings.jellyfin;

      if (!jellyfinSettings.ip || !jellyfinSettings.apiKey) {
        logger.error('Jellyfin is not configured properly.');
        return;
      }

      // Construct the full URL
      const protocol = jellyfinSettings.useSsl ? 'https' : 'http';
      const jellyfinUrl = `${protocol}://${jellyfinSettings.ip}:${
        jellyfinSettings.port
      }${jellyfinSettings.urlBase || ''}`;

      const jellyfin = new JellyfinAPI(jellyfinUrl, jellyfinSettings.apiKey);

      const sessions = await jellyfin.getActiveSessions();

      const userRepository = getRepository(User);

      for (const session of sessions) {
        const jellyfinUserId = session.UserId;

        const user = await userRepository.findOne({
          where: { jellyfinUserId },
        });

        if (
          !user ||
          (user.subscriptionStatus !== 'active' &&
            user.subscriptionStatus !== 'lifetime')
        ) {
          try {
            await jellyfin.stopSession(
              session.Id,
              'Your subscription has expired or is invalid.'
            );
            logger.info(
              `Stopped stream for ${
                user?.displayName || jellyfinUserId
              } due to invalid subscription.`
            );
          } catch (error) {
            // Ignore 404 errors for non-existent sessions
            if (error?.response?.status !== 404) {
              throw error;
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to run Jellyfin Streams script', {
        label: 'Jellyfin Streams',
        errorMessage: error.message,
      });
    }
  },
};

export default jellyfinStreams;
