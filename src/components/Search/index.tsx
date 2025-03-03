import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import { useProgressiveCovers } from '@app/hooks/useProgressiveCovers';
import Error from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type {
  AlbumResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Search', {
  search: 'Search',
  searchresults: 'Search Results',
});

const Search = () => {
  const intl = useIntl();
  const router = useRouter();

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<MovieResult | TvResult | PersonResult | AlbumResult>(
    `/api/v1/search`,
    {
      query: router.query.query,
    },
    { hideAvailable: false }
  );

  const enhancedItems = useProgressiveCovers(
    titles?.filter((item): item is AlbumResult => {
      return (
        item.mediaType === 'album' &&
        typeof item.id === 'string' &&
        'needsCoverArt' in item
      );
    }) ?? []
  );

  const mergedResults = titles?.map((item) => {
    if (item.mediaType === 'album') {
      return enhancedItems.find((album) => album.id === item.id) ?? item;
    }
    return item;
  });

  if (error) {
    return <Error statusCode={500} />;
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.search)} />
      <div className="mt-1 mb-5">
        <Header>{intl.formatMessage(messages.searchresults)}</Header>
      </div>
      <ListView
        items={mergedResults}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
      />
    </>
  );
};

export default Search;
