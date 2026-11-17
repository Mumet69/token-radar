// app.js — the token radar's dashboard: board, filters, detail view.
// Reads the DATA object data.js defines. No network: nothing here fetches,
// imports or links anywhere; the page is fully local.
(function () {
  'use strict';

  var DATA = window.DATA;
  if (!DATA || !Array.isArray(DATA.rows)) {
    document.getElementById('board-body').innerHTML =
      '<tr><td colspan="7">The dashboard data did not load.</td></tr>';
    window.__shotReady = true;
    return;
  }

  var state = {
    query: '',
    category: 'all',
    chain: 'all',
    onlyWatchlist: false,
    tab: 'pre',
    sort: 'implied',
    selected: null,
  };

  // ------------------------------------------------------------ formatting

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(value) {
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (value >= 1e3) return '$' + Math.round(value / 1e3) + 'k';
    return '$' + Math.round(value);
  }

  function moneyFull(value) {
    return '$' + Math.round(value).toLocaleString('en-US');
  }

  function growthText(change) {
    if (change === null || change === undefined) return '–';
    var sign = change > 0 ? '+' : '';
    return sign + change.toFixed(2) + '%';
  }

  function ageText(days) {
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  // ------------------------------------------------------------ state from the URL

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    var params = {};
    hash.split('&').forEach(function (pair) {
      var parts = pair.split('=');
      if (parts[0]) params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '');
    });
    return params;
  }

  var initial = readHash();
  if (initial.category) state.category = initial.category;

  // ------------------------------------------------------------ filters

  function fillSelect(id, values) {
    var select = document.getElementById(id);
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    if (id === 'category' && state.category !== 'all') select.value = state.category;
  }

  var categories = [];
  var chains = [];
  DATA.rows.concat(DATA.live || []).forEach(function (row) {
    if (categories.indexOf(row.category) === -1) categories.push(row.category);
    (row.chains || []).forEach(function (chain) {
      if (chains.indexOf(chain) === -1) chains.push(chain);
    });
  });
  categories.sort();
  chains.sort();
  fillSelect('category', categories);
  fillSelect('chain', chains);

  function matches(row) {
    if (state.onlyWatchlist && !row.watchlist && state.tab === 'pre') return false;
    if (state.category !== 'all' && row.category !== state.category) return false;
    if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) === -1) return false;
    if (state.query) {
      var hay = (row.name + ' ' + row.category + ' ' + (row.chains || []).join(' ')).toLowerCase();
      if (hay.indexOf(state.query.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function sortRows(rows) {
    var copy = rows.slice();
    if (state.sort === 'tvl') copy.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === 'growth') copy.sort(function (a, b) { return (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity); });
    else if (state.sort === 'age') copy.sort(function (a, b) { return b.age_days - a.age_days; });
    else if (state.tab === 'live') copy.sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
    else copy.sort(function (a, b) { return a.rank - b.rank; });
    return copy;
  }

  function visibleRows() {
    var source = state.tab === 'live' ? DATA.live || [] : DATA.rows;
    return sortRows(source.filter(matches));
  }

  // ------------------------------------------------------------ rendering

  var body = document.getElementById('board-body');
  var detail = document.getElementById('detail');
  var countEl = document.getElementById('row-count');
  var noteEl = document.getElementById('count-note');

  function renderStats() {
    var meta = DATA.meta;
    document.getElementById('stat-asof').textContent = meta.as_of;
    document.getElementById('stat-watchlist').textContent = meta.watchlist_covered + ' / ' + meta.watchlist;
    document.getElementById('stat-rows').textContent = String(meta.rows);
    document.getElementById('stat-early').textContent = String(meta.rows - meta.watchlist);
    document.getElementById('stat-top10').textContent = money(meta.top_ten_total_usd);
    document.getElementById('stat-live').textContent = String(meta.live);
  }

  function renderTable() {
    var rows = visibleRows();
    var maxValue = 1;
    if (state.tab === 'live') {
      (DATA.live || []).forEach(function (r) { if (r.mcap_usd > maxValue) maxValue = r.mcap_usd; });
    } else {
      DATA.rows.forEach(function (r) { if (r.implied_value_usd > maxValue) maxValue = r.implied_value_usd; });
    }
    var html = rows
      .map(function (row, i) {
        var value = state.tab === 'live' ? row.mcap_usd : row.implied_value_usd;
        var rankLabel = state.tab === 'live' ? String(i + 1) : String(row.rank);
        var tag = state.tab === 'live'
          ? '<span class="tag early">Live</span>'
          : row.watchlist
            ? '<span class="tag">Watchlist</span>'
            : '<span class="tag early">Early</span>';
        var change = row.change_7d;
        var changeClass = change === null ? '' : change >= 0 ? 'up' : 'down';
        var width = Math.max(2, Math.round((value / maxValue) * 100));
        var selected = state.selected === row.slug ? ' class="selected"' : '';
        return (
          '<tr data-slug="' + esc(row.slug) + '"' + selected + '>' +
          '<td class="num">' + rankLabel + '</td>' +
          '<td><div class="name">' + esc(row.name) + '</div>' +
          '<div class="sub">' + esc(row.category) + ' on ' + esc((row.chains || []).slice(0, 2).join(', ')) + '</div></td>' +
          '<td class="num">' + money(row.tvl_usd) + '</td>' +
          '<td class="num ' + changeClass + '">' + growthText(change) + '</td>' +
          '<td class="num">' + ageText(row.age_days) + '</td>' +
          '<td class="num"><span class="bar"><i style="width:' + width + '%"></i></span>' + money(value) + '</td>' +
          '<td>' + tag + '</td></tr>'
        );
      })
      .join('');
    body.innerHTML = html || '<tr><td colspan="7">No protocols match these filters.</td></tr>';
    countEl.textContent = rows.length + (rows.length === 1 ? ' row' : ' rows') + ' shown';
    noteEl.textContent =
      state.tab === 'live'
        ? 'Protocols whose token already trades, largest market cap first. Shown as comparables, not farming targets.'
        : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.';
  }

  function renderDetail() {
    var row = null;
    var all = DATA.rows.concat(DATA.live || []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].slug === state.selected) { row = all[i]; break; }
    }
    if (!row) {
      detail.innerHTML =
        '<p class="detail-empty">Select a protocol on the board to see how its implied value is built and how to farm it.</p>';
      return;
    }
    var head =
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="meta">' + esc(row.category) + ' &middot; ' + esc((row.chains || []).join(', ')) +
      ' &middot; tracked since ' + esc(row.listed_at || 'unknown') + '</p>';
    if (row.token_status === 'pre-token') {
      var m = row.model;
      head +=
        '<h3>How the implied value is built</h3>' +
        '<dl class="model-grid">' +
        '<div><dt>TVL</dt><dd>' + moneyFull(row.tvl_usd) + '</dd></div>' +
        '<div><dt>Category multiple</dt><dd>' + m.multiple.toFixed(4) + 'x (' + m.multiple_n + ' live)</dd></div>' +
        '<div><dt>7d growth</dt><dd>' + growthText(row.change_7d) + '</dd></div>' +
        '<div><dt>Growth factor</dt><dd>' + m.growth_multiplier.toFixed(4) + 'x</dd></div>' +
        '<div><dt>Age</dt><dd>' + ageText(row.age_days) + '</dd></div>' +
        '<div><dt>Maturity factor</dt><dd>' + m.maturity_multiplier.toFixed(4) + 'x</dd></div>' +
        '<div><dt>Implied value</dt><dd>' + moneyFull(row.implied_value_usd) + '</dd></div>' +
        '<div><dt>Rank</dt><dd>#' + row.rank + ' of ' + DATA.rows.length + '</dd></div>' +
        '</dl>' +
        '<p class="model-note">Implied = TVL &times; category multiple &times; growth factor &times; maturity factor. ' +
        'The multiple is the median market-cap-to-TVL of live-token protocols in this category, shrunk toward the global median.</p>' +
        '<h3>How to farm it</h3>' +
        '<ol class="farm">' +
        row.farm_steps.map(function (step) { return '<li>' + esc(step) + '</li>'; }).join('') +
        '</ol>';
    } else {
      var ratio = row.tvl_usd > 0 ? (row.mcap_usd / row.tvl_usd).toFixed(3) : '–';
      head +=
        '<h3>Already trading — a comparable</h3>' +
        '<dl class="model-grid">' +
        '<div><dt>TVL</dt><dd>' + moneyFull(row.tvl_usd) + '</dd></div>' +
        '<div><dt>Market cap</dt><dd>' + moneyFull(row.mcap_usd) + '</dd></div>' +
        '<div><dt>Market cap / TVL</dt><dd>' + ratio + 'x</dd></div>' +
        '<div><dt>7d growth</dt><dd>' + growthText(row.change_7d) + '</dd></div>' +
        '<div><dt>Age</dt><dd>' + ageText(row.age_days) + '</dd></div>' +
        '<div><dt>Token</dt><dd>' + esc(row.symbol || '—') + '</dd></div>' +
        '</dl>' +
        '<p class="model-note">This protocol already has a token that trades, so it is not a farming target. ' +
        'It is shown because its market-cap-to-TVL ratio is what the radar prices pre-token protocols of its kind against.</p>';
    }
    detail.innerHTML = head;
  }

  function render() {
    renderTable();
    renderDetail();
  }

  // ------------------------------------------------------------ events

  document.getElementById('q').addEventListener('input', function (event) {
    state.query = event.target.value;
    renderTable();
  });
  document.getElementById('category').addEventListener('change', function (event) {
    state.category = event.target.value;
    renderTable();
  });
  document.getElementById('chain').addEventListener('change', function (event) {
    state.chain = event.target.value;
    renderTable();
  });
  document.getElementById('only-watchlist').addEventListener('change', function (event) {
    state.onlyWatchlist = event.target.checked;
    renderTable();
  });
  document.getElementById('sort').addEventListener('change', function (event) {
    state.sort = event.target.value;
    renderTable();
  });
  document.getElementById('tab-pre').addEventListener('click', function () {
    state.tab = 'pre';
    document.getElementById('tab-pre').setAttribute('aria-selected', 'true');
    document.getElementById('tab-live').setAttribute('aria-selected', 'false');
    render();
  });
  document.getElementById('tab-live').addEventListener('click', function () {
    state.tab = 'live';
    document.getElementById('tab-live').setAttribute('aria-selected', 'true');
    document.getElementById('tab-pre').setAttribute('aria-selected', 'false');
    render();
  });
  body.addEventListener('click', function (event) {
    var row = event.target.closest('tr[data-slug]');
    if (!row) return;
    state.selected = row.getAttribute('data-slug');
    render();
  });

  // ------------------------------------------------------------ first paint

  renderStats();
  if (initial.p) {
    var found = DATA.rows.concat(DATA.live || []).some(function (r) { return r.slug === initial.p; });
    if (found) state.selected = initial.p;
  }
  render();
  window.__shotReady = true;
})();
