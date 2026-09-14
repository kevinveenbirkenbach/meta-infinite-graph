import { el } from '../../dom.js';
import { html, render } from '../../html.js';
import { t } from '../../i18n.js';
import { CodeTests } from './model.js';
import { CodeGrid } from './grid.js';

export class CodeTestsView {
  // Args:
  //   codeTests: the CodeTests reading the repository's tests tree.
  //   annotations: the RunAnnotations a picked run's marks come from.
  constructor(codeTests, annotations, container) {
    this.codeTests = codeTests;
    this.annotations = annotations;
    this.container = container;
    this.root = el('div', { className: 'table-section' });
    this.kind = CodeTests.KINDS[0];
    this.files = null;
    this.note = '';
    this.open = '';
    this.run = null;
    this.loaded = new Map();
    this.byKind = new Map();
    this.repaint = null;
    /** @type {(promise: Promise<unknown>, label: () => string) => unknown} */
    this.track = promise => promise;
  }

  _soon() {
    if (this.repaint) return;
    this.repaint = setTimeout(() => {
      this.repaint = null;
      this._paint();
    }, 200);
  }

  toggle(file) {
    this.open = this.open === file.path ? '' : file.path;
    this.codeTests.load(file).then(() => this._paint());
    this._paint();
  }

  // Args:
  //   repo: owner/name of the run whose annotations mark the files.
  //   run: that run as GitHub lists it, or null for none.
  pick(repo, run) {
    const held = this.run ? this.run.run.id : null;
    if ((run ? run.id : null) === held) return;
    this.run = run ? { repo, run } : null;
    if (this.run) {
      this.track(
        this.annotations.load(repo, run, () => this._soon()).then(() => this._paint()),
        () => t('loader.task.warnings', this.annotations.progress())
      );
    }
    this._paint();
  }

  // Returns: the annotations of the picked run that name this file.
  marksOf(file) {
    if (!this.run) return [];
    const state = this.annotations.state(this.run.repo, this.run.run);
    if (!state) return [];
    return state.entries.filter(entry => entry.path && (
      entry.path === `tests/${file.path}` || entry.path.endsWith(`/${file.path}`)
    ));
  }

  invalidate() {
    this.codeTests.forget();
    this.loaded.clear();
    this.byKind.clear();
    this.files = null;
  }

  refresh() {
    if (this.files) this._paint();
  }

  // Args:
  //   kind: the suite the menu entry opened, one of CodeTests.KINDS.
  // Returns: the promise for its files, settled once every one was read.
  show(kind) {
    this.container.replaceChildren(this.root);
    this.kind = kind;
    if (!this.loaded.has(kind)) {
      this.loaded.set(kind, this._load(kind));
    } else {
      // Each suite keeps its own files: drawing the previous one's would show
      // Lint's tree under the External heading.
      this.files = this.byKind.get(kind);
      this._render();
    }
    return this.loaded.get(kind);
  }

  _load(kind) {
    this.files = null;
    this.note = t('tests.code.reading');
    this._paint();
    return this.codeTests.list(kind).then(files => {
      this.byKind.set(kind, files);
      if (files === null) {
        this.files = null;
        this.note = t('tests.code.noTree', { path: this.codeTests.base });
        this._paint();
        return [];
      }
      this.files = files;
      this._render();
      return this.codeTests.read(files, () => this._soon()).then(() => {
        this._render();
        return files;
      });
    });
  }

  _render() {
    if (this.kind && this.files) {
      const { done, total } = this.codeTests.progress(this.files);
      const cases = this.files.reduce((sum, file) => sum + (this.codeTests.known(file) || []).length, 0);
      this.note = [
        t('tests.code.note', { n: total, cases }),
        done === total ? '' : t('tests.code.reading'),
        this.run ? t('tests.code.held', { run: `#${this.run.run.run_number}`, n: this._marked() }) : '',
      ].filter(Boolean).join(' ');
    }
    this._paint();
  }

  _marked() {
    return this.files.filter(file => this.marksOf(file).length).length;
  }

  _paint() {
    render(html`<${CodeGrid} view=${this} />`, this.root);
  }
}
