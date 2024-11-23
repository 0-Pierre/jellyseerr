import JellyfinAPI from '@server/api/jellyfin';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  defineBackendMessages,
  getTranslation,
} from '@server/utils/backendMessages';

const messages = defineBackendMessages(
  'components.JellyfinSuspiciousActivity',
  {
    multipleIps:
      'Multiple IP addresses detected for your account. For security reasons, all playbacks have been stopped.',
  }
);

// Function to check if string is IPv6
const isIPv6 = (ip: string): boolean => {
  return ip.includes(':');
};

// Function to get IPv6 network prefix (first 4 segments)
const getIPv6Prefix = (ip: string): string => {
  if (!isIPv6(ip)) return ip;
  const segments = ip.split(':');
  return segments.slice(0, 4).join(':');
};

const jellyfinSuspiciousActivity = {
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

      // Track IPs/Prefixes per user
      const userIPs = new Map();

      // First pass - collect all IPs/Prefixes per user
      for (const session of sessions) {
        const jellyfinUserId = session.UserId;
        if (!userIPs.has(jellyfinUserId)) {
          userIPs.set(jellyfinUserId, new Set());
        }
        const ipAddress = session.RemoteEndPoint;
        // Store prefix for IPv6, full address for IPv4
        userIPs.get(jellyfinUserId).add(
          isIPv6(ipAddress) ? getIPv6Prefix(ipAddress) : ipAddress
        );
      }

      // Second pass - check and take action
      for (const session of sessions) {
        const jellyfinUserId = session.UserId;
        const user = await userRepository.findOne({
          where: { jellyfinUserId },
          relations: ['settings'],
        });

        if (!user) continue;

        const userLocale = user.settings?.locale || 'en';

        // If multiple network locations detected for this user
        if (userIPs.get(jellyfinUserId).size > 1) {
          try {
            const message = getTranslation(messages, 'multipleIps', userLocale);
            await jellyfin.stopSession(session.Id, message);

            logger.warn(
              `Stopped stream for ${
                user.displayName
              } due to multiple networks: ${Array.from(
                userIPs.get(jellyfinUserId)
              ).join(', ')}`
            );

            user.suspiciousActivityCount =
              (user.suspiciousActivityCount || 0) + 1;
            await userRepository.save(user);
          } catch (error) {
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
