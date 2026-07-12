// Challenge mode: configure a finite scored run, play it, then see an analysis.
// Three phases keyed off the game store: setup (no active challenge), play (a
// challenge running) and results (the run finished). The round itself reuses the
// shared RoundBoard; this screen adds the setup form, the in-run HUD and the
// end-of-run breakdown.
import { useState } from 'react';
import { RoundBoard } from '../components/RoundBoard';
import { StatsRow } from '../components/StatsRow';
import { useGame } from '../store/gameStore';
import { useSettings, type DifficultyFilter } from '../store/settingsStore';
import {
  ROUND_PRESETS,
  ATTEMPT_PRESETS,
  PERFECT_SEC,
  analyzeChallenge,
} from '../game/challenge';
import { DifficultyPicker } from '../components/DifficultyPicker';
import { statsFromRounds } from '../game/stats';
import type { Stats } from '../game/types';
import { t } from '../i18n';

export function ChallengeScreen() {
  const challenge = useGame((s) => s.challenge);
  const status = useGame((s) => s.status);

  if (!challenge) return <ChallengeSetup />;
  if (status === 'finished') return <ChallengeResults />;
  return <ChallengePlay />;
}

function ChallengeSetup() {
  const lang = useSettings((s) => s.language);
  const startChallenge = useGame((s) => s.startChallenge);
  // Seed the form from the last-played configuration so a returning player
  // doesn't re-enter their preferred setup every time.
  const lastChallenge = useSettings((s) => s.lastChallenge);
  const setLastChallenge = useSettings((s) => s.setLastChallenge);

  const [rounds, setRounds] = useState(lastChallenge.rounds);
  const [timeLimitSec, setTimeLimitSec] = useState(lastChallenge.timeLimitSec);
  const [attempts, setAttempts] = useState(lastChallenge.attempts);
  const [difficulty, setDifficulty] = useState<DifficultyFilter>(lastChallenge.difficulty);

  const start = () => {
    const config = { rounds: Math.max(1, rounds), timeLimitSec, attempts, difficulty };
    setLastChallenge(config);
    startChallenge(config);
  };

  return (
    <div className="settings">
      <h2>{t('challengeSetup', lang)}</h2>

      <section className="settings-group">
        <h3>{t('rounds', lang)}</h3>
        <div className="chip-row">
          {ROUND_PRESETS.map((n) => (
            <button
              key={n}
              className={`chip ${rounds === n ? 'on' : ''}`}
              onClick={() => setRounds(n)}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={500}
            className="num-input"
            value={rounds}
            onChange={(e) => setRounds(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
          />
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('timeLimit', lang)}</h3>
        <div className="slider-row">
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={timeLimitSec}
            onChange={(e) => setTimeLimitSec(Number(e.target.value))}
          />
          <span className="slider-val">
            {timeLimitSec === 0 ? t('noLimit', lang) : `${timeLimitSec}s`}
          </span>
        </div>
        <p className="muted scoring-note">{t('scoringNote', lang)}</p>
      </section>

      <section className="settings-group">
        <h3>{t('attempts', lang)}</h3>
        <div className="chip-row">
          {ATTEMPT_PRESETS.map((n) => (
            <button
              key={n}
              className={`chip ${attempts === n ? 'on' : ''}`}
              onClick={() => setAttempts(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="muted scoring-note">{t('attemptsNote', lang)}</p>
      </section>

      <DifficultyPicker value={difficulty} lang={lang} onChange={setDifficulty} />

      <div className="controls" style={{ justifyContent: 'flex-start' }}>
        <button className="btn primary big" onClick={start}>
          {t('startChallenge', lang)}
        </button>
      </div>
    </div>
  );
}

function ChallengePlay() {
  const lang = useSettings((s) => s.language);
  const config = useGame((s) => s.challenge!.config);
  const results = useGame((s) => s.challenge!.results);
  const score = useGame((s) => s.challenge!.score);
  const status = useGame((s) => s.status);
  const attemptsLeft = useGame((s) => s.attemptsLeft);
  const next = useGame((s) => s.next);
  const endChallenge = useGame((s) => s.endChallenge);

  // The round being played is one past those already recorded (unless revealed).
  const current = Math.min(config.rounds, results.length + (status === 'revealed' ? 0 : 1));

  return (
    <div className="game">
      <div className="challenge-hud">
        <div className="hud-item">
          <span className="hud-key">{t('round', lang)}</span>
          <span className="hud-val">{current}/{config.rounds}</span>
        </div>
        <div className="hud-item">
          <span className="hud-key">{t('score', lang)}</span>
          <span className="hud-val">{score}</span>
        </div>
        {config.attempts > 1 && (
          <div className="hud-item">
            <span className="hud-key">{t('attempts', lang)}</span>
            <span className="hud-val">{attemptsLeft}/{config.attempts}</span>
          </div>
        )}
        <div className="hud-actions">
          {status === 'revealed' && (
            <button className="btn primary" onClick={next}>{t('next', lang)}</button>
          )}
          <button className="btn" onClick={endChallenge}>{t('quit', lang)}</button>
        </div>
      </div>
      <RoundBoard />
    </div>
  );
}

function ChallengeResults() {
  const lang = useSettings((s) => s.language);
  const challenge = useGame((s) => s.challenge!);
  const startChallenge = useGame((s) => s.startChallenge);
  const endChallenge = useGame((s) => s.endChallenge);

  const a = analyzeChallenge(challenge);
  const stats: Stats = statsFromRounds(
    challenge.results.map((r) => ({
      id: '', date: 0, mode: '', flagAlpha2: '',
      targetId: r.targetId, targetName: '', guessId: null, guessName: null,
      correct: r.correct, timeMs: r.timeMs,
    })),
  );
  const pct = a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0;

  return (
    <div className="settings">
      <h2>{t('challengeDone', lang)}</h2>

      <div className="score-hero">
        <div className="score-big">{a.score}</div>
        <div className="muted">
          / {a.maxScore} · {pct}%
        </div>
      </div>

      <StatsRow stats={stats} language={lang} />

      <div className="extra-stats">
        <div className="stat">
          <div className="stat-val">{a.perfect}</div>
          <div className="stat-key">{t('perfect', lang)} (≤{PERFECT_SEC}s)</div>
        </div>
        <div className="stat">
          <div className="stat-val">{a.timedOut}</div>
          <div className="stat-key">{t('timedOut', lang)}</div>
        </div>
      </div>

      <div className="controls" style={{ justifyContent: 'flex-start' }}>
        <button className="btn primary big" onClick={() => startChallenge(challenge.config)}>
          {t('playAgain', lang)}
        </button>
        <button className="btn" onClick={endChallenge}>
          {t('newChallenge', lang)}
        </button>
      </div>
    </div>
  );
}
