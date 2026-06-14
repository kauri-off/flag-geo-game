// First online screen: pick a server, nickname and avatar, then connect.
import { useState } from 'react';
import { Flag } from '../components/Flag';
import { AvatarPicker } from './AvatarPicker';
import { useOnline } from '../store/onlineStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

export function ConnectPanel() {
  const language = useSettings((s) => s.language);
  const { serverUrl, nickname, avatar, status, error } = useOnline();
  const setServerUrl = useOnline((s) => s.setServerUrl);
  const setNickname = useOnline((s) => s.setNickname);
  const setAvatar = useOnline((s) => s.setAvatar);
  const connect = useOnline((s) => s.connect);
  const [password, setPassword] = useState('');

  const busy = status === 'busy';
  const canConnect = serverUrl.trim() && nickname.trim() && avatar && !busy;

  return (
    <div className="online-connect panel">
      <p className="online-tagline">{t('onlineTagline', language)}</p>

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
        />
        <small className="hint">{t('serverUrlHint', language)}</small>
      </label>

      <label className="field">
        <span>{t('nickname', language)}</span>
        <input
          type="text"
          className="text-input wide"
          maxLength={20}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </label>

      <label className="field">
        <span>
          {t('serverPassword', language)} <em>({t('optional', language)})</em>
        </span>
        <input
          type="password"
          className="text-input wide"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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

      <button className="btn primary" disabled={!canConnect} onClick={() => connect(password)}>
        {busy ? t('connecting', language) : t('connect', language)}
      </button>
    </div>
  );
}
