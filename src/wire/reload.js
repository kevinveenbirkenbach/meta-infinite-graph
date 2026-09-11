import { t } from '../i18n.js';
import { wireLoaderMenu } from '../loader/menu.js';
import { currentView, viewName } from './views.js';

const INTERVALS = [30, 60, 300, 0];

function every(seconds) {
  if (!seconds) return t('loader.menu.off');
  return seconds < 60 ? t('loader.menu.seconds', { n: seconds }) : t('loader.menu.minutes', { n: seconds / 60 });
}

// Args:
//   anchor: the loader element in the bottom bar.
//   loader: its Loader, which shows a reload as it runs.
//   refresher: the FeedRefresher of the actions feed.
//   reloads: view -> () => the promise of that view drawn again.
//   api: the GitHubApi whose cache the menu can empty.
//   onChange: called once the interval changed, to write it to the URL.
export function wireReload({ anchor, loader, refresher, reloads, api, onChange }) {
  wireLoaderMenu(anchor, () => {
    const view = currentView();
    /** @type {Array<{ label?: string, run?: () => unknown, checked?: boolean, header?: string, divider?: boolean }>} */
    const items = [{ header: t('loader.menu.title') }];
    if (view === 'actions') {
      items.push(
        { label: t('loader.menu.changes'), run: () => refresher.now(false) },
        { label: t('loader.menu.all'), run: () => refresher.now(true) },
        { divider: true },
        { header: t('loader.menu.interval') },
        ...INTERVALS.map(seconds => ({
          label: every(seconds),
          checked: refresher.seconds === seconds,
          run: () => {
            refresher.setSeconds(seconds);
            onChange();
          },
        })),
        { divider: true },
      );
    } else if (reloads[view]) {
      items.push({
        label: t('loader.menu.view'),
        run: () => loader.track(view, reloads[view](), t('loader.task.view', { view: viewName(view) })),
      });
    }
    items.push(
      { label: t('loader.menu.cache'), run: () => api.forget() },
      { label: t('loader.menu.page'), run: () => window.location.reload() },
    );
    return items;
  });
}
