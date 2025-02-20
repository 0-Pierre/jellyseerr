import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import type { FilterOptions } from '@app/components/Discover/constants';
import { prepareFilterValues } from '@app/components/Discover/constants';
import useDiscover from '@app/hooks/useDiscover';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import Error from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon } from '@heroicons/react/24/solid';
import type { AlbumResult } from '@server/models/Search';
import { debounce } from 'lodash'; // Install lodash if you don't have it
import { useRouter } from 'next/router';
import type { ChangeEvent } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMusic', {
  discovermusics: 'Music',
  sortPopularityDesc: 'Most Listened',
  sortPopularityAsc: 'Least Listened',
  sortReleaseDateDesc: 'Newest First',
  sortReleaseDateAsc: 'Oldest First',
  sortTitleAsc: 'Title (A-Z)',
  sortTitleDesc: 'Title (Z-A)',
});

const SortOptions = {
  PopularityDesc: 'listen_count.desc',
  PopularityAsc: 'listen_count.asc',
  ReleaseDateDesc: 'release_date.desc',
  ReleaseDateAsc: 'release_date.asc',
  TitleAsc: 'title.asc',
  TitleDesc: 'title.desc',
} as const;

const DiscoverMusic = () => {
  const intl = useIntl();
  const router = useRouter();
  const updateQueryParams = useUpdateQueryParams({});

  const preparedFilters = useMemo(
    () => prepareFilterValues(router.query),
    [router.query]
  );

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<AlbumResult & { id: number }, unknown, FilterOptions>(
    '/api/v1/discover/music',
    preparedFilters
  );

  const debouncedFetchMore = useCallback(
    debounce(() => {
      if (!isLoadingMore && !isReachingEnd) {
        fetchMore();
      }
    }, 150),
    [fetchMore, isLoadingMore, isReachingEnd]
  );

  const sortOptions = useMemo(
    () => ({
      [SortOptions.PopularityDesc]: intl.formatMessage(
        messages.sortPopularityDesc
      ),
      [SortOptions.PopularityAsc]: intl.formatMessage(
        messages.sortPopularityAsc
      ),
      [SortOptions.ReleaseDateDesc]: intl.formatMessage(
        messages.sortReleaseDateDesc
      ),
      [SortOptions.ReleaseDateAsc]: intl.formatMessage(
        messages.sortReleaseDateAsc
      ),
      [SortOptions.TitleAsc]: intl.formatMessage(messages.sortTitleAsc),
      [SortOptions.TitleDesc]: intl.formatMessage(messages.sortTitleDesc),
    }),
    [intl]
  );

  const handleSortChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      updateQueryParams('sortBy', e.target.value);
    },
    [updateQueryParams]
  );

  if (error) {
    return <Error statusCode={500} />;
  }

  const title = intl.formatMessage(messages.discovermusics);

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
        <div className="mt-2 flex flex-grow flex-col sm:flex-row lg:flex-grow-0">
          <div className="mb-2 flex flex-grow sm:mb-0 sm:mr-2 lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <BarsArrowDownIcon className="h-6 w-6" />
            </span>
            <select
              id="sortBy"
              name="sortBy"
              className="rounded-r-only"
              value={preparedFilters.sortBy}
              onChange={handleSortChange}
            >
              {Object.entries(sortOptions).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <ListView
        items={titles}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={debouncedFetchMore}
      />
    </>
  );
};

export default memo(DiscoverMusic);
