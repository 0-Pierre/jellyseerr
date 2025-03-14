import type { NotificationAgentKey } from '@server/lib/settings';

export interface UserSettingsGeneralResponse {
  username?: string;
  email?: string;
  discordId?: string;
  locale?: string;
  discoverRegion?: string;
  streamingRegion?: string;
  originalLanguage?: string;
  movieQuotaLimit?: number;
  movieQuotaDays?: number;
  tvQuotaLimit?: number;
  tvQuotaDays?: number;
  globalMovieQuotaDays?: number;
  globalMovieQuotaLimit?: number;
  globalTvQuotaLimit?: number;
  globalTvQuotaDays?: number;
  watchlistSyncMovies?: boolean;
  watchlistSyncTv?: boolean;
  subscriptionEnabled?: boolean;
  subscriptionType?: 'standard' | 'lifetime';
  subscriptionStatus?: 'active' | 'expired' | 'lifetime' | null;
  subscriptionExpirationDate?: Date | null;
}

export type NotificationAgentTypes = Record<NotificationAgentKey, number>;
export interface UserSettingsNotificationsResponse {
  emailEnabled?: boolean;
  pgpKey?: string;
  discordEnabled?: boolean;
  discordEnabledTypes?: number;
  discordId?: string;
  pushbulletAccessToken?: string;
  pushoverApplicationToken?: string;
  pushoverUserKey?: string;
  pushoverSound?: string;
  telegramEnabled?: boolean;
  telegramBotUsername?: string;
  telegramChatId?: string;
  telegramMessageThreadId?: string;
  telegramSendSilently?: boolean;
  webPushEnabled?: boolean;
  notificationTypes: Partial<NotificationAgentTypes>;
}
