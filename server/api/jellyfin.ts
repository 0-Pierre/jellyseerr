/* eslint-disable @typescript-eslint/no-explicit-any */
import ExternalAPI from '@server/api/externalapi';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import availabilitySync from '@server/lib/availabilitySync';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { ApiError } from '@server/types/error';
import { getAppVersion } from '@server/utils/appVersion';

export interface JellyfinUserResponse {
  Name: string;
  ServerId: string;
  ServerName: string;
  Id: string;
  Configuration: {
    GroupedFolders: string[];
  };
  Policy: {
    IsAdministrator: boolean;
  };
  PrimaryImageTag?: string;
}

export interface JellyfinLoginResponse {
  User: JellyfinUserResponse;
  AccessToken: string;
}

export interface JellyfinUserListResponse {
  users: JellyfinUserResponse[];
}

interface JellyfinMediaFolder {
  Name: string;
  Id: string;
  Type: string;
  CollectionType: string;
}

export interface JellyfinLibrary {
  type: 'show' | 'movie';
  key: string;
  title: string;
  agent: string;
}

export interface JellyfinLibraryItem {
  Name: string;
  Id: string;
  HasSubtitles: boolean;
  Type: 'Movie' | 'Episode' | 'Season' | 'Series';
  LocationType: 'FileSystem' | 'Offline' | 'Remote' | 'Virtual';
  SeriesName?: string;
  SeriesId?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  IndexNumberEnd?: number;
  ParentIndexNumber?: number;
  MediaType: string;
}

export interface JellyfinMediaStream {
  Codec: string;
  Type: 'Video' | 'Audio' | 'Subtitle';
  Height?: number;
  Width?: number;
  AverageFrameRate?: number;
  RealFrameRate?: number;
  Language?: string;
  DisplayTitle: string;
}

export interface JellyfinMediaSource {
  Protocol: string;
  Id: string;
  Path: string;
  Type: string;
  VideoType: string;
  MediaStreams: JellyfinMediaStream[];
}

export interface JellyfinLibraryItemExtended extends JellyfinLibraryItem {
  ProviderIds: {
    Tmdb?: string;
    Imdb?: string;
    Tvdb?: string;
  };
  MediaSources?: JellyfinMediaSource[];
  Width?: number;
  Height?: number;
  IsHD?: boolean;
  DateCreated?: string;
}

