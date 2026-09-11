import { t } from '../i18n.js';
import { selectedRepos } from './feed.js';

// Requests left in the hour below which a refresh is skipped, so the other
// views still have quota when the visitor switches to them.
const RESERVE = 10;

export class FeedRefresher {
  // Args:
  //   feed: the GitHubFeed to ask again, one request per ticked repository.
  //   loader: the Loader that shows the countdown and the refresh itself.
  //   shown: () => whether the feed's view is the one on screen.
  constructor(feed, loader, shown) {
    this.feed = feed;
    this.loader = loader;
    this.shown = shown;
    this.seconds = 60;
    this.started = 0;
    this.timer = null;
    this.paused = false;
  }

  // Args:
  //   seconds: the refresh interval; 0 turns refreshing off.
  setSeconds(seconds) {
    this.seconds = Number.isFinite(seconds) && seconds >= 0 ? seconds : 60;
    this.restart();
  }

  restart() {
    clearInterval(this.timer);
    this.timer = null;
    this.started = Date.now();
    if (!this.seconds || !this.shown()) {
      this.loader.countdown(null);
      return;
    }
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  tick() {
    if (!this.shown()) {
      this.restart();
      return;
    }
    if (document.hidden) {
      this.started = Date.now();
      return;
    }
    const elapsed = (Date.now() - this.started) / 1000;
    if (elapsed < this.seconds) {
      this.loader.countdown(elapsed / this.seconds, Math.ceil(this.seconds - elapsed), this.paused);
      return;
    }
    this.started = Date.now();
    this.paused = !this._spare();
    if (this.paused) {
      this.loader.countdown(0, this.seconds, true);
      return;
    }
    this.now();
  }

  // Args:
  //   everything: true asks for every run again; false only for what changed.
  // Returns: the promise for the redrawn feed.
  now(everything = false) {
    this.started = Date.now();
    this.paused = false;
    return this.loader.track(this.feed.kind, everything ? this.feed.show(true) : this.feed.update(),
      t(everything ? 'loader.task.everything' : 'loader.task.changes'));
  }

  _spare() {
    const rate = this.feed.api.rate;
    if (!rate || !rate.limit) return true;
    return rate.remaining > selectedRepos(this.feed.range).length + RESERVE;
  }
}
