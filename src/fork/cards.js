import { el, textElement } from '../dom.js';
import { t } from '../i18n.js';

export class ForkCards {
  static TOKEN_HELP = '#github-token';

  static COMMIT = '#fork-commit';

  static date(iso) {
    return typeof iso === 'string' ? iso.slice(0, 10) : '';
  }

  // Args:
  //   message: a translated text whose {placeholders} name entries of codes.
  //   codes: the literal each placeholder stands for, set as <code>.
  static _rich(tag, message, codes, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    message.split(/\{(\w+)\}/).forEach((part, index) => {
      element.appendChild(index % 2 ? textElement('code', codes[part]) : document.createTextNode(part));
    });
    return element;
  }

  static tokenHelp() {
    const card = el('div', { className: 'role-card token-help' });
    card.appendChild(textElement('div', t('token.title'), 'role-card-title'));
    card.appendChild(textElement('p', t('token.intro'), 'role-card-desc'));

    card.appendChild(textElement('h4', t('token.create')));
    const steps = document.createElement('ol');
    for (const [key, codes] of Object.entries({
      'token.step1': {},
      'token.step2': {},
      'token.step3': { scope: 'Public repositories (read-only)' },
      'token.step4': {},
      'token.step5': { token: 'github_pat_…' },
    })) {
      steps.appendChild(ForkCards._rich('li', t(key), codes));
    }
    card.appendChild(steps);
    card.appendChild(textElement('p', t('token.classic'), 'token-help-aside'));

    card.appendChild(textElement('h4', t('token.paste')));
    card.appendChild(ForkCards._rich('p', t('token.stays'), { key: 'mig-gh-token', host: 'api.github.com' }, 'token-help-aside'));

    card.appendChild(textElement('h4', t('token.persist')));
    card.appendChild(ForkCards._rich('p', t('token.persistHow'), { env: '.env', port: 'MIG_PORT' }, 'token-help-aside'));
    card.appendChild(textElement('pre', 'MIG_GITHUB_TOKEN=github_pat_…'));
    card.appendChild(ForkCards._rich('p', t('token.proxy'), {
      make: 'make up', header: 'Authorization', path: '/gh/',
    }, 'token-help-aside'));

    const links = el('div', { className: 'role-card-links' });
    for (const [key, href] of [
      ['token.createLink', 'https://github.com/settings/personal-access-tokens/new'],
      ['token.limitsLink', 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api'],
    ]) {
      links.appendChild(el('a', { href, target: '_blank', rel: 'noreferrer', textContent: t(key) }));
    }
    card.appendChild(links);
    return card;
  }

  static commitCard(commit, repo) {
    const card = el('div', { className: 'role-card commit-card' });
    card.appendChild(textElement('div', t('fork.commitIn', { sha: commit.sha.slice(0, 8), repo: repo.id }), 'role-card-title'));
    card.appendChild(textElement('p', commit.message, 'role-card-desc'));
    const facts = el('dl', { className: 'role-card-facts' });
    facts.append(textElement('dt', t('commits.column.date')), textElement('dd', ForkCards.date(commit.date)));
    facts.append(
      textElement('dt', t('fork.parents')),
      textElement('dd', (commit.parents || []).map(sha => sha.slice(0, 8)).join(', ') || t('fork.root'))
    );
    card.appendChild(facts);
    return card;
  }

  // The plot silently losing its lanes reads as "this repository has no
  // branches", so a refusal has to say which one it was and what it costs.
  static refusal(error) {
    if (error.status === 404) return t('fork.refused404', { message: error.message });
    return error.exhausted
      ? t('fork.refusedExhausted')
      : t('fork.refusedOther', { status: error.status || t('feed.anError') });
  }

  static tagNote(placed, orphaned) {
    const note = t('fork.tagsPlaced', { placed, n: placed + orphaned });
    return orphaned ? `${note} ${t('fork.tagsOrphaned')}` : note;
  }

  static axisNote(span) {
    const axis = t('fork.axis', {
      from: ForkCards.date(new Date(span.from).toISOString()),
      to: ForkCards.date(new Date(span.to).toISOString()),
    });
    return t(span.zoomed ? 'fork.axisZoomed' : 'fork.axisWhole', { axis });
  }
}
