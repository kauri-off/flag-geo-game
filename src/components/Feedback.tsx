// Correct/wrong banner shown after a round is revealed.
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { countryById } from '../data/countries';
import { countryName, t } from '../i18n';
import { formatTime } from '../game/stats';

export function Feedback() {
  const status = useGame((s) => s.status);
  const lastCorrect = useGame((s) => s.lastCorrect);
  const lastTimeMs = useGame((s) => s.lastTimeMs);
  const targetId = useGame((s) => s.targetId);
  const selectedId = useGame((s) => s.selectedId);
  const language = useSettings((s) => s.language);

  if (status !== 'revealed') return null;

  const answer = countryName(targetId, language, countryById.get(targetId ?? '')?.alpha3);
  const picked = selectedId
    ? countryName(selectedId, language, countryById.get(selectedId)?.alpha3)
    : t('noGuess', language);

  return (
    <div className={`feedback ${lastCorrect ? 'ok' : 'bad'}`}>
      <div className="feedback-headline">
        {lastCorrect ? t('correct', language) : t('wrong', language)}
        <span className="feedback-time"> · {formatTime(lastTimeMs)}</span>
      </div>
      {!lastCorrect && (
        <div className="feedback-detail">
          {t('theAnswerWas', language)}: <b>{answer}</b>
          {' · '}
          {t('youPicked', language)}: {picked}
        </div>
      )}
    </div>
  );
}
