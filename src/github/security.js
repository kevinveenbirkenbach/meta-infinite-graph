import { el } from '../dom.js';
import { html, render } from '../html.js';
import { t } from '../i18n.js';
import { selectedRepos } from './feed.js';

const RANK = { critical: 0, high: 1, error: 1, medium: 2, warning: 2, low: 3, note: 3 };
const PAGE = 100;

export class GitHubSecurity {
  // open: readable without a token, so the proxy always forwards it. The rest
  // are alerts only the repository's maintainers see.
  static SOURCES = {
    advisories: {
      open: true,
      page: 'security/advisories',
      path: full => `/repos/${full}/security-advisories?state=published&per_page=${PAGE}`,
      row: entry => ({
        severity: entry.severity, id: entry.ghsa_id, summary: entry.summary,
        since: entry.published_at, link: entry.html_url,
      }),
    },
    dependabot: {
      page: 'security/dependabot',
      path: full => `/repos/${full}/dependabot/alerts?state=open&per_page=${PAGE}`,
      row: entry => ({
        severity: entry.security_advisory?.severity, id: `#${entry.number}`,
        summary: [entry.dependency?.package?.name, entry.security_advisory?.summary].filter(Boolean).join(': '),
        since: entry.created_at, link: entry.html_url,
      }),
    },
    codeScanning: {
      page: 'security/code-scanning',
      path: full => `/repos/${full}/code-scanning/alerts?state=open&per_page=${PAGE}`,
      row: entry => ({
        severity: entry.rule?.security_severity_level || entry.rule?.severity, id: `#${entry.number}`,
        summary: entry.rule?.description, since: entry.created_at, link: entry.html_url,
      }),
    },
    secretScanning: {
      page: 'security/secret-scanning',
      path: full => `/repos/${full}/secret-scanning/alerts?state=open&hide_secret=true&per_page=${PAGE}`,
      row: entry => ({
        severity: null, id: `#${entry.number}`,
        summary: entry.secret_type_display_name || entry.secret_type, since: entry.created_at, link: entry.html_url,
      }),
    },
  };

  // Args:
  //   api: the GitHubApi; its proxy config decides which sources may be asked.
  //   range: the GitRange whose ticked refs select the repositories.
  constructor(api, range, container) {
    this.api = api;
    this.range = range;
    this.container = container;
    this.root = el('div', { className: 'table-section' });
  }

  static severity(value) {
    return value in RANK ? value : 'unknown';
  }

  _paint(note, repos, readings, findings) {
    render(html`<${Security} note=${note} repos=${repos} readings=${readings} findings=${findings} />`, this.root);
  }

  // Returns: every finding of the selected repositories, worst first.
  async show() {
    this.container.replaceChildren(this.root);
    this._paint(t('feed.asking'), [], {}, null);
    const repos = selectedRepos(this.range);
    if (!repos.length) {
      this._paint(t(this.range.catalog ? 'feed.noSource' : 'feed.noMirror'), [], {}, null);
      return [];
    }
    await this.api.detectProxy();
    const readings = {};
    await Promise.all(repos.flatMap(repo => Object.keys(GitHubSecurity.SOURCES).map(async name => {
      readings[`${repo} ${name}`] = await this._read(repo, name);
    })));
    const findings = Object.values(readings).flatMap(reading => reading.findings || [])
      .sort((one, other) => (RANK[one.severity] ?? 9) - (RANK[other.severity] ?? 9)
        || Date.parse(other.since || '') - Date.parse(one.since || ''));
    this._paint(GitHubSecurity._note(repos, readings, findings), repos, readings, findings);
    return findings;
  }

  async _read(repo, name) {
    const source = GitHubSecurity.SOURCES[name];
    if (this.api.proxied && !this.api.alerts && !source.open) return { state: 'withheld' };
    try {
      const entries = await this.api.get(source.path(repo), false);
      const findings = (Array.isArray(entries) ? entries : []).map(entry => ({
        ...source.row(entry), repo, source: name,
      }));
      for (const finding of findings) finding.severity = GitHubSecurity.severity(finding.severity);
      return { state: 'read', findings, capped: findings.length >= PAGE };
    } catch (error) {
      return { state: [401, 403, 404].includes(error.status) ? 'refused' : 'failed' };
    }
  }

  static _note(repos, readings, findings) {
    const states = Object.values(readings);
    return [
      t('security.note', { open: findings.length, n: repos.length }),
      states.some(one => one.state === 'withheld') ? t('security.withheld', { flag: 'MIG_GITHUB_ALERTS=true' }) : '',
      states.some(one => one.state === 'refused') ? t('security.refused') : '',
      states.some(one => one.capped) ? t('security.capped', { n: PAGE }) : '',
    ].filter(Boolean).join(' ');
  }
}

function Security({ note, repos, readings, findings }) {
  const sources = Object.entries(GitHubSecurity.SOURCES);
  const cell = (repo, name, source) => {
    const reading = readings[`${repo} ${name}`] || {};
    const text = reading.state === 'read' ? String(reading.findings.length) : t(`security.state.${reading.state || 'failed'}`);
    return html`<td class=${`security-state security-${reading.state}`} data-source=${name}>
      <a href=${`https://github.com/${repo}/${source.page}`} target="_blank" rel="noreferrer">${text}</a>
    </td>`;
  };
  return html`
    <h2>${t('view.security')}</h2>
    <p class="table-note">${note}</p>
    ${findings && html`
      <table class="table table-sm security-summary">
        <thead><tr>
          <th>${t('security.column.repository')}</th>
          ${sources.map(([name]) => html`<th>${t(`security.source.${name}`)}</th>`)}
        </tr></thead>
        <tbody>
          ${repos.map(repo => html`<tr data-repo=${repo}>
            <td>${repo}</td>
            ${sources.map(([name, source]) => cell(repo, name, source))}
          </tr>`)}
        </tbody>
      </table>
      <table class="table table-sm feed-table security-table">
        <thead><tr>${['severity', 'repository', 'source', 'alert', 'summary', 'since']
          .map(column => html`<th>${t(`security.column.${column}`)}</th>`)}</tr></thead>
        <tbody>
          ${findings.map(finding => html`<tr>
            <td class=${`security-severity security-${finding.severity}`}>${t(`security.severity.${finding.severity}`)}</td>
            <td>${finding.repo}</td>
            <td>${t(`security.source.${finding.source}`)}</td>
            <td><a href=${finding.link} target="_blank" rel="noreferrer">${finding.id}</a></td>
            <td>${finding.summary}</td>
            <td>${(finding.since || '').slice(0, 10)}</td>
          </tr>`)}
        </tbody>
      </table>
    `}
  `;
}
