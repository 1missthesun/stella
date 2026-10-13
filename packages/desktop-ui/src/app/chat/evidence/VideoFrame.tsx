export const VideoFrame = ({
  poster,
  durationLabel,
  title,
  onOpen,
}: {
  poster?: string;
  durationLabel?: string;
  title: string;
  onOpen: () => void;
}) => (
  <button
    type="button"
    className="evidence-video"
    aria-label={`Open ${title}`}
    onClick={(event) => {
      event.stopPropagation();
      onOpen();
    }}
  >
    {poster ? (
      <img className="evidence-video__poster" src={poster} alt="" draggable={false} />
    ) : (
      <span className="evidence-video__poster evidence-video__poster--blank" />
    )}
    {durationLabel ? (
      <span className="media-tile__badge" aria-hidden="true">
        {durationLabel}
      </span>
    ) : null}
  </button>
);