export interface JellyfinItemsReponse {
  Items: JellyfinLibraryItemExtended[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface JellyfinUser {
  Id: string;
  Name: string;
  ServerId: string;
  HasPassword?: boolean;
  HasConfiguredPassword?: boolean;
  Policy?: {
    IsAdministrator: boolean;
    IsDisabled: boolean;
  };
}

class JellyfinAPI extends ExternalAPI {
  private userId?: string;
  private mediaServerType: MediaServerType;

  constructor(
    jellyfinHost: string,
    authToken?: string | null,
    deviceId?: string | null
  ) {
    const settings = getSettings();
    const safeDeviceId =
      deviceId && deviceId.length > 0
        ? deviceId
        : Buffer.from(`BOT_jellyseerr_fallback_${Date.now()}`).toString(
            'base64'
          );

    let authHeaderVal: string;
    if (authToken) {
      authHeaderVal = `MediaBrowser Client="Jellyseerr", Device="Jellyseerr", DeviceId="${safeDeviceId}", Version="${getAppVersion()}", Token="${authToken}"`;
    } else {
      authHeaderVal = `MediaBrowser Client="Jellyseerr", Device="Jellyseerr", DeviceId="${safeDeviceId}", Version="${getAppVersion()}"`;
    }

    super(
      jellyfinHost,
      {},
      {
        headers: {
          'X-Emby-Authorization': authHeaderVal,
        },
      }
    );

    this.mediaServerType = settings.main.mediaServerType;
  }

  public async login(
    Username?: string,
    Password?: string,
    ClientIP?: string
  ): Promise<JellyfinLoginResponse> {
    const authenticate = async (useHeaders: boolean) => {
      const headers: { [key: string]: string } =
        useHeaders && ClientIP ? { 'X-Forwarded-For': ClientIP } : {};

      return this.post<JellyfinLoginResponse>(
        '/Users/AuthenticateByName',
        {
          Username,
          Pw: Password,
        },
        {},
        undefined,
        { headers }
      );
    };

    try {
      return await authenticate(true);
    } catch (e) {
      logger.debug('Failed to authenticate with headers', {
        label: 'Jellyfin API',
        error: e.cause.message ?? e.cause.statusText,
        ip: ClientIP,
      });

      if (!e.cause.status) {
        throw new ApiError(404, ApiErrorCode.InvalidUrl);
      }

      if (e.cause.status === 401) {
        throw new ApiError(e.cause.status, ApiErrorCode.InvalidCredentials);
      }
    }

    try {
      return await authenticate(false);
    } catch (e) {
      if (e.cause.status === 401) {
        throw new ApiError(e.cause.status, ApiErrorCode.InvalidCredentials);
      }

      logger.error(
        'Something went wrong while authenticating with the Jellyfin server',
        {
          label: 'Jellyfin API',
          error: e.cause.message ?? e.cause.statusText,
          ip: ClientIP,
        }
      );

      throw new ApiError(e.cause.status, ApiErrorCode.Unknown);
    }
  }

  public setUserId(userId: string): void {
    this.userId = userId;
    return;
  }

  public async getSystemInfo(): Promise<any> {
    try {
      const systemInfoResponse = await this.get<any>('/System/Info');

      return systemInfoResponse;
    } catch (e) {
      throw new ApiError(e.cause?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getServerName(): Promise<string> {
    try {
      const serverResponse = await this.get<JellyfinUserResponse>(
        '/System/Info/Public'
      );

      return serverResponse.ServerName;
    } catch (e) {
      logger.error(
        'Something went wrong while getting the server name from the Jellyfin server',
        { label: 'Jellyfin API', error: e.cause.message ?? e.cause.statusText }
      );

      throw new ApiError(e.cause?.status, ApiErrorCode.Unknown);
    }
  }

  public async getUsers(): Promise<JellyfinUserListResponse> {
    try {
      const userReponse = await this.get<JellyfinUserResponse[]>(`/Users`);

      return { users: userReponse };
    } catch (e) {
      logger.error(
        'Something went wrong while getting the account from the Jellyfin server',
        { label: 'Jellyfin API', error: e.cause.message ?? e.cause.statusText }
      );

      throw new ApiError(e.cause?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getUser(): Promise<JellyfinUserResponse> {
    try {
      const userReponse = await this.get<JellyfinUserResponse>(
        `/Users/${this.userId ?? 'Me'}`
      );
      return userReponse;
    } catch (e) {
      logger.error(
        'Something went wrong while getting the account from the Jellyfin server',
        { label: 'Jellyfin API', error: e.cause.message ?? e.cause.statusText }
      );

      throw new ApiError(e.cause?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getLibraries(): Promise<JellyfinLibrary[]> {
    try {
      const mediaFolderResponse = await this.get<any>(`/Library/MediaFolders`);

      return this.mapLibraries(mediaFolderResponse.Items);
    } catch (mediaFoldersResponseError) {
      // fallback to user views to get libraries
      // this only and maybe/depending on factors affects LDAP users
      try {
        const mediaFolderResponse = await this.get<any>(
          `/Users/${this.userId ?? 'Me'}/Views`
        );

        return this.mapLibraries(mediaFolderResponse.Items);
      } catch (e) {
        logger.error(
          'Something went wrong while getting libraries from the Jellyfin server',
          {
            label: 'Jellyfin API',
            error: e.cause.message ?? e.cause.statusText,
          }
        );

        return [];
      }
    }
  }

  private mapLibraries(mediaFolders: JellyfinMediaFolder[]): JellyfinLibrary[] {
    const excludedTypes = [
      'music',
      'books',
      'musicvideos',
      'homevideos',
      'boxsets',
    ];

    return mediaFolders
      .filter((Item: JellyfinMediaFolder) => {
        return (
          Item.Type === 'CollectionFolder' &&
          !excludedTypes.includes(Item.CollectionType)
        );
      })
      .map((Item: JellyfinMediaFolder) => {
        return <JellyfinLibrary>{
          key: Item.Id,
          title: Item.Name,
          type: Item.CollectionType === 'movies' ? 'movie' : 'show',
          agent: 'jellyfin',
        };
      });
  }

  public async getLibraryContents(id: string): Promise<JellyfinLibraryItem[]> {
    try {
      const libraryItemsResponse = await this.get<any>(`/Items`, {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'Series,Movie,Others',
        Recursive: 'true',
        StartIndex: '0',
        ParentId: id,
        collapseBoxSetItems: 'false',
      });

      return libraryItemsResponse.Items.filter(
        (item: JellyfinLibraryItem) => item.LocationType !== 'Virtual'
      );
    } catch (e) {
      logger.error(
        'Something went wrong while getting library content from the Jellyfin server',
        { label: 'Jellyfin API', error: e.cause.message ?? e.cause.statusText }
      );

      throw new ApiError(e.cause?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getRecentlyAdded(id: string): Promise<JellyfinLibraryItem[]> {
    try {
      const endpoint =
        this.mediaServerType === MediaServerType.JELLYFIN
          ? `/Items/Latest`
          : `/Users/${this.userId}/Items/Latest`;

      const baseParams = {
        Limit: '12',
        ParentId: id,
      };

      const params =
        this.mediaServerType === MediaServerType.JELLYFIN
          ? { ...baseParams, userId: this.userId ?? `Me` }
          : baseParams;

      const itemResponse = await this.get<any>(endpoint, params);

      return itemResponse;
    } catch (e) {
      logger.error(
        'Something went wrong while getting library content from the Jellyfin server',
        { label: 'Jellyfin API', error: e.cause.message ?? e.cause.statusText }
      );

      throw new ApiError(e.cause?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getItemData(
    id: string
  ): Promise<JellyfinLibraryItemExtended | undefined> {
    try {
      const itemResponse = await this.get<JellyfinItemsReponse>(`/Items`, {
        ids: id,
        fields: 'ProviderIds,MediaSources,Width,Height,IsHD,DateCreated',
      });

      return itemResponse.Items?.[0];
    } catch (e) {
      if (availabilitySync.running) {
        if (e.cause?.status === 500) {
          return undefined;
        }
      }

      logger.error(
        'Something went wrong while getting library content from the Jellyfin server',
        { label: 'Jellyfin API', error: e.cause.message ?? e.cause.statusText }
      );
      throw new ApiError(e.cause?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getSeasons(seriesID: string): Promise<JellyfinLibraryItem[]> {
    try {
      const seasonResponse = await this.get<any>(`/Shows/${seriesID}/Seasons`);

      return seasonResponse.Items;
    } catch (e) {
      logger.error(
        'Something went wrong while getting the list of seasons from the Jellyfin server',
        { label: 'Jellyfin API', error: e.cause.message ?? e.cause.statusText }
      );

      throw new ApiError(e.cause?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getEpisodes(
    seriesID: string,
    seasonID: string
  ): Promise<JellyfinLibraryItem[]> {
    try {
      const episodeResponse = await this.get<any>(
        `/Shows/${seriesID}/Episodes`,
        {
          seasonId: seasonID,
        }
      );

      return episodeResponse.Items.filter(
        (item: JellyfinLibraryItem) => item.LocationType !== 'Virtual'
      );
    } catch (e) {
      logger.error(
        'Something went wrong while getting the list of episodes from the Jellyfin server',
        { label: 'Jellyfin API', error: e.cause.message ?? e.cause.statusText }
      );

      throw new ApiError(e.cause?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async createApiToken(appName: string): Promise<string> {
    try {
      await this.post(`/Auth/Keys?App=${appName}`);
      const apiKeys = await this.get<any>(`/Auth/Keys`);
      return apiKeys.Items.reverse().find(
        (item: any) => item.AppName === appName
      ).AccessToken;
    } catch (e) {
      logger.error(
        'Something went wrong while creating an API key from the Jellyfin server',
        { label: 'Jellyfin API', error: e.cause.message ?? e.cause.statusText }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async createUser(options: {
    Name: string;
    Password?: string;
  }): Promise<JellyfinUser> {
    try {
      const newUser = await this.post<JellyfinUser>('/Users/New', {
        Name: options.Name,
        Password: options.Password,
      });

      if (!newUser?.Id) {
        throw new Error('Failed to create Jellyfin user - no user ID returned');
      }

      await this.post(`/Users/${newUser.Id}/Policy`, {
        IsAdministrator: false,
        IsDisabled: false,
        EnableUserPreferenceAccess: true,
        EnableRemoteAccess: true,
        EnableMediaPlayback: false,
        EnableVideoPlayback: false,
        EnableAudioPlayback: false,
        EnableAudioPlaybackTranscoding: false,
        EnableVideoPlaybackTranscoding: false,
        EnablePlaybackRemuxing: false,
        ForceRemoteSourceTranscoding: false,
        EnableMediaConversion: false,
        EnableSyncTranscoding: false,
        EnableAllDevices: true,
        EnabledDevices: [],
        EnableAllChannels: true,
        EnabledChannels: [],
        EnableAllFolders: true,
        EnabledFolders: [],
        EnableContentDownloading: false,
        EnableLiveTvAccess: false,
        EnableLiveTvManagement: false,
        AuthenticationProviderId:
          'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
        PasswordResetProviderId:
          'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
      });

      return newUser;
    } catch (e) {
      logger.error(`Failed to create Jellyfin user: ${e.message}`, {
        label: 'Jellyfin API',
      });
      throw new ApiError(e.response?.status, ApiErrorCode.InvalidJellyfinUser);
    }
  }

  public async deleteUser(userId: string): Promise<void> {
    try {
      await this.delete<void>(`/Users/${userId}`);
    } catch (e) {
      logger.error(`Failed to delete user from Jellyfin: ${e.message}`, {
        label: 'Jellyfin API',
      });
      throw new ApiError(e.response?.status, ApiErrorCode.InvalidJellyfinUser);
    }
  }

  public async resetUserPassword(
    userId: string,
    newPassword: string
  ): Promise<void> {
    try {
      await this.post<void>(`/Users/${userId}/Password`, {
        NewPw: newPassword,
      });
    } catch (e) {
      logger.error(`Failed to reset password for Jellyfin user: ${e.message}`, {
        label: 'Jellyfin API',
      });
      throw new ApiError(e.response?.status, ApiErrorCode.InvalidJellyfinUser);
    }
  }

  public async updateUserPolicy(
    userId: string,
    policy: {
      IsAdministrator: boolean;
      IsDisabled: boolean;
      EnableUserPreferenceAccess: boolean;
      EnableLiveTvAccess: boolean;
      EnableLiveTvManagement: boolean;
      EnableRemoteAccess: boolean;
      EnableMediaPlayback: boolean;
      EnableVideoPlayback: boolean;
      EnableAudioPlayback: boolean;
      EnableMediaConversion: boolean;
      EnableVideoPlaybackTranscoding: boolean;
      EnableAudioPlaybackTranscoding: boolean;
      EnableContentDownloading: boolean;
      EnablePlaybackRemuxing: boolean;
      PasswordResetProviderId: string;
      AuthenticationProviderId: string;
    }
  ): Promise<void> {
    await this.post(`/Users/${userId}/Policy`, {
      ...policy,
      AuthenticationProviderId:
        policy.AuthenticationProviderId ??
        'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
      PasswordResetProviderId:
        policy.PasswordResetProviderId ??
        'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
    });
  }
}
export default JellyfinAPI;
