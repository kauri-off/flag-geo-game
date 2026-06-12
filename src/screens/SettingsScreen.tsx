// All game configuration in one place, bound to the settings store. Changing a
// difficulty filter restarts the round pool on next round.
import { useSettings } from '../store/settingsStore';
import { useGame } from '../store/gameStore';
import { CONTINENTS, countries, type SizeBucket } from '../data/countries';
import { mapIds } from '../map/world';
import { LANGUAGES, t, type Language } from '../i18n';
import { GAME_MODES, type GameModeId } from '../game/modes';
import { playSelect } from '../game/sound';

const SIZES: { value: SizeBucket | 'all'; key: 'sizeAll' | 'sizeSmall' | 'sizeMedium' | 'sizeLarge' }[] = [
  { value: 'all', key: 'sizeAll' },
  { value: 'small', key: 'sizeSmall' },
  { value: 'medium', key: 'sizeMedium' },
  { value: 'large', key: 'sizeLarge' },
];

// Counts shown on the "Countries" scope chips. Computed once from the countries
// actually present on the map.
const onMapCountries = countries.filter((c) => mapIds.has(c.id));
const SCOPES: {
  value: 'all' | 'un';
  key: 'scopeAll' | 'scopeUn';
  desc: 'scopeAllDesc' | 'scopeUnDesc';
  count: number;
}[] = [
  { value: 'all', key: 'scopeAll', desc: 'scopeAllDesc', count: onMapCountries.length },
  {
    value: 'un',
    key: 'scopeUn',
    desc: 'scopeUnDesc',
    count: onMapCountries.filter((c) => c.unMember).length,
  },
];

export function SettingsScreen() {
  const s = useSettings();
  const newRound = useGame((g) => g.newRound);
  const lang = s.language;

  // Difficulty changes should take effect immediately on the next round.
  const restart = () => newRound();

  return (
    <div className="settings">
      <section className="settings-group">
        <h3>{t('gameMode', lang)}</h3>
        <div className="chip-row">
          {Object.values(GAME_MODES).map((m) => (
            <button
              key={m.id}
              className={`chip ${s.mode === m.id ? 'on' : ''}`}
              onClick={() => s.setMode(m.id as GameModeId)}
            >
              {m.label[lang]}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('language', lang)}</h3>
        <div className="chip-row">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              className={`chip ${lang === l.code ? 'on' : ''}`}
              onClick={() => s.setLanguage(l.code as Language)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('showLabels', lang)}</h3>
        <label className="switch">
          <input
            type="checkbox"
            checked={s.showLabels}
            onChange={(e) => s.setShowLabels(e.target.checked)}
          />
          <span>{s.showLabels ? '✓' : ''}</span>
        </label>
      </section>

      <section className="settings-group">
        <h3>{t('showPickedFlag', lang)}</h3>
        <label className="switch">
          <input
            type="checkbox"
            checked={s.showPickedFlag}
            onChange={(e) => s.setShowPickedFlag(e.target.checked)}
          />
          <span>{s.showPickedFlag ? '✓' : ''}</span>
        </label>
      </section>

      <section className="settings-group">
        <h3>{t('sound', lang)}</h3>
        <label className="switch">
          <input
            type="checkbox"
            checked={s.soundOn}
            onChange={(e) => s.setSoundOn(e.target.checked)}
          />
          <span>{s.soundOn ? '✓' : ''}</span>
        </label>
      </section>

      <section className="settings-group">
        <h3>{t('volume', lang)}</h3>
        <div className="slider-row">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={s.volume}
            disabled={!s.soundOn}
            onChange={(e) => {
              s.setVolume(Number(e.target.value));
              playSelect(); // audible preview of the new level
            }}
          />
          <span className="slider-val">{s.volume}%</span>
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('answerTime', lang)}</h3>
        <div className="slider-row">
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={s.answerSeconds}
            onChange={(e) => s.setAnswerSeconds(Number(e.target.value))}
          />
          <span className="slider-val">
            {s.answerSeconds === 0 ? t('noLimit', lang) : `${s.answerSeconds}s`}
          </span>
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('oceanSnap', lang)}</h3>
        <div className="slider-row">
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={s.oceanSnapRadius}
            onChange={(e) => s.setOceanSnapRadius(Number(e.target.value))}
          />
          <span className="slider-val">
            {s.oceanSnapRadius === 0 ? t('off', lang) : s.oceanSnapRadius}
          </span>
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('confirmMode', lang)}</h3>
        <div className="chip-row">
          <button
            className={`chip ${s.confirmMode === 'spacebar' ? 'on' : ''}`}
            onClick={() => s.setConfirmMode('spacebar')}
          >
            {t('confirmSpacebar', lang)}
          </button>
          <button
            className={`chip ${s.confirmMode === 'click' ? 'on' : ''}`}
            onClick={() => s.setConfirmMode('click')}
          >
            {t('confirmClick', lang)}
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('difficulty', lang)} · {t('scope', lang)}</h3>
        <div className="chip-row">
          {SCOPES.map((sc) => (
            <button
              key={sc.value}
              className={`chip ${(s.difficulty.scope ?? 'all') === sc.value ? 'on' : ''}`}
              title={t(sc.desc, lang)}
              onClick={() => {
                s.setScope(sc.value);
                restart();
              }}
            >
              {t(sc.key, lang)} ({sc.count})
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('difficulty', lang)} · {t('continents', lang)}</h3>
        <div className="chip-row">
          {CONTINENTS.map((c) => (
            <button
              key={c}
              className={`chip ${s.difficulty.continents.includes(c) ? 'on' : ''}`}
              onClick={() => {
                s.toggleContinent(c);
                restart();
              }}
            >
              {c}
            </button>
          ))}
          {s.difficulty.continents.length === 0 && (
            <span className="muted">({t('all', lang)})</span>
          )}
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('difficulty', lang)} · {t('size', lang)}</h3>
        <div className="chip-row">
          {SIZES.map((sz) => (
            <button
              key={sz.value}
              className={`chip ${s.difficulty.size === sz.value ? 'on' : ''}`}
              onClick={() => {
                s.setSize(sz.value);
                restart();
              }}
            >
              {t(sz.key, lang)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
