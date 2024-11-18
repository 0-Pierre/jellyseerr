import JellyfinAPI from '@server/api/jellyfin';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  defineBackendMessages,
  getTranslation,
} from '@server/utils/backendMessages';

const messages = defineBackendMessages('components.JellyfinStreams', {
  subscriptionExpired: 'Your yearly subscription has expired, renew it by sending {subscriptionPrice} € to {adminEmail} on PayPal to continue playing.',
  subscriptionRequired: 'You need an active subscription to continue playing.',
});

const jellyfinStreams = {
  async run() {
    try {
      const settings = getSettings();
      const jellyfinSettings = settings.jellyfin;

      if (!jellyfinSettings.ip || !jellyfinSettings.apiKey) {
        logger.error('Jellyfin is not configured properly.');
        return;
      }

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
          relations: ['settings'],
        });

        const userLocale = user?.settings?.locale || 'en';

        if (!user) {
          try {
            const message = getTranslation(
              messages,
              'subscriptionRequired',
              userLocale
            );
            await jellyfin.stopSession(session.Id, message);
          } catch (error) {
            logger.error('Failed to stop session', { error });
          }
        } else if (
          user.subscriptionStatus !== 'active' &&
          user.subscriptionStatus !== 'lifetime'
        ) {
          try {
            const rawMessage = getTranslation(messages, 'subscriptionExpired', userLocale);
            const message = rawMessage
              .replace('{subscriptionPrice}', settings.main.subscriptionPrice.toString())
              .replace('{adminEmail}', settings.main.adminEmail);
            await jellyfin.stopSession(session.Id, message);
          } catch (error) {
            logger.error('Failed to stop session', { error });
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
