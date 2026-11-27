import type { ReactNode } from 'react';

const shapes = {
  accessibility: <><circle cx="12" cy="3.5" r="1.75" /><path d="M4 8h16m-8 0v5m0 0-4 8m4-8l4 8" /></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  back: <path d="M20 12H5m6 6-6-6 6-6" />,
  camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3z" /><circle cx="12" cy="13" r="3.5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  circuit: <><path d="M4 7h4l2 3 3-6 3 3h4v12H4z" /><circle cx="4" cy="19" r="1.5" /><circle cx="20" cy="19" r="1.5" /></>,
  document: <><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8m-8 4h8" /></>,
  inbox: <><path d="m4 5-2 9v6h20v-6l-2-9zM2 14h6l2 3h4l2-3h6" /></>,
  microphone: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8" /></>,
  person: <><circle cx="12" cy="7" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></>,
  school: <><path d="m2 9 10-5 10 5-10 5zM6 11v6c3 3 9 3 12 0v-6m4-2v7" /></>,
  search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
  sound: <path d="M3 10v4h4l5 4V6l-5 4zm12-2a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />,
};

export type IconName = keyof typeof shapes;

export function Icon({ name }: { name: IconName }) {
  const shape: ReactNode = shapes[name];
  return <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">{shape}</svg>;
}
