import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import Error from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { MusicDetails } from '@server/models/Music';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MusicDetails', {
  discography: "{artistName}'s discography",
  byartist: 'by',
});

const MusicArtistDiscography = () => {
  const intl = useIntl();
  const router = useRouter();

  const { data: musicData } = useSWR<MusicDetails>(
    `/api/v1/music/${router.query.musicId}`
  );

  const { data: artistData } = useSWR(
    musicData ? `/api/v1/music/${router.query.musicId}/artist` : null
  );

  const releaseGroups = artistData?.artist?.releaseGroups ?? [];
  const mainArtistName =
    musicData?.artist.name.split(/[&,]|\sfeat\./)[0].trim() ?? '';

  if (!musicData && !artistData) {
    return <Error statusCode={404} />;
  }

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.discography, {
            artistName: mainArtistName,
          }),
          mainArtistName,
        ]}
      />
      <div className="mt-1 mb-5">
        <Header
          subtext={
            <Link
              href={`/music/${musicData?.mbId}`}
              className="hover:underline"
            >
              {`${musicData?.title} ${intl.formatMessage(
                messages.byartist
              )} ${mainArtistName}`}
            </Link>
          }
        >
          {intl.formatMessage(messages.discography, {
            artistName: mainArtistName,
          })}
        </Header>
      </div>
      <ListView
        items={releaseGroups}
        isEmpty={releaseGroups.length === 0}
        isLoading={!artistData}
        onScrollBottom={() => undefined}
      />
    </>
  );
};

export default MusicArtistDiscography;
