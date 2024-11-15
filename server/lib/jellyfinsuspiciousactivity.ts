import JellyfinAPI from '@server/api/jellyfin';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

const jellyfinSuspiciousActivity = {
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

      // Track IPs per user
      const userIPs = new Map();

      // First pass - collect all IPs per user
      for (const session of sessions) {
        const jellyfinUserId = session.UserId;
        if (!userIPs.has(jellyfinUserId)) {
          userIPs.set(jellyfinUserId, new Set());
        }
        userIPs.get(jellyfinUserId).add(session.RemoteEndPoint);
      }

      // Second pass - check and take action
      for (const session of sessions) {
        const jellyfinUserId = session.UserId;
        const user = await userRepository.findOne({
          where: { jellyfinUserId },
        });

        if (!user) continue;

        // If multiple IPs detected for this user
        if (userIPs.get(jellyfinUserId).size > 1) {
          try {
            await jellyfin.stopSession(
              session.Id,
              'Multiple IP addresses detected. Account sharing is not allowed.'
            );

            logger.warn(
              `Stopped stream for ${user.displayName} due to multiple IPs: ${
                Array.from(userIPs.get(jellyfinUserId)).join(', ')
              }`
            );

            // Increment suspicious activity counter
            user.suspiciousActivityCount = (user.suspiciousActivityCount || 0) + 1;
            await userRepository.save(user);
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

export default jellyfinSuspiciousActivity;
