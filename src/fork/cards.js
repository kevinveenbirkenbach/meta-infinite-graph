class ForkCards {
  static TOKEN_HELP = '#github-token';

  static COMMIT = '#fork-commit';

  static date(iso) {
    return typeof iso === 'string' ? iso.slice(0, 10) : '';
  }

  static _rich(tag, parts, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    for (const part of parts) {
      element.appendChild(
        typeof part === 'string'
          ? document.createTextNode(part)
          : textElement('code', part.code)
      );
    }
    return element;
  }

  static _steps(items) {
    const list = document.createElement('ol');
    for (const parts of items) list.appendChild(ForkCards._rich('li', parts));
    return list;
  }

  static tokenHelp() {
    const card = el('div', { className: 'role-card token-help' });
    card.appendChild(textElement('div', '🔑 GitHub token', 'role-card-title'));
    card.appendChild(textElement(
      'p',
      'GitHub answers 60 requests an hour to an address that sends no token. A '
      + 'full fork tree costs around 32, so the second visit runs dry. A token '
      + 'lifts the ceiling to 5000 an hour.',
      'role-card-desc'
    ));

    card.appendChild(textElement('h4', 'Create one'));
    card.appendChild(ForkCards._steps([
      ['Open Settings, Developer settings, Personal access tokens, Fine-grained tokens, then Generate new token.'],
      ['Resource owner: your own account. Expiration: any date, the tree needs nothing long lived.'],
      ['Repository access: ', { code: 'Public repositories (read-only)' }, '.'],
      ['Leave every permission untouched. Public repository metadata needs none of them.'],
      ['Generate, then copy the ', { code: 'github_pat_…' }, ' value. GitHub shows it exactly once.'],
    ]));
    card.appendChild(textElement(
      'p',
      'A classic token works as well: create one with no scope ticked at all. An '
      + 'empty scope still reads public data at the authenticated rate.',
      'token-help-aside'
    ));

    card.appendChild(textElement('h4', 'Paste it into the field'));
    card.appendChild(ForkCards._rich('p', [
      'It stays in this browser under the key ', { code: 'mig-gh-token' },
      ' and travels only to ', { code: 'api.github.com' },
      '. It is never written into the address bar, so a link you share carries '
      + 'the view and not the credential. The button below the field erases it '
      + 'again together with the cache.',
    ], 'token-help-aside'));

    card.appendChild(textElement('h4', 'Or persist it in .env'));
    card.appendChild(ForkCards._rich('p', [
      'Put the token into the ', { code: '.env' },
      ' file of the server that hosts this page, beside ', { code: 'MIG_PORT' }, ':',
    ], 'token-help-aside'));
    card.appendChild(textElement('pre', 'MIG_GITHUB_TOKEN=github_pat_…'));
    card.appendChild(ForkCards._rich('p', [
      'and start it with ', { code: 'make up' },
      '. The container then writes an nginx snippet that attaches the ',
      { code: 'Authorization' }, ' header to a ', { code: '/gh/' },
      ' proxy, so the browser calls its own origin and never receives the token. '
      + 'This field disappears and every visitor shares the one budget of 5000 an hour.',
    ], 'token-help-aside'));

    const links = el('div', { className: 'role-card-links' });
    for (const [text, href] of [
      ['Create a token', 'https://github.com/settings/personal-access-tokens/new'],
      ['Rate limits', 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api'],
    ]) {
      links.appendChild(el('a', { href, target: '_blank', rel: 'noreferrer', textContent: text }));
    }
    card.appendChild(links);
    return card;
  }

  static commitCard(commit, repo) {
    const card = el('div', { className: 'role-card commit-card' });
    card.appendChild(textElement('div', `${commit.sha.slice(0, 8)} in ${repo.id}`, 'role-card-title'));
    card.appendChild(textElement('p', commit.message, 'role-card-desc'));
    const facts = el('dl', { className: 'role-card-facts' });
    facts.append(textElement('dt', 'Date'), textElement('dd', ForkCards.date(commit.date)));
    facts.append(
      textElement('dt', 'Parents'),
      textElement('dd', (commit.parents || []).map(sha => sha.slice(0, 8)).join(', ') || 'root')
    );
    card.appendChild(facts);
    return card;
  }

  // The plot silently losing its lanes reads as "this repository has no
  // branches", so a refusal has to say which one it was and what it costs.
  static refusal(error) {
    if (error.status === 404) {
      return `No branch lines: ${error.message}. A 404 here is either a branch that does `
        + 'not exist or a path the server proxy does not carry; the fork network above is '
        + 'complete either way.';
    }
    return error.exhausted
      ? 'GitHub is out of requests for this hour, so no branch lines could be drawn. '
        + 'The fork network above is complete. Add a token in the filter panel, or turn '
        + 'the branch lines off in the design panel to spend the budget on the network alone.'
      : `GitHub answered ${error.status || 'with an error'} for the commit histories, `
        + 'so no branch lines could be drawn. The fork network above is complete.';
  }

  static tagNote(placed, orphaned) {
    return `${placed} of ${placed + orphaned} tags placed.`
      + (orphaned
        ? ' A tag carries no date, so the rest would each cost a request that the'
          + " hour's remaining quota is not spent on."
        : '');
  }

  static axisNote(span) {
    const range = `Axis: ${ForkCards.date(new Date(span.from).toISOString())} to `
      + `${ForkCards.date(new Date(span.to).toISOString())}`;
    return span.zoomed
      ? `${range}, the window of the loaded commits and tags. Fork lines older than it are `
        + 'clamped to the left edge.'
      : `${range}. Open a repository to draw its commit lanes and merges; the axis then `
        + 'narrows to that history.';
  }
}

window.ForkCards = ForkCards;
