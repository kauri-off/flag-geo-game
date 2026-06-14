// Searchable grid of country flags used as the player's avatar. The avatar is
// just an ISO alpha-2 code (the same codes the quiz flags use).
import { useMemo, useState } from 'react';
import { Flag } from '../components/Flag';
import { countries } from '../data/countries';
import { countryName } from '../i18n';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

interface Props {
  value: string;
  onChange: (alpha2: string) => void;
}

export function AvatarPicker({ value, onChange }: Props) {
  const language = useSettings((s) => s.language);
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const all = countries
      .map((c) => ({ alpha2: c.alpha2, name: countryName(c.id, language, c.alpha3) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) => c.name.toLowerCase().includes(q) || c.alpha2.toLowerCase().includes(q),
    );
  }, [query, language]);

  return (
    <div className="avatar-picker">
      <input
        type="text"
        className="text-input"
        placeholder={t('searchCountry', language)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="avatar-grid">
        {list.map((c) => (
          <button
            key={c.alpha2}
            type="button"
            className={`avatar-cell ${value === c.alpha2 ? 'on' : ''}`}
            title={c.name}
            aria-label={c.name}
            aria-pressed={value === c.alpha2}
            onClick={() => onChange(c.alpha2)}
          >
            <Flag alpha2={c.alpha2} />
          </button>
        ))}
      </div>
    </div>
  );
}
