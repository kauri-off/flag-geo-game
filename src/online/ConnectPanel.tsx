// First online screen: pick a server, then log in, register, or play as a guest.
import { useState } from 'react';
import { Flag } from '../components/Flag';
import { AvatarPicker } from './AvatarPicker';
import { useOnline } from '../store/onlineStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

type Mode = 'login' | 'register' | 'guest';

export function ConnectPanel() {
  const language = useSettings((s) => s.language);
  const { serverUrl, nickname, avatar, status, error, account, token } = useOnline();
  const setServerUrl = useOnline((s) => s.setServerUrl);
  const setNickname = useOnline((s) => s.setNickname);
  const setAvatar = useOnline((s) => s.setAvatar);
  const connect = useOnline((s) => s.connect);
  const login = useOnline((s) => s.login);
  const register = useOnline((s) => s.register);
  const logout = useOnline((s) => s.logout);
  const resume = useOnline((s) => s.resume);

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverPassword, setServerPassword] = useState('');

  const busy = status === 'busy';

  const canLogin = serverUrl.trim() && username.trim() && password && !busy;
  const canRegister = serverUrl.trim() && username.trim() && password && avatar && !busy;
  const canGuest = serverUrl.trim() && nickname.trim() && avatar && !busy;

  // Enter in any field fires the active mode's primary action — but only when that
  // action's enable condition is met, mirroring the button's disabled state.
  const submit = () => {
    if (mode === 'guest') {
      if (canGuest) connect(serverPassword);
    } else if (mode === 'login') {
      if (canLogin) login(username, password);
    } else if (canRegister) {
      register(username, password, serverPassword);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  // A persisted session: offer to continue or sign out without re-entering creds.
  if (account && token) {
    return (
      <div className="online-connect panel">
        <p className="online-tagline">{t('onlineTagline', language)}</p>
        <div className="session-card">
          <Flag alpha2={account.avatar} className="avatar-preview" />
          <div className="session-who">
            <span className="muted">{t('signedInAs', language)}</span>
            <strong>{account.username}</strong>
          </div>
        </div>
        {error && <div className="online-error">{error}</div>}
        <button className="btn primary" disabled={busy} onClick={resume}>
          {t('continue', language)}
        </button>
        <button className="btn ghost" disabled={busy} onClick={logout}>
          {t('logOut', language)}
        </button>
      </div>
    );
  }

  const serverField = (
    <label className="field">
      <span>{t('serverUrl', language)}</span>
      <input
        type="text"
        className="text-input wide"
        placeholder="https://example.com/flaggame"
        value={serverUrl}
        onChange={(e) => setServerUrl(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={onKey}
      />
      <small className="hint">{t('serverUrlHint', language)}</small>
    </label>
  );

  return (
    <div className="online-connect panel">
      <p className="online-tagline">{t('onlineTagline', language)}</p>

      <div className="auth-tabs">
        {(['login', 'register', 'guest'] as Mode[]).map((m) => (
          <button
            key={m}
            className={`auth-tab ${mode === m ? 'on' : ''}`}
            onClick={() => setMode(m)}
          >
            {t(m === 'login' ? 'logIn' : m === 'register' ? 'register' : 'guest', language)}
          </button>
        ))}
      </div>

      {serverField}

      {mode === 'guest' ? (
        <>
          <label className="field">
            <span>{t('nickname', language)}</span>
            <input
              type="text"
              className="text-input wide"
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
          <label className="field">
            <span>
              {t('serverPassword', language)} <em>({t('optional', language)})</em>
            </span>
            <input
              type="password"
              className="text-input wide"
              value={serverPassword}
              onChange={(e) => setServerPassword(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
          <div className="field">
            <span>
              {t('avatar', language)}{' '}
              {avatar && <Flag alpha2={avatar} className="avatar-preview" />}
            </span>
            <AvatarPicker value={avatar} onChange={setAvatar} />
          </div>
          {error && <div className="online-error">{error}</div>}
          <button className="btn primary" disabled={!canGuest} onClick={() => connect(serverPassword)}>
            {busy ? t('connecting', language) : t('connect', language)}
          </button>
        </>
      ) : (
        <>
          <label className="field">
            <span>{t('username', language)}</span>
            <input
              type="text"
              className="text-input wide"
              maxLength={20}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
          <label className="field">
            <span>{t('password', language)}</span>
            <input
              type="password"
              className="text-input wide"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKey}
            />
          </label>

          {mode === 'register' && (
            <>
              <label className="field">
                <span>
                  {t('serverPassword', language)} <em>({t('optional', language)})</em>
                </span>
                <input
                  type="password"
                  className="text-input wide"
                  value={serverPassword}
                  onChange={(e) => setServerPassword(e.target.value)}
                  onKeyDown={onKey}
                />
              </label>
              <div className="field">
                <span>
                  {t('avatar', language)}{' '}
                  {avatar && <Flag alpha2={avatar} className="avatar-preview" />}
                </span>
                <AvatarPicker value={avatar} onChange={setAvatar} />
              </div>
            </>
          )}

          {error && <div className="online-error">{error}</div>}

          {mode === 'login' ? (
            <button className="btn primary" disabled={!canLogin} onClick={() => login(username, password)}>
              {busy ? t('connecting', language) : t('logIn', language)}
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={!canRegister}
              onClick={() => register(username, password, serverPassword)}
            >
              {busy ? t('connecting', language) : t('register', language)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
