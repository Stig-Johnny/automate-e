/**
 * Kanban board API — fetches issues from GitHub and organizes into columns.
 * Used by ATL-E and any agent that monitors GitHub repos.
 *
 * Requires GITHUB_PERSONAL_ACCESS_TOKEN env var.
 * Repos are extracted from character.lore (looks for "Monitored repos:" entry).
 */

const GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const COLUMNS = [
  { id: 'backlog', label: 'Backlog', match: (labels) => !labels.some(l => ['agent-ready', 'in-progress', 'in-review'].includes(l)) },
  { id: 'ready', label: 'Ready', match: (labels) => labels.includes('agent-ready') },
  { id: 'in-progress', label: 'In Progress', match: (labels) => labels.includes('in-progress') && !labels.includes('in-review') },
  { id: 'in-review', label: 'In Review', match: (labels) => labels.includes('in-review') || labels.includes('in-progress') },
  { id: 'done', label: 'Done (24h)', match: () => false }, // populated separately from closed issues
];

function extractRepos(character) {
  const loreEntry = (character.lore || []).find(l => l.includes('Monitored repos:'));
  if (!loreEntry) return [];
  const reposPart = loreEntry.replace('Monitored repos:', '').trim();
  return reposPart.split(',').map(r => r.trim()).filter(Boolean);
}

async function githubFetch(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'automate-e',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  return res.json();
}

async function fetchRepoIssues(fullName) {
  const [owner, repo] = fullName.split('/');
  try {
    const [openIssues, openPRs, closedIssues] = await Promise.all([
      githubFetch(`/repos/${owner}/${repo}/issues?state=open&per_page=30`),
      githubFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=30`),
      githubFetch(`/repos/${owner}/${repo}/issues?state=closed&per_page=10&sort=updated&direction=desc`),
    ]);

    // Filter out PRs from issues list
    const prNumbers = new Set(openPRs.map(p => p.number));
    const issues = openIssues.filter(i => !i.pull_request);

    // Map PRs to their linked issues
    const prMap = {};
    for (const pr of openPRs) {
      prMap[pr.number] = {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        author: pr.user.login,
        draft: pr.draft,
        mergeable_state: pr.mergeable_state,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
      };
    }

    // Recently closed (last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentlyClosed = closedIssues
      .filter(i => !i.pull_request && new Date(i.closed_at) > oneDayAgo);

    return { repo: fullName, issues, prs: openPRs, prMap, recentlyClosed };
  } catch (err) {
    console.error(`[Kanban] Error fetching ${fullName}: ${err.message}`);
    return { repo: fullName, issues: [], prs: [], prMap: {}, recentlyClosed: [] };
  }
}

function categorizeIssue(issue, repoName, prMap) {
  const labels = issue.labels.map(l => l.name);
  const assignees = issue.assignees.map(a => a.login);
  const claimedBy = labels.find(l => l.startsWith('claimed-'))?.replace('claimed-', '') || assignees[0] || null;

  // Check for linked PR
  const linkedPr = Object.values(prMap).find(pr =>
    pr.title?.includes(`#${issue.number}`) || issue.title?.includes(`PR #${pr.number}`)
  );

  const card = {
    id: `${repoName}#${issue.number}`,
    number: issue.number,
    title: issue.title,
    repo: repoName.split('/')[1],
    repoFull: repoName,
    url: issue.html_url,
    labels,
    assignees,
    claimedBy,
    author: issue.user.login,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    linkedPr: linkedPr || null,
    priority: labels.includes('high-priority') ? 'high' : labels.includes('low-priority') ? 'low' : 'normal',
  };

  // Determine column
  if (linkedPr) {
    card.column = 'in-review';
  } else if (labels.includes('in-progress')) {
    card.column = 'in-progress';
  } else if (labels.includes('agent-ready')) {
    card.column = 'ready';
  } else {
    card.column = 'backlog';
  }

  return card;
}

export async function getKanbanData(character) {
  if (!GITHUB_TOKEN) return { error: 'GITHUB_PERSONAL_ACCESS_TOKEN not set', columns: {} };

  const repos = extractRepos(character);
  if (!repos.length) return { error: 'No repos found in character lore', columns: {} };

  const allData = await Promise.all(repos.map(fetchRepoIssues));

  const columns = { backlog: [], ready: [], 'in-progress': [], 'in-review': [], done: [] };

  for (const { repo, issues, prMap, recentlyClosed } of allData) {
    for (const issue of issues) {
      const card = categorizeIssue(issue, repo, prMap);
      columns[card.column].push(card);
    }

    for (const issue of recentlyClosed) {
      columns.done.push({
        id: `${repo}#${issue.number}`,
        number: issue.number,
        title: issue.title,
        repo: repo.split('/')[1],
        repoFull: repo,
        url: issue.html_url,
        labels: issue.labels.map(l => l.name),
        assignees: issue.assignees.map(a => a.login),
        claimedBy: issue.assignees[0]?.login || null,
        author: issue.user.login,
        created_at: issue.created_at,
        closed_at: issue.closed_at,
        column: 'done',
        priority: 'normal',
      });
    }
  }

  // Sort: high priority first, then by updated_at
  for (const col of Object.values(columns)) {
    col.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      return new Date(b.updated_at || b.closed_at) - new Date(a.updated_at || a.closed_at);
    });
  }

  return {
    columns,
    repos: repos.length,
    totalIssues: Object.values(columns).reduce((n, col) => n + col.length, 0),
    fetchedAt: new Date().toISOString(),
  };
}
