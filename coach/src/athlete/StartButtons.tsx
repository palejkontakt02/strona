import { Icon } from '../components/ui';

/** „Start” dla zawodnika; w podglądzie trenera także „Prowadź jako trener”. */
export function StartButtons({ onStart, onTrainer, label = 'Start' }: { onStart: () => void; onTrainer?: () => void; label?: string }) {
  if (!onTrainer)
    return (
      <button className="btn btn-primary btn-lg btn-block" onClick={onStart}>
        <Icon name="play" /> {label}
      </button>
    );
  return (
    <>
      {label !== 'Start' && <p className="muted small start-label">{label}</p>}
      <div className="start-pair">
        <button className="btn btn-primary btn-lg" onClick={onTrainer}>
          <Icon name="play" /> Prowadź jako trener
        </button>
        <button className="btn btn-secondary btn-lg" onClick={onStart}>
          Jako zawodnik
        </button>
      </div>
    </>
  );
}
