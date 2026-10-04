export function LockIcon({ locked }: { locked: boolean }) {
  return <svg className="ab-outline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="10" width="14" height="11" rx="2" />
    <path d={locked ? 'M8 10V6a4 4 0 0 1 8 0v4' : 'M8 10V6a4 4 0 0 1 8 0'} />
    <path d="M12 14v3" />
  </svg>;
}
export function EyedropperIcon() {
  return <svg className="ab-outline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m14 5 5 5M16 7l3-3a2.1 2.1 0 0 1 3 3l-3 3M15 6 4 17v3h3L18 9M4 20l-2 2" />
  </svg>;
}
