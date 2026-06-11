// Reusable flag rendered from the locally bundled flag-icons SVG set (offline).
import 'flag-icons/css/flag-icons.min.css';

interface Props {
  alpha2: string;
  className?: string;
  title?: string;
}

export function Flag({ alpha2, className, title }: Props) {
  return (
    <span
      className={`fi fi-${alpha2.toLowerCase()} ${className ?? ''}`}
      title={title}
      role="img"
      aria-label={title ?? alpha2}
    />
  );
}
