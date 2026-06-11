// Reusable flag rendered from the locally bundled flag-icons SVG set (offline).
import type { CSSProperties } from 'react';
import 'flag-icons/css/flag-icons.min.css';

interface Props {
  alpha2: string;
  className?: string;
  title?: string;
  style?: CSSProperties;
}

export function Flag({ alpha2, className, title, style }: Props) {
  return (
    <span
      className={`fi fi-${alpha2.toLowerCase()} ${className ?? ''}`}
      title={title}
      style={style}
      role="img"
      aria-label={title ?? alpha2}
    />
  );
}
