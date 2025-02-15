export interface ArtistDetails {
  name: string;
  area?: string;
  artist: {
    name: string;
    artist_mbid: string;
    begin_year?: number;
    end_year?: number;
    area?: string;
  };
  alsoKnownAs?: string[];
  biography?: string;
  wikipedia?: {
    content: string;
  };
  artistThumb?: string | null;
  artistBackdrop?: string | null;
  profilePath?: string;
  releaseGroups?: {
    id: string;
    title: string;
    'first-release-date': string;
    'artist-credit': {
      name: string;
    }[];
    'primary-type': string;
    posterPath?: string;
    mediaInfo?: {
      status?: string;
    };
  }[];
}
