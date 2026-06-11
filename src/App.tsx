// App shell: top navigation + active screen. Screens are independent modules so
// new game modes / screens can be slotted in without touching each other.
import { GameScreen } from './screens/GameScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useUi, type Screen } from './store/uiStore';
import { useSettings } from './store/settingsStore';
import { t } from './i18n';

const NAV: { screen: Screen; key: 'play' | 'history' | 'settings' }[] = [
  { screen: 'play', key: 'play' },
  { screen: 'history', key: 'history' },
  { screen: 'settings', key: 'settings' },
];

export default function App() {
  const screen = useUi((s) => s.screen);
  const setScreen = useUi((s) => s.setScreen);
  const language = useSettings((s) => s.language);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🌍 {t('appTitle', language)}</div>
        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.screen}
              className={`nav-btn ${screen === n.screen ? 'active' : ''}`}
              onClick={() => setScreen(n.screen)}
            >
              {t(n.key, language)}
            </button>
          ))}
        </nav>
      </header>
      <main className="content">
        {screen === 'play' && <GameScreen />}
        {screen === 'history' && <HistoryScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
